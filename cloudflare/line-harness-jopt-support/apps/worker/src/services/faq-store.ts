import { FaqError, faqHash, normalizeFaq, validateFaq, type FaqData } from './faq-data.js';
export function faqNow(){return new Date(Date.now()+9*60*60*1000).toISOString().replace('Z','+09:00');}
export interface FaqRelease {id:string;account_id:string;content_hash:string;payload:string;validation:string;created_by:string;created_at:string}
export interface FaqDeployment {account_id:string;audience:'test'|'production';release_id:string;test_friend_ids:string;test_open:number;updated_at:string}
export async function importFaq(db:D1Database,accountId:string,input:unknown,actor:string){
  const data=normalizeFaq(input),validation=validateFaq(data);
  if(validation.errors.length)throw new FaqError(validation.errors.join('\n'));
  const hash=await faqHash(data),id='faq_'+crypto.randomUUID().replaceAll('-','');
  await db.prepare('INSERT OR IGNORE INTO faq_releases (id,account_id,content_hash,payload,validation,created_by,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,accountId,hash,JSON.stringify(data),JSON.stringify(validation),actor,faqNow()).run();
  return (await db.prepare('SELECT * FROM faq_releases WHERE account_id=? AND content_hash=?').bind(accountId,hash).first<FaqRelease>())!;
}
export async function getFaqRelease(db:D1Database,account:string,id:string){return db.prepare('SELECT * FROM faq_releases WHERE account_id=? AND id=?').bind(account,id).first<FaqRelease>();}
export async function deployFaq(db:D1Database,account:string,id:string,audience:'test'|'production',friends:string[],actor:string,openTest=false){
  const release=await getFaqRelease(db,account,id);if(!release)throw new FaqError('FAQバージョンがありません');
  const validation=validateFaq(JSON.parse(release.payload) as FaqData);
  if(validation.errors.length||(audience==='production'&&!validation.productionReady))throw new FaqError('未設定・要確認項目を修正してから公開してください');
  const ids=openTest?[]:[...new Set(friends)];if(audience==='test'&&!openTest&&(!ids.length||ids.length>30))throw new FaqError('テスト対象のHarness友だちIDを1〜30件指定してください');
  for(const friend of ids){if(!await db.prepare('SELECT id FROM friends WHERE id=? AND line_account_id=?').bind(friend,account).first())throw new FaqError('テスト友だちが選択中のLINEアカウントに属していません');}
  const now=faqNow();await db.batch([
    db.prepare(`INSERT INTO faq_deployments(account_id,audience,release_id,test_friend_ids,test_open,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,audience) DO UPDATE SET release_id=excluded.release_id,test_friend_ids=excluded.test_friend_ids,test_open=excluded.test_open,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(account,audience,id,JSON.stringify(audience==='test'?ids:[]),audience==='test'&&openTest?1:0,actor,now),
    db.prepare('INSERT INTO faq_release_audit(id,account_id,release_id,action,actor,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),account,id,'activate_'+audience,actor,now),
  ]);
  return {releaseId:id,audience,openTest:audience==='test'&&openTest,friendIds:audience==='test'?ids:[],validation};
}
export async function selectFaqDeployment(db:D1Database,account:string,friend:string,testOnly=false):Promise<FaqDeployment|null>{
  if(testOnly){const test=await db.prepare("SELECT * FROM faq_deployments WHERE account_id=? AND audience='test'").bind(account).first<FaqDeployment>();return test&&(test.test_open===1||(JSON.parse(test.test_friend_ids) as string[]).includes(friend))?test:null;}
  return db.prepare("SELECT * FROM faq_deployments WHERE account_id=? AND audience='production'").bind(account).first<FaqDeployment>();
}
export function publicRelease(r:FaqRelease){return {id:r.id,accountId:r.account_id,contentHash:r.content_hash,validation:validateFaq(JSON.parse(r.payload) as FaqData),createdBy:r.created_by,createdAt:r.created_at};}
