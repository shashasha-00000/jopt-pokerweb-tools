import { expandFaq, faqButtons, type FaqData } from './faq-data.js';
export interface FaqView {nodeId:string;eventId:string|null;text:string;buttons:Array<{label:string;nodeId?:string;action?:'resolved'|'handoff'|'event';eventId?:string;url?:string}>;outcome:'browsing'|'answered'|'redirected'|'handoff'}
export function faqView(d:FaqData,nodeId='root',eventId?:string|null):FaqView {
  const n=d.nodes[nodeId];if(!n)throw new Error('FAQ項目がありません');
  const view:FaqView={nodeId,eventId:eventId||null,text:'',buttons:[],outcome:n.type==='menu'?'browsing':n.type==='redirect'?'redirected':n.type==='handoff'?'handoff':'answered'};
  if(n.per_event&&!eventId){
    view.outcome='browsing';view.text=n.label;
    view.buttons=Object.values(d.events).filter(e=>e.active===true).map(e=>({label:String(e.name||e.id),action:'event' as const,eventId:e.id}));
  }else{
    view.text=expandFaq(d,n.body||'',eventId||undefined);
    view.buttons=faqButtons(d,nodeId).map(x=>({label:x.label,nodeId:x.id}));
    for(const id of n.links||[])if(d.nodes[id])view.buttons.push({label:d.nodes[id].label,nodeId:id});
    const ch=n.channel?d.channels[n.channel]:undefined;
    if(n.type==='redirect'||(n.type==='check'&&ch)){
      if(ch?.url)view.buttons.push({label:String(ch.name||n.label),url:ch.url});
      view.outcome=ch?.url?'redirected':'handoff';
    }
    if(n.type==='handoff'||n.type==='check'||view.outcome==='handoff'){
      view.outcome='handoff';
      const fields=n.handoff?(d.handoffs[n.handoff]?.fields||[]).map(f=>'・'+f).join('\n'):'';
      // Business hours are evaluated explicitly in Tokyo; use the source's own messages.
      const j=new Date(Date.now()+9*3600000),open=![0,3].includes(j.getUTCDay())&&j.getUTCHours()>=10&&j.getUTCHours()<19;
      const message=d.messages[open?'msg_handoff_in':'msg_handoff_out']?.text||'';
      view.text+='\n\n'+expandFaq(d,message,eventId||undefined,fields);
    }
    if(n.type==='answer'){
      view.text+='\n\n'+String(d.messages.msg_followup?.text||'');
      view.buttons.push({label:String(d.messages.msg_resolved?.title||'解決した'),action:'resolved'});
      view.buttons.push({label:d.nodes.human?.label||'担当者に相談',action:'handoff'});
    }

  }
  if(view.outcome==='handoff'){view.buttons=[];return view;}
  if(n.parent)view.buttons.push({label:'戻る',nodeId:n.parent});
  if(nodeId!=='root')view.buttons.push({label:d.nodes.root.label,nodeId:'root'});
  return view;
}
export function faqLineMessage(view:FaqView,release:string,session:string){
  const contents:Record<string,unknown>[]=[];const chars=Array.from(view.text||' ');
  for(let i=0;i<chars.length;i+=1500)contents.push({type:'text',text:chars.slice(i,i+1500).join(''),wrap:true,size:'sm',color:'#1B2624',lineSpacing:'5px'});
  if(view.buttons.length)contents.push({type:'separator',color:'#E0E8E3',margin:'lg'});
  for(const b of view.buttons){
    const action=b.url?{type:'uri',label:b.label.slice(0,40),uri:b.url}:{type:'postback',label:b.label.slice(0,40),displayText:b.label.slice(0,300),data:`faqv1:${release}:${session}:${b.action||'node'}:${b.nodeId||b.eventId||view.nodeId}`};
    const navigation=b.nodeId==='root'||b.label==='戻る';
    const resolved=b.action==='resolved';
    contents.push({type:'button',height:'sm',style:navigation?'link':resolved?'primary':'secondary',color:navigation?'#65766D':resolved?'#287653':'#EDF5F1',margin:'sm',action});
  }
  const message={type:'flex' as const,altText:view.text.slice(0,380)||'FAQ',contents:{type:'bubble' as const,size:'mega',styles:{body:{backgroundColor:'#FFFFFF'}},body:{type:'box' as const,layout:'vertical' as const,paddingAll:'16px',spacing:'sm',contents}}};
  if(new TextEncoder().encode(JSON.stringify(message.contents)).length>30000)throw new Error('LINEのメッセージ上限を超えています');
  return message;
}
