import type { FaqData } from './faq-data.js';
import { expandFaq } from './faq-data.js';
import { faqLineMessage, faqView, type FaqView } from './faq-render.js';
import { faqNow, getFaqRelease, selectFaqDeployment } from './faq-store.js';

interface Session {id:string;account_id:string;friend_id:string;release_id:string;audience:'test'|'production';node_id:string;event_id:string|null;outcome:string;preserve_unread:number}
interface Input {accountId:string|null;friendId:string;kind:'text'|'postback';value:string;eventId:string;send:(message:unknown)=>Promise<unknown>}
async function schemaExists(db:D1Database){return !!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='faq_deployments'").first();}
async function updateStatus(db:D1Database,s:Session,status:'unread'|'resolved',note:string){
  const now=faqNow();
  if(status==='unread'){
    await db.prepare(`INSERT OR IGNORE INTO chats(id,friend_id,status,notes,last_message_at,created_at,updated_at)
      SELECT ?,?,'unread',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM chats WHERE friend_id=?)`).bind(crypto.randomUUID(),s.friend_id,note,now,now,now,s.friend_id).run();
    await db.prepare(`UPDATE chats SET status=CASE WHEN status='in_progress' THEN status ELSE 'unread' END,
      notes=CASE WHEN instr(COALESCE(notes,''),?)>0 THEN notes ELSE COALESCE(notes,'')||char(10)||? END, updated_at=? WHERE friend_id=?`).bind(note,note,now,s.friend_id).run();
  }else{
    // Completing this customer conversation closes its pending FAQ handoffs.
    // A separate incoming message after the FAQ started still needs attention.
    await db.prepare(`INSERT OR IGNORE INTO chats(id,friend_id,status,last_message_at,created_at,updated_at)
      SELECT ?,?,'resolved',?,?,? WHERE NOT EXISTS(SELECT 1 FROM chats WHERE friend_id=?)`).bind(crypto.randomUUID(),s.friend_id,now,now,now,s.friend_id).run();
    await db.prepare(`UPDATE chats SET status='resolved',updated_at=? WHERE friend_id=?
      AND NOT EXISTS(SELECT 1 FROM messages_log WHERE friend_id=? AND direction='incoming' AND COALESCE(source,'')<>'postback'
        AND rowid>COALESCE((SELECT MIN(rowid) FROM messages_log WHERE friend_id=? AND direction='outgoing' AND instr(content,?)>0),-1))`).bind(now,s.friend_id,s.friend_id,s.friend_id,s.id).run();
    await db.prepare("UPDATE faq_sessions SET outcome='resolved',updated_at=? WHERE friend_id=? AND outcome='handoff' AND EXISTS(SELECT 1 FROM chats WHERE friend_id=? AND status='resolved')").bind(now,s.friend_id,s.friend_id).run();
  }
}
export async function closeFaqSessions(db:D1Database,friendId:string){if(await schemaExists(db))await db.prepare("UPDATE faq_sessions SET outcome='resolved',updated_at=? WHERE friend_id=? AND outcome='handoff'").bind(faqNow(),friendId).run();}
export async function handleFaq(db:D1Database,input:Input):Promise<boolean>{
  const start=input.kind==='text'&&['FAQ','FAQテスト'].includes(input.value.trim());
  if(!start&&!(input.kind==='postback'&&input.value.startsWith('faqv1:')))return false;
  if(!input.accountId||!await schemaExists(db))return false;
  let s:Session|null=null,action='node',target='root';
  if(!start){const parts=input.value.split(':');if(parts.length!==5)return true;s=await db.prepare('SELECT * FROM faq_sessions WHERE id=? AND account_id=? AND friend_id=?').bind(parts[2],input.accountId,input.friendId).first<Session>();if(!s)return true;}
  const deployment=await selectFaqDeployment(db,input.accountId,input.friendId,start?input.value.trim()==='FAQテスト':s!.audience==='test');
  if(!deployment)return input.kind==='postback'; // Disabled FAQ buttons must never hit unrelated automation.
  const release=await getFaqRelease(db,input.accountId,deployment.release_id);if(!release)return true;
  const data=JSON.parse(release.payload) as FaqData;
  if(await db.prepare('SELECT event_id FROM faq_webhook_receipts WHERE account_id=? AND event_id=?').bind(input.accountId,input.eventId).first())return true;
  if(!start){
    const parts=input.value.split(':');if(parts.length!==5)return true;
    const [,releaseId,sessionId,verb,node]=parts;
    if(releaseId!==release.id){
      // A release change invalidates old controls; show the current root, never close a newer inquiry.
      action='node';target='root';s=null;
    }else{
      s=await db.prepare('SELECT * FROM faq_sessions WHERE id=? AND account_id=? AND friend_id=? AND release_id=?').bind(sessionId,input.accountId,input.friendId,releaseId).first<Session>();
      if(!s||s.audience!==deployment.audience)return true;
      action=verb;target=node;
      if(!['node','event','resolved','handoff'].includes(action))return true;
      if((action==='resolved'||action==='handoff')&&(s.node_id!==target||!['answered','redirected'].includes(s.outcome)))return true;
    }
  }
  if(action==='node'&&!data.nodes[target])return true;
  if(action==='event'&&(!s||!data.events[target]||data.events[target].active!==true))return true;
  // Only authenticated LINE webhook events enter here. Receipts prevent duplicated state transitions/sends.
  const receipt=await db.prepare("INSERT OR IGNORE INTO faq_webhook_receipts(account_id,event_id,state,created_at) VALUES(?,?,'processing',?)").bind(input.accountId,input.eventId,faqNow()).run();
  if(!receipt.meta.changes)return true;
  try{
    if(!s){
      const old=await db.prepare('SELECT status FROM chats WHERE friend_id=? ORDER BY updated_at DESC LIMIT 1').bind(input.friendId).first<{status:string}>();
      s={id:crypto.randomUUID(),account_id:input.accountId,friend_id:input.friendId,release_id:release.id,audience:deployment.audience,node_id:'root',event_id:null,outcome:'browsing',preserve_unread:old&&old.status!=='resolved'?1:0};
      await db.prepare('INSERT INTO faq_sessions(id,account_id,friend_id,release_id,audience,preserve_unread,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(s.id,s.account_id,s.friend_id,s.release_id,s.audience,s.preserve_unread,faqNow(),faqNow()).run();
    }
    let view:FaqView;
    if(action==='resolved'){
      await db.prepare("UPDATE faq_sessions SET outcome='resolved',updated_at=? WHERE id=?").bind(faqNow(),s.id).run();

      view={nodeId:s.node_id,eventId:s.event_id,text:String(data.messages.msg_resolved?.text||''),buttons:[{label:data.nodes.root.label,nodeId:'root'}],outcome:'answered'};
    }else{
      if(action==='event')s.event_id=target;
      const nodeId=action==='node'?target:s.node_id;
      view=faqView(data,nodeId,s.event_id);
      if(action==='handoff'){
        const node=data.nodes[nodeId],fields=(data.handoffs[node.handoff||'H_GENERAL']?.fields||[]).map(f=>'・'+f).join('\n');
        const j=new Date(Date.now()+9*3600000),open=![0,3].includes(j.getUTCDay())&&j.getUTCHours()>=10&&j.getUTCHours()<19;
        view={nodeId,eventId:s.event_id,text:expandFaq(data,String(data.messages[open?'msg_handoff_in':'msg_handoff_out']?.text||''),s.event_id||undefined,fields),buttons:[],outcome:'handoff'};
      }
      // A consultation in human queue remains pending when the same user browses another FAQ.
      const next=s.outcome==='handoff'?'handoff':view.outcome;
      await db.prepare('UPDATE faq_sessions SET node_id=?,event_id=?,outcome=?,updated_at=? WHERE id=?').bind(nodeId,s.event_id,next,faqNow(),s.id).run();
      if(view.outcome==='handoff')await updateStatus(db,s,'unread',`[FAQ:${s.id}] ${data.nodes[nodeId].label} / ${data.nodes[nodeId].handoff||'H_GENERAL'}`);
    }
    const message=faqLineMessage(view,release.id,s.id);
    await input.send(message);
    await db.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,line_account_id,created_at)
      VALUES(?,?,'outgoing','flex',?,'auto_reply',?,?)`).bind(crypto.randomUUID(),input.friendId,JSON.stringify(message.contents),input.accountId,faqNow()).run();
    if(action==='resolved'||view.outcome==='redirected')await updateStatus(db,s,'resolved','');
    await db.prepare("UPDATE faq_webhook_receipts SET state='sent' WHERE account_id=? AND event_id=?").bind(input.accountId,input.eventId).run();
  }catch(e){
    // Keep a failed receipt: no duplicated handoff or surprise paid push on redelivery.
    await db.prepare("UPDATE faq_webhook_receipts SET state='failed' WHERE account_id=? AND event_id=?").bind(input.accountId,input.eventId).run();
    // Delivery errors must be visible to colleagues even if LINE cannot receive the acknowledgement.
    if(s)await updateStatus(db,s,'unread',`[FAQ:${s.id}] 配信失敗`);
    console.error('[faq] reply failed',e);
  }
  return true;
}
