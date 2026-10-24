import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {base} from './build.mjs';
const routes={'/':['index.html','text/html; charset=utf-8'],'/release.json':['release.json','application/json; charset=utf-8'],'/validation.json':['validation.json','application/json; charset=utf-8'],'/test-results.json':['test-results.json','application/json; charset=utf-8']};
http.createServer((req,res)=>{
  const route=routes[new URL(req.url,'http://127.0.0.1').pathname];
  if(req.method!=='GET'||!route){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':route[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});
  res.end(fs.readFileSync(path.join(base,route[0])));
}).listen(8791,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8791'));
