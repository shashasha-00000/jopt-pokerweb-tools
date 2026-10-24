const fs=require('fs');const p='apps/worker/src/services/faq.test.ts';let s=fs.readFileSync(p,'utf8');s=s.replace("    expect(messages.at(-1).contents.body.contents[0].text).toContain('GameID');await closeFaqSessions", "    expect(messages.at(-1).contents.body.contents.some((b:any)=>b.type==='button')).toBe(false);\n    expect(messages.at(-1).contents.body.contents[0].text).toContain('GameID');await closeFaqSessions");s=s.replace("sqlite.exec(\"INSERT INTO chats(id,friend_id,status,notes) VALUES('chat','tester','unread','別件の相談')\");", "sqlite.exec(\"INSERT INTO chats(id,friend_id,status,notes) VALUES('chat','tester','unread','別件の相談'); INSERT INTO messages_log(id,friend_id,direction,message_type,content) VALUES('incoming-new','tester','incoming','text','別件の相談')\");");s=s.replace("it('redirect has a URI button and does not claim another LINE solved the issue'", "it('redirect retains its audit outcome but completes this accounts chat after delivery'");s=s.replace("outcome).toBe('redirected');", "outcome).toBe('redirected');expect((sqlite.prepare('SELECT status FROM chats').get() as any).status).toBe('resolved');expect(messages.at(-1).contents.body.contents.some((b:any)=>b.action?.data?.includes(':handoff:'))).toBe(false);");
const anchor="  it('reply failure is visible";const idx=s.indexOf(anchor);s=s.slice(0,idx)+`  it('completes an existing unread chat when the customer confirms resolution',async()=>{
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
`+s.slice(idx);fs.writeFileSync(p,s);
