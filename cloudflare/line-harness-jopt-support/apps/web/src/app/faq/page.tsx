'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api, fetchApi, getCsrfToken } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'

type Validation={errors:string[];warnings:string[];counts:Record<string,number>;productionReady:boolean}
type Release={id:string;createdAt:string;validation:Validation}
type Deployment={audience:string;release_id:string;test_friend_ids:string;test_open:number}
type View={nodeId:string;eventId:string|null;text:string;outcome:string;buttons:Array<{label:string;nodeId?:string;action?:string;eventId?:string;url?:string}>}
type Result<T>={success:boolean;data:T;error?:string}
const panel='rounded-xl border border-gray-200 bg-white p-5 space-y-4'
const button='rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 hover:bg-gray-50'

export default function FaqPage(){
  const {selectedAccountId,selectedAccount}=useAccount()
  const [raw,setRaw]=useState(''),[validation,setValidation]=useState<Validation|null>(null)
  const [releases,setReleases]=useState<Release[]>([]),[deployments,setDeployments]=useState<Deployment[]>([])
  const [selected,setSelected]=useState(''),[friends,setFriends]=useState(''),[confirmed,setConfirmed]=useState(false)
  const [friendQuery,setFriendQuery]=useState(''),[friendHits,setFriendHits]=useState<Array<{id:string;displayName:string}>>([])
  const [openTest,setOpenTest]=useState(true)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[view,setView]=useState<View|null>(null)
  const root=selectedAccountId?`/api/faq/accounts/${encodeURIComponent(selectedAccountId)}`:''
  const call=async<T,>(url:string,body?:unknown,method?:string)=>{
    const response=await fetch(`${getApiBase()}${url}`,{credentials:'include',method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-CSRF-Token':getCsrfToken()},...(body===undefined?{}:{body:JSON.stringify(body)})})
    const r=await response.json() as Result<T>
    if(!response.ok)throw new Error(r.error||`API error: ${response.status}`)
    if(!r.success)throw new Error(r.error||'処理に失敗しました');return r.data
  }
  const load=useCallback(async()=>{
    if(!selectedAccountId)return
    const r=await fetchApi<Result<{releases:Release[];deployments:Deployment[]}>>(`/api/faq/accounts/${encodeURIComponent(selectedAccountId)}`)
    if(r.success){setReleases(r.data.releases);setDeployments(r.data.deployments)}
  },[selectedAccountId])
  useEffect(()=>{setSelected('');setView(null);setValidation(null);setReleases([]);setDeployments([]);setFriends('');setFriendHits([]);setFriendQuery('');setConfirmed(false);setMessage('');void load().catch(e=>setMessage(String(e)))},[load])
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(e instanceof Error?e.message:'処理に失敗しました')}finally{setBusy(false)}}
  const preview=async(id:string,nodeId='root',eventId?:string|null)=>{setView(await call<{view:View}>(`${root}/releases/${encodeURIComponent(id)}/preview`,{nodeId,eventId:eventId||undefined}).then(r=>r.view))}
  const chosen=releases.find(r=>r.id===selected)
  const changeRaw=(v:string)=>{setRaw(v);setValidation(null)}
  return <>
    <Header title="FAQ管理" description="JSONを下書きとして取り込み、プレビュー・対象者限定テストの後にリリースします。" />
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <p className="rounded-lg bg-amber-50 p-4 text-sm">取込・プレビューだけではLINEに配信されません。テスト中は「FAQテスト」と送信した人だけがテスト版を利用できます。通常のメッセージやメニューは変更しません。</p>
      <p>対象：<strong>{selectedAccount?.displayName||selectedAccount?.name||'LINEアカウントを選択してください'}</strong></p>
      <section className={panel}>
        <h2 className="text-lg font-bold">1. JSONを取り込む</h2>
        <input aria-label="FAQ JSONファイル" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2*1024*1024){setMessage('2MB以内のファイルを選択してください');return}void f.text().then(changeRaw).catch(()=>setMessage('ファイルを読み込めませんでした'))}} />
        <textarea aria-label="FAQ JSONを貼り付け" placeholder="FAQ全体のJSONをここに貼り付けるか、ファイルを選択してください" className="block h-44 w-full rounded border p-3 font-mono text-xs" value={raw} onChange={e=>changeRaw(e.target.value)} />
        <div className="flex flex-wrap gap-3">
          <button className={button} disabled={busy||!raw} onClick={()=>void run(async()=>{setValidation(await call<Validation>('/api/faq/validate',{payload:JSON.parse(raw)}));setMessage('チェックが完了しました。まだ取り込まれていません。')})}>チェック</button>
          <button className={button} disabled={busy||!root||!validation||!!validation.errors.length} onClick={()=>void run(async()=>{const r=await call<Release>(root+'/releases',{payload:JSON.parse(raw)});await load();setSelected(r.id);await preview(r.id);setMessage('下書きとして取り込みました。テスト・正式リリースはまだ開始していません。')})}>下書きとして取り込む</button>
        </div>
        {validation&&<div><p>{Object.entries(validation.counts).map(([k,n])=>`${({menu:'メニュー',answer:'ボット回答',check:'確認案内',redirect:'別LINE誘導',handoff:'担当者対応'} as Record<string,string>)[k]||k}: ${n}`).join(' ／ ')}</p><ul className="text-red-700">{validation.errors.map(x=><li key={x}>{x}</li>)}</ul><details><summary>確認事項 {validation.warnings.length}件</summary><ul>{validation.warnings.map(x=><li key={x}>{x}</li>)}</ul></details></div>}
      </section>
      <section className={panel}>
        <h2 className="text-lg font-bold">2. バージョンとプレビュー</h2>
        <select aria-label="FAQバージョン" className="max-w-full rounded border p-2" value={selected} disabled={busy} onChange={e=>{const id=e.target.value;setSelected(id);setConfirmed(false);setView(null);if(id)void run(()=>preview(id))}}><option value="">バージョンを選択</option>{releases.map(r=><option key={r.id} value={r.id}>{r.createdAt} ／ {r.id}</option>)}</select>
        {chosen&&<p>正式公開：{chosen.validation.productionReady?'公開可能':'未設定・要確認項目の修正が必要'} ／ 確認事項 {chosen.validation.warnings.length}件</p>}
        {chosen&&<details><summary>このバージョンの確認事項</summary><ul>{chosen.validation.warnings.map(x=><li key={x}>{x}</li>)}</ul></details>}
        {view&&<div className="rounded-xl bg-green-50 p-5"><p className="whitespace-pre-wrap">{view.text}</p><div className="mt-4 flex flex-wrap gap-2">{view.buttons.map((b,i)=><button className={button} key={i} disabled={busy} onClick={()=>{if(b.url){setMessage('誘導先：'+b.url);return}if(b.action==='resolved'||b.action==='handoff'){setMessage('プレビューです。実際のチャット状態は変更しません。LINEテストで状態変更を確認できます。');return}void run(()=>preview(selected,b.nodeId||view.nodeId,b.eventId||view.eventId))}}>{b.label}</button>)}</div><p className="mt-3 text-xs">プレビューのみ：送信・チャット状態更新は行いません。</p></div>}
      </section>
      <section className={panel}>
        <h2 className="text-lg font-bold">3. キーワードでテスト</h2>
        <label className="block"><input type="checkbox" checked={openTest} onChange={e=>setOpenTest(e.target.checked)} /> 「FAQテスト」と送信した人は誰でもテスト可能にする</label>
        <p className="text-sm">テスト開始後、公式LINEに「FAQテスト」と送信してください。完全一致したときだけ開始します。正式メニューへのボタン追加は行いません。</p>
        {!openTest&&<div className="space-y-3"><p className="text-sm">テストする個人LINEを表示名で検索して選択してください（最大30人）。LINEのログインIDやメールアドレスは不要です。</p>
        <div className="flex gap-2"><input aria-label="テスト友だちの表示名" className="rounded border p-2" value={friendQuery} onChange={e=>setFriendQuery(e.target.value)} placeholder="LINEの表示名" /><button className={button} disabled={busy||!root} onClick={()=>void run(async()=>{const result=await api.friends.list({accountId:selectedAccountId!,search:friendQuery,includeTags:false,limit:20});if(result.success)setFriendHits(result.data.items);else throw new Error('検索に失敗しました')})}>友だちを検索</button></div>
        {friendHits.map(f=><label key={f.id} className="block"><input type="checkbox" checked={friends.split(/[\s,]+/).includes(f.id)} onChange={e=>setFriends([...new Set(e.target.checked?[...friends.split(/[\s,]+/).filter(Boolean),f.id]:friends.split(/[\s,]+/).filter(id=>id&&id!==f.id))].join('\n'))} /> {f.displayName||'名前なし'} <small>({f.id.slice(0,8)})</small></label>)}
        <p className="text-sm">選択中：{friends.split(/[\s,]+/).filter(Boolean).length}人</p>
        <details><summary>友だちIDを直接指定する（詳細設定）</summary><textarea aria-label="テスト対象のHarness友だちID" className="block h-24 w-full rounded border p-3" value={friends} onChange={e=>setFriends(e.target.value)} /></details></div>}
        <button className={button} disabled={busy||!selected||(!openTest&&!friends.trim())} onClick={()=>void run(async()=>{await call(`${root}/releases/${selected}/activate`,{audience:'test',openTest,friendIds:openTest?[]:friends.split(/[\s,]+/).filter(Boolean)});await load();setMessage(openTest?'キーワード公開テストを開始しました。「FAQテスト」と送信した人だけが利用できます。':'指定した友だち限定でテストを開始しました。「FAQテスト」と送信してください。')})}>このバージョンでテスト開始</button>
        <button className={button} disabled={busy||!root} onClick={()=>void run(async()=>{await call(root+'/deployments/test',undefined,'DELETE');await load();setMessage('テストを停止しました。')})}>テスト停止</button>
      </section>
      <section className={panel}>
        <h2 className="text-lg font-bold">4. 正式リリース・旧版への復元</h2>
        <p className="text-sm">公開後は「FAQ」で開始できます。旧版に戻す場合は、そのバージョンを選択してリリースします。</p>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} /> 選択中のLINEアカウント全体に公開することを確認しました</label>
        <button className={button} disabled={busy||!selected||!confirmed||!chosen?.validation.productionReady} onClick={()=>void run(async()=>{await call(`${root}/releases/${selected}/activate`,{audience:'production',confirmProduction:true});await load();setConfirmed(false);setMessage('正式リリースしました。')})}>正式リリース</button>
        <button className={button} disabled={busy||!root||!confirmed} onClick={()=>void run(async()=>{await call(root+'/deployments/production',undefined,'DELETE');await load();setMessage('正式版FAQを停止しました。')})}>正式版を停止</button>
        <ul>{deployments.map(d=><li key={d.audience}>{d.audience==='test'?(d.test_open?'キーワード公開テスト中':'友だち限定テスト中'):'正式公開中'}：{d.release_id}</li>)}</ul>
      </section>
      {message&&<p role="status" className="whitespace-pre-wrap rounded border bg-white p-4">{message}</p>}
    </main>
  </>
}
