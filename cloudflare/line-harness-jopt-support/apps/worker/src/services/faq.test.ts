import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { faq } from '../routes/faq.js';
import { faqHash, normalizeFaq, validateFaq } from './faq-data.js';
import { deployFaq, getFaqRelease, importFaq } from './faq-store.js';
import { closeFaqSessions, handleFaq } from './faq-runtime.js';
import { faqLineMessage, faqView } from './faq-render.js';

function fixture(){return {
  nodes:{root:{id:'root',label:'トップ',type:'menu',body:'{{msg_root}}',status:'確認済'},a:{id:'a',parent:'root',label:'質問',type:'answer',body:'回答です。\n日本語です。',status:'確認済'},h:{id:'h',parent:'root',label:'担当者',type:'handoff',body:'受付',handoff:'H',status:'確認済'},r:{id:'r',parent:'root',label:'他のLINE',type:'redirect',body:'案内',channel:'C',status:'確認済'}},
  channels:{C:{id:'C',name:'窓口',url:'https://line.me/example',status:'確認済'}},handoffs:{H:{id:'H',fields:['GameID']}},vars:{},events:{},
  messages:Object.fromEntries(['msg_root','msg_followup','msg_handoff_in','msg_handoff_out','msg_resolved'].map(id=>[id,{id,text:id==='msg_handoff_in'||id==='msg_handoff_out'?'受付しました。{{fields}}':'テスト文面'}])),
};}
let db:D1Database,sqlite:ReturnType<typeof sqliteD1>['sqlite'];
beforeEach(()=>{
  ({db,sqlite}=sqliteD1());
  sqlite.exec(`CREATE TABLE line_accounts(id TEXT PRIMARY KEY,is_active INTEGER);INSERT INTO line_accounts VALUES('account',1),('other',1);
    CREATE TABLE friends(id TEXT PRIMARY KEY,line_account_id TEXT);INSERT INTO friends VALUES('tester','account'),('customer','account'),('outsider','other');
    CREATE TABLE chats(id TEXT PRIMARY KEY,friend_id TEXT UNIQUE,status TEXT,notes TEXT,last_message_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE messages_log(id TEXT PRIMARY KEY,friend_id TEXT,direction TEXT,message_type TEXT,content TEXT,source TEXT,line_account_id TEXT,created_at TEXT);`);
  sqlite.exec(readFileSync(new NodeURL('../../../../packages/db/migrations/073_faq_releases.sql',import.meta.url),'utf8'));
  db.batch=async(statements)=>{sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results as any;}catch(e){sqlite.exec('ROLLBACK');throw e;}};
});
afterEach(()=>sqlite.close());
function app(role='admin'){
  const a=new Hono<any>();a.use('*',async(c,next)=>{c.set('staff',{id:'admin',role});await next();});a.route('/',faq);return a;
}
async function req(url:string,body?:unknown,method='POST',role='admin'){
  return app(role).request(url,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:db});
}
async function setup(){const release=await importFaq(db,'account',fixture(),'admin');await deployFaq(db,'account',release.id,'test',['tester'],'admin');return release;}
const messages:any[]=[];
function sendInput(value:string,kind:'text'|'postback'='text',friendId='tester',eventId=crypto.randomUUID()){
  return handleFaq(db,{accountId:'account',friendId,kind,value,eventId,send:async m=>{messages.push(m);}});
}
function button(kind:string,node?:string){return messages.at(-1).contents.body.contents.find((c:any)=>c.type==='button'&&c.action.type==='postback'&&(node?c.action.data.endsWith(`:${kind}:${node}`):c.action.data.includes(`:${kind}:`))).action.data;}

describe('FAQ import and staged release',()=>{
  it('imports an actual draft idempotently without enabling a deployment',async()=>{
    const a=await importFaq(db,'account',fixture(),'admin'),b=await importFaq(db,'account',{data:fixture(),schemaVersion:1},'admin');
    expect(a.id).toBe(b.id);expect(sqlite.prepare('SELECT count(*) AS n FROM faq_deployments').get()).toEqual({n:0});
    expect(JSON.parse(a.payload).nodes.a.body).toBe('回答です。\n日本語です。');
  });
  it('content hash is independent of object-key order',async()=>{
    const d=normalizeFaq(fixture());expect(await faqHash(d)).toBe(await faqHash({...d,nodes:Object.fromEntries(Object.entries(d.nodes).reverse())}));
  });
  it('rejects malformed parent/cycle/link and action-list JSON',()=>{
    expect(()=>normalizeFaq([{type:'add_tag'}])).toThrow();
    const d=normalizeFaq(fixture());d.nodes.a.parent='missing';expect(validateFaq(d).errors.length).toBeGreaterThan(0);
    d.nodes.a.parent='a';expect(validateFaq(d).errors.join()).toContain('循環');
    expect(()=>normalizeFaq({nodes:[{id:'root'},{id:'root'}]})).toThrow();
  });
  it('HTTP draft import, preview, and account isolation work without sending LINE',async()=>{
    const r=await req('/api/faq/accounts/account/releases',{payload:fixture()});expect(r.status).toBe(201);const id=(await r.json() as any).data.id;
    const p=await req(`/api/faq/accounts/account/releases/${id}/preview`,{nodeId:'a'});expect(p.status).toBe(200);expect((await p.json() as any).data.view.text).toContain('日本語');
    expect((await req(`/api/faq/accounts/other/releases/${id}`)).status).toBe(404);
    expect(sqlite.prepare('SELECT count(*) AS n FROM messages_log').get()).toEqual({n:0});
  });
  it('staff cannot mutate FAQ releases',async()=>{expect((await req('/api/faq/accounts/account/releases',{payload:fixture()},'POST','staff')).status).toBe(403);});
  it('requires production confirmation and validates test membership',async()=>{
    const r=await importFaq(db,'account',fixture(),'admin');
    expect((await req(`/api/faq/accounts/account/releases/${r.id}/activate`,{audience:'production'})).status).toBe(400);
    await expect(deployFaq(db,'account',r.id,'test',['outsider'],'admin')).rejects.toThrow();
    expect(sqlite.prepare('SELECT count(*) AS n FROM faq_deployments').get()).toEqual({n:0});
  });
  it('bad import or blocked release leaves the previous deployment intact',async()=>{
    const old=await setup();const d=fixture();d.nodes.a.status='要確認';const next=await importFaq(db,'account',d,'admin');
    await expect(deployFaq(db,'account',next.id,'production',[],'admin')).rejects.toThrow();
    const invalid=fixture();invalid.nodes.a.parent='missing';await expect(importFaq(db,'account',invalid,'admin')).rejects.toThrow();
    expect((sqlite.prepare('SELECT release_id FROM faq_deployments').get() as any).release_id).toBe(old.id);
  });
  it('production activation and rollback select only the chosen account',async()=>{
    const a=await importFaq(db,'account',fixture(),'admin');await deployFaq(db,'account',a.id,'production',[],'admin');
    const d=fixture();d.nodes.a.body='改訂';const b=await importFaq(db,'account',d,'admin');await deployFaq(db,'account',b.id,'production',[],'admin');await deployFaq(db,'account',a.id,'production',[],'admin');
    expect((sqlite.prepare("SELECT release_id FROM faq_deployments WHERE audience='production'").get() as any).release_id).toBe(a.id);
    expect(await getFaqRelease(db,'other',a.id)).toBeNull();
  });
});

describe('FAQ real database chat transitions with stubbed LINE transport',()=>{
  beforeEach(()=>{messages.length=0;});
  it('does not match customers outside the test allowlist or arbitrary text',async()=>{
    await setup();expect(await sendInput('FAQテスト','text','customer')).toBe(false);expect(await sendInput('こんにちは')).toBe(false);expect(messages).toHaveLength(0);
  });
  it('open testing is available to anyone only through the exact test keyword',async()=>{
    const release=await importFaq(db,'account',fixture(),'admin');await deployFaq(db,'account',release.id,'test',[],'admin',true);
    expect(await sendInput('FAQ','text','customer')).toBe(false);
    expect(await sendInput('FAQテストをしたい','text','customer')).toBe(false);
    expect(await sendInput('こんにちは','text','customer')).toBe(false);
    expect(await sendInput('FAQテスト','text','customer')).toBe(true);
    await sendInput(button('node','a'),'postback','customer');expect(messages.at(-1).contents.body.contents[0].text).toContain('日本語');
    expect(sqlite.prepare('SELECT count(*) AS n FROM chats').get()).toEqual({n:0});
  });
  it('public test and production keep separate entry points and stop invalidates test controls',async()=>{
    const release=await importFaq(db,'account',fixture(),'admin');await deployFaq(db,'account',release.id,'production',[],'admin');
    const data=fixture();data.nodes.a.body='テスト専用文面';const test=await importFaq(db,'account',data,'admin');await deployFaq(db,'account',test.id,'test',[],'admin',true);
    await sendInput('FAQ','text','customer');await sendInput(button('node','a'),'postback','customer');expect(messages.at(-1).contents.body.contents[0].text).toContain('日本語');
    await sendInput('FAQテスト','text','customer');const next=button('node','a');await sendInput(next,'postback','customer');expect(messages.at(-1).contents.body.contents[0].text).toContain('テスト専用文面');
    sqlite.exec("DELETE FROM faq_deployments WHERE audience='test'");const count=messages.length;await sendInput(next,'postback','customer');expect(messages.length).toBe(count);
  });
  it('navigates and marks resolved only after explicit confirmation',async()=>{
    await setup();await sendInput('FAQテスト');await sendInput(button('node','a'),'postback');
    expect((sqlite.prepare('SELECT outcome FROM faq_sessions').get() as any).outcome).toBe('answered');
    await sendInput(button('resolved'),'postback');expect((sqlite.prepare('SELECT outcome FROM faq_sessions').get() as any).outcome).toBe('resolved');
    expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('resolved');
  });
  it('unresolved button creates an unread chat and a useful note, duplicated event does not duplicate',async()=>{
    await setup();await sendInput('FAQテスト');await sendInput(button('node','a'),'postback');const control=button('handoff');
    await sendInput(control,'postback','tester','same-event');const sent=messages.length;await sendInput(control,'postback','tester','same-event');
    expect(messages.length).toBe(sent);const chat=sqlite.prepare('SELECT * FROM chats').get() as any;expect(chat.status).toBe('unread');expect(chat.notes).toContain('質問');
  });
  it('direct human branch becomes unread and operator completion clears pending consultations',async()=>{
    await setup();await sendInput('FAQテスト');await sendInput(button('node','h'),'postback');expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('unread');
    expect(messages.at(-1).contents.body.contents.some((b:any)=>b.type==='button')).toBe(false);
    expect(messages.at(-1).contents.body.contents[0].text).toContain('GameID');await closeFaqSessions(db,'tester');expect((sqlite.prepare('SELECT outcome FROM faq_sessions').get() as any).outcome).toBe('resolved');
  });
  it('customer resolution completes the chat and its earlier pending FAQ handoffs',async()=>{
    await setup();await sendInput('FAQテスト');await sendInput(button('node','h'),'postback');await sendInput('FAQテスト');await sendInput(button('node','a'),'postback');await sendInput(button('resolved'),'postback');
    expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('resolved');
    expect(sqlite.prepare("SELECT count(*) AS n FROM faq_sessions WHERE outcome='handoff'").get()).toEqual({n:0});
  });
  it('customer resolution changes an existing in-progress chat to completed',async()=>{
    sqlite.exec("INSERT INTO chats(id,friend_id,status,notes) VALUES('chat','tester','in_progress','既存案件')");
    await setup();await sendInput('FAQテスト');await sendInput(button('node','a'),'postback');await sendInput(button('resolved'),'postback');
    expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('resolved');
  });
  it('does not clear a new human message arriving while the FAQ is open',async()=>{
    await setup();await sendInput('FAQテスト');await sendInput(button('node','a'),'postback');const done=button('resolved');
    sqlite.exec("INSERT INTO chats(id,friend_id,status,notes) VALUES('chat','tester','unread','別件の相談'); INSERT INTO messages_log(id,friend_id,direction,message_type,content) VALUES('incoming-new','tester','incoming','text','別件の相談')");
    await sendInput(done,'postback');expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('unread');
  });
  it('rejects another friend/session controls and old completion controls after release changes',async()=>{
    const release=await setup();await sendInput('FAQテスト');await sendInput(button('node','a'),'postback');const old=button('resolved');
    await sendInput(old,'postback','customer');expect((sqlite.prepare('SELECT outcome FROM faq_sessions').get() as any).outcome).toBe('answered');
    const d=fixture();d.nodes.a.body='次版';const next=await importFaq(db,'account',d,'admin');await deployFaq(db,'account',next.id,'test',['tester'],'admin');await sendInput(old,'postback');
    expect((sqlite.prepare('SELECT outcome FROM faq_sessions WHERE release_id=?').get(release.id) as any).outcome).toBe('answered');
  });
  it('redirect retains its audit outcome but completes this accounts chat after delivery',async()=>{
    await setup();await sendInput('FAQテスト');await sendInput(button('node','r'),'postback');
    expect(messages.at(-1).contents.body.contents.some((b:any)=>b.action?.type==='uri')).toBe(true);expect((sqlite.prepare('SELECT outcome FROM faq_sessions').get() as any).outcome).toBe('redirected');expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('resolved');expect(messages.at(-1).contents.body.contents.some((b:any)=>b.action?.data?.includes(':handoff:'))).toBe(false);
  });
  it('completes an existing unread chat when the customer confirms resolution',async()=>{
    sqlite.exec("INSERT INTO chats(id,friend_id,status,notes) VALUES('chat','tester','unread','既存の問い合わせ')");
    await setup();await sendInput('FAQテスト');await sendInput(button('node','a'),'postback');await sendInput(button('resolved'),'postback');
    expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('resolved');
  });
  it('check replies with collection fields and enters the human queue without more choices',async()=>{
    const d=fixture();d.nodes.a={...d.nodes.a,type:'check',handoff:'H'} as any;
    const r=await importFaq(db,'account',d,'admin');await deployFaq(db,'account',r.id,'test',['tester'],'admin');
    await sendInput('FAQテスト');await sendInput(button('node','a'),'postback');
    expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('unread');
    expect(messages.at(-1).contents.body.contents[0].text).toContain('GameID');
    expect(messages.at(-1).contents.body.contents.some((b:any)=>b.type==='button')).toBe(false);
  });
  it('does not complete a redirect that has no destination',async()=>{
    const d=normalizeFaq(fixture());d.channels.C.url='';const view=faqView(d,'r');
    expect(view.outcome).toBe('handoff');expect(view.buttons).toEqual([]);
  });
  it('reply failure is visible in unread inbox and does not trigger paid push or repeated sends',async()=>{
    await setup();const send=vi.fn().mockRejectedValue(new Error('LINE unavailable')),log=vi.spyOn(console,'error').mockImplementation(()=>{});
    const input={accountId:'account',friendId:'tester',kind:'text' as const,value:'FAQテスト',eventId:'failure',send};
    await handleFaq(db,input);await handleFaq(db,input);expect(send).toHaveBeenCalledTimes(1);expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('unread');log.mockRestore();
  });
});

it.skipIf(!existsSync(new NodeURL('../../../../work/faq-test-release/release.json',import.meta.url)))('current user FAQ imports all 75 nodes without rewriting data or enabling replies',async()=>{
  const raw=JSON.parse(readFileSync(new NodeURL('../../../../work/faq-test-release/release.json',import.meta.url),'utf8'));
  const r=await importFaq(db,'account',raw,'admin'),d=JSON.parse(r.payload);
  expect(Object.keys(d.nodes)).toHaveLength(75);expect(d.nodes).toEqual(raw.data.nodes);expect(validateFaq(d).productionReady).toBe(false);
  for(const node of Object.values(d.nodes) as any[]){const view=faqView(d,node.id);expect(faqLineMessage(view,r.id,'preview').type).toBe('flex');}
});
