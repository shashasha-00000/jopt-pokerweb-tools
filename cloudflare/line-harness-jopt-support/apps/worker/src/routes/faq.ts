import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../index.js';
import { FaqError, normalizeFaq, validateFaq, type FaqData } from '../services/faq-data.js';
import { deployFaq, faqNow, getFaqRelease, importFaq, publicRelease, type FaqRelease } from '../services/faq-store.js';
import { faqLineMessage, faqView } from '../services/faq-render.js';

export const faq = new Hono<Env>();
faq.onError((e,c)=>{
  if(e instanceof FaqError || e instanceof SyntaxError)return c.json({success:false,error:e.message},400);
  console.error('[faq] operation failed',e);
  return c.json({success:false,error:'FAQの処理に失敗しました。073_faq_releases.sql の適用状態を確認してください'},500);
});
faq.use('/api/faq/*',bodyLimit({maxSize:2*1024*1024,onError:c=>c.json({success:false,error:'JSONは2MB以内にしてください'},413)}));
faq.use('/api/faq/*',async(c,next)=>{
  const staff=c.get('staff');
  if(!staff)return c.json({success:false,error:'Unauthorized'},401);
  if(c.req.method!=='GET'&&staff.role==='staff')return c.json({success:false,error:'管理者権限が必要です'},403);
  return next();
});
async function requireAccount(db:D1Database,id:string){if(!await db.prepare('SELECT id FROM line_accounts WHERE id=? AND is_active=1').bind(id).first())throw new FaqError('有効なLINEアカウントを選択してください');}
faq.post('/api/faq/validate',async c=>{
  const body=await c.req.json<{payload:unknown}>();const data=normalizeFaq(body.payload);
  return c.json({success:true,data:validateFaq(data)});
});
faq.get('/api/faq/accounts/:accountId',async c=>{
  const account=c.req.param('accountId');await requireAccount(c.env.DB,account);
  const releases=await c.env.DB.prepare('SELECT * FROM faq_releases WHERE account_id=? ORDER BY created_at DESC LIMIT 50').bind(account).all<FaqRelease>();
  const deployments=await c.env.DB.prepare('SELECT account_id,audience,release_id,test_friend_ids,test_open,updated_at FROM faq_deployments WHERE account_id=?').bind(account).all();
  return c.json({success:true,data:{releases:releases.results.map(publicRelease),deployments:deployments.results}});
});
faq.post('/api/faq/accounts/:accountId/releases',async c=>{
  const account=c.req.param('accountId');await requireAccount(c.env.DB,account);
  const body=await c.req.json<{payload:unknown}>();const release=await importFaq(c.env.DB,account,body.payload,c.get('staff').id);
  return c.json({success:true,data:publicRelease(release)},201);
});
faq.get('/api/faq/accounts/:accountId/releases/:id',async c=>{
  const release=await getFaqRelease(c.env.DB,c.req.param('accountId'),c.req.param('id'));
  if(!release)return c.json({success:false,error:'Not found'},404);
  return c.json({success:true,data:{...publicRelease(release),payload:JSON.parse(release.payload)}});
});
faq.post('/api/faq/accounts/:accountId/releases/:id/preview',async c=>{
  const release=await getFaqRelease(c.env.DB,c.req.param('accountId'),c.req.param('id'));
  if(!release)return c.json({success:false,error:'Not found'},404);
  const b=await c.req.json<{nodeId?:string;eventId?:string}>();const data=JSON.parse(release.payload) as FaqData;
  if(!data.nodes[b.nodeId||'root']||(b.eventId&&!data.events[b.eventId]))throw new FaqError('項目または開催大会がありません');
  const view=faqView(data,b.nodeId||'root',b.eventId);
  return c.json({success:true,data:{view,lineMessage:faqLineMessage(view,release.id,'preview')}});
});
faq.post('/api/faq/accounts/:accountId/releases/:id/activate',async c=>{
  const account=c.req.param('accountId');await requireAccount(c.env.DB,account);
  const b=await c.req.json<{audience?:string;friendIds?:unknown;confirmProduction?:boolean;openTest?:boolean}>();
  if(b.audience!=='test'&&b.audience!=='production')throw new FaqError('test / production を指定してください');
  if(b.audience==='production'&&b.confirmProduction!==true)throw new FaqError('正式公開の確認が必要です');
  if(b.friendIds!==undefined&&(!Array.isArray(b.friendIds)||b.friendIds.some(id=>typeof id!=='string')))throw new FaqError('friendIdsが不正です');
  if(b.openTest!==undefined&&typeof b.openTest!=='boolean')throw new FaqError('openTestが不正です');
  return c.json({success:true,data:await deployFaq(c.env.DB,account,c.req.param('id'),b.audience,(b.friendIds||[]) as string[],c.get('staff').id,b.openTest===true)});
});
faq.delete('/api/faq/accounts/:accountId/deployments/:audience',async c=>{
  const account=c.req.param('accountId'),audience=c.req.param('audience');await requireAccount(c.env.DB,account);
  if(!['test','production'].includes(audience))throw new FaqError('対象が不正です');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM faq_deployments WHERE account_id=? AND audience=?').bind(account,audience),
    c.env.DB.prepare('INSERT INTO faq_release_audit(id,account_id,action,actor,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),account,'stop_'+audience,c.get('staff').id,faqNow()),
  ]);
  return c.json({success:true});
});
