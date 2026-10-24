// Loopback-only QA host for the actual Harness FAQ page/routes. Never deploy this file.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from '../../apps/worker/node_modules/hono/dist/index.js';
import { sqliteD1 } from '../../apps/worker/src/test-support/sqlite-d1.js';
import { authMiddleware } from '../../apps/worker/src/middleware/auth.js';
import { adminAuth } from '../../apps/worker/src/routes/admin-auth.js';
import { faq } from '../../apps/worker/src/routes/faq.js';
import { lineAccounts } from '../../apps/worker/src/routes/line-accounts.js';
import { friends } from '../../apps/worker/src/routes/friends.js';
import { handleFaq } from '../../apps/worker/src/services/faq-runtime.js';
const base=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(base,'../..'),out=path.join(root,'apps/web/out');
const {db,sqlite}=sqliteD1(path.join(base,'harness-local.sqlite'));
sqlite.exec(fs.readFileSync(path.join(root,'packages/db/bootstrap.sql'),'utf8'));
if(!(sqlite.prepare('PRAGMA table_info(faq_deployments)').all() as {name:string}[]).some(c=>c.name==='test_open'))sqlite.exec('ALTER TABLE faq_deployments ADD COLUMN test_open INTEGER NOT NULL DEFAULT 0');
sqlite.prepare('INSERT OR IGNORE INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('local-faq-account','local-channel','ローカル検証用（LINE未接続）','not-a-line-token','not-a-line-secret');
sqlite.prepare('INSERT OR IGNORE INTO friends(id,line_user_id,line_account_id,display_name) VALUES(?,?,?,?)').run('local-faq-tester','local-line-user','local-faq-account','ローカルテスター');
db.batch=async(statements)=>{sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results as any;}catch(e){sqlite.exec('ROLLBACK');throw e;}};
const app=new Hono<any>();app.use('/api/*',authMiddleware as any);
app.route('/',adminAuth);app.route('/',faq);
app.get('/api/line-accounts/delivery-health',c=>c.json({success:true,data:[]}));
app.get('/api/inbox/unanswered',c=>c.json({success:true,data:[],total:0}));
app.get('/api/notifications',c=>c.json({success:true,data:[]}));
app.get('/api/qa/source',c=>c.json(JSON.parse(fs.readFileSync(path.join(base,'release.json'),'utf8'))));
app.post('/api/qa/line',async c=>{const b=await c.req.json();const messages:unknown[]=[];const handled=await handleFaq(db,{accountId:'local-faq-account',friendId:'local-faq-tester',kind:b.kind==='postback'?'postback':'text',value:String(b.value),eventId:crypto.randomUUID(),send:async m=>{messages.push(m);}});return c.json({handled,messages,chats:sqlite.prepare('SELECT status,notes FROM chats').all()});});
app.route('/',lineAccounts);
app.route('/',friends);
const env={DB:db,API_KEY:'local-faq-test-only',ADMIN_PUBLIC_URL:'http://127.0.0.1:8792',WORKER_PUBLIC_URL:'http://127.0.0.1:8792'};
// Any service accidentally attempting a real external request fails locally.
globalThis.fetch=async()=>{throw new Error('External network is disabled in the local QA host');};
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon'};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/','http://127.0.0.1:8792');
    if(url.pathname.startsWith('/api/')){
      const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const request=new Request(url,{method:req.method,headers:req.headers as Record<string,string>,...(!['GET','HEAD'].includes(req.method||'GET')?{body:Buffer.concat(chunks)}:{})});
      const response=await app.fetch(request,env);const headers:Record<string,string|string[]>=Object.fromEntries([...response.headers.entries()].filter(([k])=>k!=='set-cookie'));const cookies=response.headers.getSetCookie();if(cookies.length)headers['Set-Cookie']=cookies;res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    let target=path.resolve(out,'.'+decodeURIComponent(url.pathname));
    if(!target.startsWith(out+path.sep)&&target!==out){res.writeHead(403);res.end();return;}
    if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
    if(!fs.existsSync(target)&&fs.existsSync(target+'.html'))target+='.html';
    if(!fs.existsSync(target)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(fs.readFileSync(target));
  }catch(error){console.error(error);res.writeHead(500);res.end('Local QA error');}
}).listen(8792,'127.0.0.1',()=>console.log('Local Harness FAQ: http://127.0.0.1:8792/faq'));
