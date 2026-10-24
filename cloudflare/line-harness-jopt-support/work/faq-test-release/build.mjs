import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const base = path.dirname(fileURLToPath(import.meta.url));
export function compile(data) {
  const errors = [], warnings = [];
  const nodes = Object.values(data.nodes || {});
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (!byId.has('root')) errors.push('root is missing');
  if (byId.size !== nodes.length) errors.push('duplicate node IDs');
  for (const n of nodes) {
    if (!n.id || !n.label || !['menu','answer','check','redirect','handoff'].includes(n.type)) errors.push(`invalid node: ${n.id}`);
    if (n.id !== 'root' && !byId.has(n.parent)) errors.push(`missing parent: ${n.id}`);
    const seen = new Set(); let cursor = n;
    while (cursor) {
      if (seen.has(cursor.id)) { errors.push(`cycle: ${n.id}`); break; }
      seen.add(cursor.id); cursor = byId.get(cursor.parent);
    }
    if (n.channel && !data.channels?.[n.channel]) errors.push(`missing channel: ${n.id}`);
    if (n.handoff && !data.handoffs?.[n.handoff]) errors.push(`missing handoff: ${n.id}`);
    if (n.status !== '確認済') warnings.push({node:n.id,code:'REVIEW_REQUIRED'});
  }
  const checksum = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const prefix = `faq-test:${checksum.slice(0,8)}:`;
  const variables = Object.fromEntries(Object.entries(data.vars || {}).map(([k,v])=>[k,v.value || '']));
  for (const [k,v] of Object.entries(data.channels || {})) variables[k] = v.url || '';
  for (const [k,v] of Object.entries(data.messages || {})) variables[k] = v.text || '';
  const expand = (input,extra={}) => {
    let s = input || ''; const vars = {...variables,...extra};
    for (let i=0;i<8;i++) { const next=s.replace(/\{\{\s*([\w]+)\s*\}\}/g,(m,k)=>Object.hasOwn(vars,k)?vars[k]:m); if (s===next) break; s=next; }
    return s;
  };
  const postback = (label,data) => ({type:'button',height:'sm',action:{type:'postback',label:label.slice(0,40),data,displayText:label.slice(0,300)}});
  const rules = nodes.map(n => {
    const children=nodes.filter(x=>x.parent===n.id).sort((a,b)=>(a.order||0)-(b.order||0));
    let text=expand(n.body);
    if (!text.trim()) warnings.push({node:n.id,code:'EMPTY_BODY'});
    if (/\{\{|【[^】]+】|（[^）]*入力[^）]*）/.test(text)) warnings.push({node:n.id,code:'UNRESOLVED_VARIABLE_OR_PLACEHOLDER'});
    if (n.per_event) warnings.push({node:n.id,code:'EVENT_CONTEXT_REQUIRED',events:Object.keys(data.events||{})});
    const content = [{type:'text',text:n.label,weight:'bold',wrap:true,size:'lg'}];
    // Text must remain within Flex text limits; split without altering source text.
    const chars=Array.from(text || ' ');
    for(let i=0;i<chars.length;i+=1500) content.push({type:'text',text:chars.slice(i,i+1500).join(''),wrap:true,size:'sm'});
    const buttons=children.map(c=>postback(c.label,prefix+c.id));
    for (const id of n.links || []) if(byId.has(id)) buttons.push(postback(byId.get(id).label,prefix+id)); else errors.push(`missing linked node: ${n.id}/${id}`);
    if (n.type==='redirect' || (n.type==='check' && n.channel)) {
      const ch=data.channels?.[n.channel];
      if (ch?.url && /^https:\/\//.test(ch.url)) buttons.push({type:'button',height:'sm',action:{type:'uri',label:ch.name.slice(0,40),uri:ch.url}});
      else errors.push(`invalid redirect URL: ${n.id}`);
    }
    if(n.type==='answer' || n.type==='check') buttons.push(postback('解決した',prefix+'resolved:'+n.id));
    if(n.type!=='menu' && n.type!=='handoff') buttons.push(postback('担当者に相談',prefix+'handoff:'+n.id));
    if(n.parent) buttons.push(postback('戻る',prefix+n.parent));
    if(n.id!=='root') buttons.push(postback('最初に戻る',prefix+'root'));
    const contents={type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents:[...content,...buttons]}};
    return {sourceNodeId:n.id,sourceType:n.type,keyword:prefix+n.id,matchType:'exact',responseType:'flex',responseContent:JSON.stringify(contents),lineAccountId:null};
  });
  warnings.push({code:'SOURCE_ADMIN_EXPORT_DIFFERS',detail:'Captured from the simple editor getAll response, not the legacy admin export.'});
  for (const [key,v] of Object.entries(data.vars||{})) if(v.valid_until && v.valid_until<'2026-10-23') warnings.push({code:'EXPIRED_VARIABLE',key,date:v.valid_until});
  return {
    schemaVersion:1,kind:'harness-faq-test-candidate',releaseId:`faq-test-${checksum.slice(0,12)}`,
    createdAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'long'}).format(new Date()),
    source:{url:'https://script.google.com/a/macros/japanopenpoker.com/s/AKfycbxYnHkRif6scTpk6yrbKhlwfxVIB0WYQ5jU1vyM-LGtJnCgMSzivshc386MMrzmEsvt-g/exec?v=20',sha256:checksum},
    deployment:{status:'not_imported',targetAccountId:null,productionEnabled:false,remoteWritesPerformed:false},
    counts:Object.fromEntries(['menu','answer','check','redirect','handoff'].map(t=>[t,nodes.filter(n=>n.type===t).length])),
    testEntry:prefix+'root',rules,
    controls:nodes.filter(n=>n.type!=='menu').map(n=>({node:n.id,resolved:prefix+'resolved:'+n.id,handoff:prefix+'handoff:'+n.id,handoffType:n.handoff||'H_GENERAL',desiredStatus:{resolved:'resolved',handoff:'unread'}})),
    missingCapabilities:['FAQ batch import/staging is not registered in Harness','resolved/handoff postback controls require a chat-state handler','event-specific text and runtime fields need an adapter','a test LINE account or explicitly selected test audience is required'],
    validation:{errors:[...new Set(errors)],warnings,canCompile:errors.length===0,canReleaseProduction:false},
    data
  };
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=compile(JSON.parse(fs.readFileSync(path.join(base,'source.json'),'utf8')));
  fs.writeFileSync(path.join(base,'release.json'),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(base,'validation.json'),JSON.stringify(result.validation,null,2));
  console.log(JSON.stringify({releaseId:result.releaseId,counts:result.counts,rules:result.rules.length,errors:result.validation.errors,warnings:result.validation.warnings.length}));
  if(result.validation.errors.length) process.exitCode=1;
}
