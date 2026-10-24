const fs=require('fs');const p='apps/worker/src/services/faq-webhook.test.ts';let s=fs.readFileSync(p,'utf8');const marker="expect(network).not.toHaveBeenCalled();";s=s.replace(marker,`expect(network).not.toHaveBeenCalled();
    await post('FAQテスト');
    const next=messages.at(-1).contents.body.contents.find((c:any)=>c.action?.data?.endsWith(':node:a')).action.data;
    await post(next,true);const done=messages.at(-1).contents.body.contents.find((c:any)=>c.action?.data?.includes(':resolved:')).action.data;
    await post(done,true);expect((sqlite.prepare('SELECT status FROM chats WHERE friend_id=?').get('test-friend') as any).status).toBe('resolved');
    expect(sqlite.prepare("SELECT count(*) AS n FROM faq_sessions WHERE outcome='handoff'").get()).toEqual({n:0});`);fs.writeFileSync(p,s);
