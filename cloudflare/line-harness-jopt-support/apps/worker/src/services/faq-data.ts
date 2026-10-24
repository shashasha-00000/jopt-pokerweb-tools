export interface FaqNode {
  id: string; parent?: string | null; label: string; type: 'menu'|'answer'|'check'|'redirect'|'handoff';
  body?: string; order?: number; channel?: string | null; handoff?: string | null;
  status?: string; per_event?: boolean; links?: string[];
}
export interface FaqRecord { id?: string; key?: string; name?: string; url?: string; status?: string; value?: string; text?: string; valid_until?: string; fields?: string[]; [key:string]: unknown }
export interface FaqData { nodes: Record<string,FaqNode>; channels: Record<string,FaqRecord>; handoffs: Record<string,FaqRecord>; vars: Record<string,FaqRecord>; messages: Record<string,FaqRecord>; events: Record<string,FaqRecord> }
export interface FaqValidation { errors: string[]; warnings: string[]; counts: Record<string,number>; productionReady: boolean }
export class FaqError extends Error {}
const idPattern=/^[A-Za-z0-9_.-]{1,64}$/;
function record(input: unknown, key='id'): Record<string,any> {
  if(input===undefined) return Object.create(null);
  if(!input || typeof input!=='object') throw new FaqError('各データは配列またはオブジェクトで指定してください');
  const out:Record<string,any>=Object.create(null);
  const entries=Array.isArray(input)?input.map(v=>[v?.[key],v]):Object.entries(input);
  if(entries.length>1500) throw new FaqError('項目数が上限を超えています');
  for(const [id,v] of entries) {
    if(typeof id!=='string'||!idPattern.test(id)||!v||typeof v!=='object'||Array.isArray(v)||Object.hasOwn(out,id)) throw new FaqError('IDが不正または重複しています');
    if(v[key]!==undefined && v[key]!==id) throw new FaqError(`IDが一致しません: ${id}`);
    out[id]={...v,[key]:id};
  }
  return out;
}
export function normalizeFaq(input: unknown): FaqData {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new FaqError('FAQ JSONを指定してください');
  const wrapper=input as Record<string,unknown>;
  if(wrapper.schemaVersion!==undefined && wrapper.schemaVersion!==1) throw new FaqError('未対応のschemaVersionです');
  const d=(wrapper.data??wrapper) as Record<string,unknown>;
  if(!d||typeof d!=='object'||!d.nodes) throw new FaqError('nodesがありません。アクションJSONではなくFAQ全体を選択してください');
  return {nodes:record(d.nodes),channels:record(d.channels),handoffs:record(d.handoffs),vars:record(d.vars,'key'),messages:record(d.messages),events:record(d.events)};
}
export function expandFaq(data:FaqData,text:string,eventId?:string,fields=''):string {
  const values:Record<string,string>=Object.create(null);
  for(const [k,v] of Object.entries(data.vars)) values[k]=String(v.value??'');
  for(const [k,v] of Object.entries(data.channels)) values[k]=String(v.url??'');
  for(const [k,v] of Object.entries(data.messages)) values[k]=String(v.text??'');
  const e=eventId?data.events[eventId]:undefined;
  if(e){
    const mapping:Record<string,string>={event_name:'name',event_dates:'dates',event_venue:'venue',players_guide_url:'guide_url',receipt_form_event:'receipt_form',receipt_send_deadline:'receipt_deadline',age_note:'age_note',media_form_url:'media_form',photo_album_url:'photo_url'};
    for(const [k,v] of Object.entries(mapping)) values[k]=String(e[v]??'');
  }
  values.fields=fields;
  let out=text;
  for(let i=0;i<8;i++){const next=out.replace(/\{\{\s*([\w]+)\s*\}\}/g,(m,k)=>Object.hasOwn(values,k)?values[k]:m);if(next===out)break;out=next;}
  const jp:Record<string,string>={'大会名':'event_name','日程':'event_dates','会場':'event_venue','ガイドURL':'players_guide_url','年齢制限':'age_note','領収書フォーム':'receipt_form_event','領収書送付期限':'receipt_send_deadline','写真アルバム':'photo_album_url','メディア申請':'media_form_url'};
  return out.replace(/【([^】]+)】/g,(m,k)=>jp[k]&&values[jp[k]]?values[jp[k]]:m);
}
export function validateFaq(d:FaqData,today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date())):FaqValidation {
  const errors:string[]=[],warnings:string[]=[];const counts:Record<string,number>=Object.create(null);
  if(!d.nodes.root||d.nodes.root.type!=='menu'||d.nodes.root.parent) errors.push('rootメニューが不正です');
  for(const n of Object.values(d.nodes)) {
    counts[n.type]=(counts[n.type]||0)+1;
    if(!['menu','answer','check','redirect','handoff'].includes(n.type)||typeof n.label!=='string'||!n.label.trim()||typeof n.body!=='string')errors.push(`${n.id}: 種類・名前・本文が不正です`);
    if(n.label?.length>40)errors.push(`${n.id}: ボタン名は40文字以内です`);
    if(n.id!=='root'&&!d.nodes[n.parent??''])errors.push(`${n.id}: 親メニューがありません`);
    if(n.parent&&d.nodes[n.parent]?.type!=='menu')errors.push(`${n.id}: 親はメニューにしてください`);
    let cur:FaqNode|undefined=n;const seen=new Set();while(cur){if(seen.has(cur.id)){errors.push(`${n.id}: メニューが循環しています`);break;}seen.add(cur.id);cur=d.nodes[cur.parent??''];}
    if(n.order!==undefined && (typeof n.order!=='number'||!Number.isFinite(n.order)))errors.push(`${n.id}: 並び順が不正です`);
    if(n.channel&&!d.channels[n.channel])errors.push(`${n.id}: 誘導先がありません`);
    if(n.handoff&&!d.handoffs[n.handoff])errors.push(`${n.id}: 担当者分類がありません`);
    if(n.type==='redirect'&&(!n.channel||!d.channels[n.channel]?.url)) errors.push(`${n.id}: 誘導先URLがありません`);
    if(n.links!==undefined&&(!Array.isArray(n.links)||n.links.some(id=>typeof id!=='string'||!d.nodes[id])))errors.push(`${n.id}: 関連メニューが不正です`);
    if(n.status!=='確認済')warnings.push(`${n.id}: 要確認`);
    const contexts=n.per_event?Object.values(d.events).filter(e=>e.active===true).map(e=>e.id):[undefined];
    if(!contexts.length)warnings.push(`${n.id}: 開催大会が未設定です`);
    for(const context of contexts){const text=expandFaq(d,typeof n.body==='string'?n.body:'',context);if((!text.trim()&&n.type!=='handoff')||/\{\{|（[^）]*入力[^）]*）|【(?:大会名|日程|会場|ガイドURL|年齢制限|領収書フォーム|領収書送付期限|写真アルバム|メディア申請)】/.test(text))warnings.push(`${n.id}${context?'/'+context:''}: 本文に未設定の値があります`);if(Array.from(text).length>8000)errors.push(`${n.id}: 本文が長すぎます（8000文字以内）`);}
  }
  for(const [id,ch] of Object.entries(d.channels)){
    if(ch.url){try{const u=new URL(ch.url);if(u.protocol!=='https:')throw 0;}catch{errors.push(`${id}: HTTPSのURLを指定してください`);}}
    if(ch.status!=='確認済')warnings.push(`${id}: 誘導先が要確認です`);
  }
  for(const [id,h] of Object.entries(d.handoffs))if(h.fields!==undefined&&(!Array.isArray(h.fields)||h.fields.some(f=>typeof f!=='string')))errors.push(`${id}: 聞き取り項目が不正です`);
  for(const [id,v] of Object.entries(d.vars))if(v.valid_until&&v.valid_until<today)warnings.push(`${id}: 有効期限切れ (${v.valid_until})`);
  for(const id of ['msg_root','msg_followup','msg_handoff_in','msg_handoff_out','msg_resolved'])if(typeof d.messages[id]?.text!=='string'||!d.messages[id].text?.trim())warnings.push(`${id}: 共通文面がありません`);
  return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],counts,productionReady:errors.length===0&&warnings.length===0};
}
function sorted(value:unknown):unknown{if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sorted(v)]));return value;}
export async function faqHash(data:FaqData):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(sorted(data)))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function faqButtons(d:FaqData,id:string){return Object.values(d.nodes).filter(n=>n.parent===id).sort((a,b)=>(a.order||0)-(b.order||0));}
