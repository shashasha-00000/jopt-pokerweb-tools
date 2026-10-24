import fs from 'node:fs';
import { normalizeFaq } from '../../apps/worker/src/services/faq-data.ts';
import { faqLineMessage, faqView } from '../../apps/worker/src/services/faq-render.ts';
const vars=Object.fromEntries(fs.readFileSync('apps/worker/.dev.vars','utf8').split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
const d=normalizeFaq(JSON.parse(fs.readFileSync('work/faq-test-release/faq-import.json','utf8')));
for(const node of ['root','games','entry','ticket','human']){const m=faqLineMessage(faqView(d,node),'faq_1dd82f3b405944b580b1e9300d035528','validation');let r=await fetch('https://api.line.me/v2/bot/message/validate/reply',{method:'POST',headers:{Authorization:'Bearer '+vars.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messages:[m]})});if(!r.ok)throw Error(node+' '+r.status+' '+await r.text());console.log(node+' LINE validation passed');}
