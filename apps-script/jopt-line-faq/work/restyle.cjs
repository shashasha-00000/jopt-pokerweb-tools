const fs=require('fs');const p='apps-script/jopt-line-faq/';let s=fs.readFileSync(p+'work/Simple.before.html','utf8');
const start=s.indexOf('.simqr{'),end=s.indexOf('.secttl{',start);if(start<0||end<0)throw Error('CSS anchor');s=s.slice(0,start)+`.simqr{display:none}
.simflex{width:300px;max-width:100%;box-sizing:border-box;background:#fff;border:1px solid #e0e8e3;border-radius:16px;padding:16px;margin:0 0 10px;color:#1b2624;clear:both}
.simflextext{font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.simflextext a{color:#2a62c9;overflow-wrap:anywhere}
.simflexactions{display:flex;flex-direction:column;gap:8px;border-top:1px solid #e0e8e3;margin-top:16px;padding-top:8px}
.simflexactions button,.simflexactions span{box-sizing:border-box;width:100%;min-height:40px;border:0;border-radius:6px;background:#edf5f1;color:#1b2624;padding:9px 12px;font:inherit;font-size:14px;font-weight:500;text-align:center;overflow-wrap:anywhere;line-height:1.5;text-decoration:none}
.simflexactions button{cursor:pointer}
.simflexactions button:hover{background:#dfeee5}
.simflexactions .resolved{background:#287653;color:#fff}
.simflexactions .resolved:hover{background:#206344}
.simflexactions .sub{background:transparent;color:#65766d}
.simflexactions button:focus-visible{outline:2px solid #287653;outline-offset:2px}
`+s.slice(end);
const draw=s.indexOf('function simDraw(){'),drawEnd=s.indexOf('const TOP=',draw);if(draw<0||drawEnd<0)throw Error('Draw anchor');s=s.slice(0,draw)+`function simDraw(){
  const last=SIM.log[SIM.log.length-1];
  if(last&&last.who==='bot') last.choices=SIM.qr.slice();
  let html='';
  for(let i=0;i<SIM.log.length;i++){
    const m=SIM.log[i];
    if(m.who==='me'){html+=\`<div class="bub me">\${m.html}</div><div class="clr"></div>\`;continue;}
    const parts=[m.html];let tail=m,index=i;
    while(i+1<SIM.log.length&&SIM.log[i+1].who==='bot'){tail=SIM.log[++i];index=i;parts.push(tail.html);}
    const choices=tail.choices||[];
    html+=\`<div class="simflex"><div class="simflextext">\${parts.join('\\n\\n')}</div>\${choices.length?\`<div class="simflexactions">\${choices.map((q,k)=>\`<button data-message="\${index}" data-q="\${k}" class="\${q.sub?'sub':q.label==='解決した'?'resolved':''}">\${esc(q.label)}</button>\`).join('')}</div>\`:''}</div><div class="clr"></div>\`;
  }
  const c=$("#simChat");c.innerHTML=html;$("#simQr").innerHTML='';
  c.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{const q=SIM.log[+b.dataset.message].choices[+b.dataset.q];simMe(q.label);q.go();simDraw();});
  c.scrollTop=c.scrollHeight;
}
`+s.slice(drawEnd);
const prev=s.indexOf('function previewHtml(d){'),prevEnd=s.indexOf('/* ---------- 検索',prev);if(prev<0||prevEnd<0)throw Error('Preview anchor');s=s.slice(0,prev)+`function previewHtml(d){
  const card=(text,labels=[])=>\`<div class="simflex"><div class="simflextext">\${text}</div>\${labels.length?\`<div class="simflexactions">\${labels.map(x=>\`<span class="\${x==='最初に戻る'?'sub':x==='解決した'?'resolved':''}">\${esc(x)}</span>\`).join('')}</div>\`:''}</div>\`;
  let h=\`<div class="chat"><div class="bub me">\${esc(d.label||'（ボタン名）')}</div><div class="clr"></div>\`;
  let body=d.body||'';
  if(d.per_event){const evs=activeEvents();
    if(!evs.length)return h+card('⚠ 「開催大会」にLINE表示中の大会がありません。上の「📅 開催大会」から登録してください。')+'</div>';
    if(evs.length>1)h+=card('どの大会についてのお問い合わせですか？',evs.map(e=>e.name))+\`<div class="bub me">\${esc(evs[0].name)}</div><div class="clr"></div>\`;
    body=expandEv(body,evs[0]);}
  if(d.type==='redirect'&&d.channel&&S.channels[d.channel]&&!/\\{\\{\\s*ch_/.test(body))body+=(body?'\\n':'')+'{{'+d.channel+'}}';
  const fl=(d.fields||'').split(/\\n/).map(x=>x.trim()).filter(Boolean);
  const fm=()=>{const t=(S.messages.msg_handoff_in&&S.messages.msg_handoff_in.text)||'担当者が確認してご返信いたします。\\n{{fields}}';return esc(t).replace('{{fields}}',esc(fl.map(x=>'・'+x+'：').join('\\n')));};
  let text=expand(body)||'（返信文）',choices=[];
  if(d.type==='handoff')text+='\\n\\n'+fm();
  else if(d.type==='answer'||d.type==='check'){text+='\\n\\n'+expand((S.messages.msg_followup&&S.messages.msg_followup.text)||'ご不明点は解決しましたか？');choices=['解決した'];if(d.handoff)choices.push('担当者に相談');}
  choices.push('最初に戻る');h+=card(text,choices);
  if(d.type==='check'&&d.handoff)h+=\`<div style="color:#fff;margin-top:10px;font-size:12px">「担当者に相談」を押すと：</div>\`+card(fm());
  return h+'</div>';
}

`+s.slice(prevEnd);
for(const m of s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Function(m[1]);
fs.writeFileSync(p+'Simple.html',s);console.log('Updated Simple.html; JavaScript parse passed; bytes',Buffer.byteLength(s));
