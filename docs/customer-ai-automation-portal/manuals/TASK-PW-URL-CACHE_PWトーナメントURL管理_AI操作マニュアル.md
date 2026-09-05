# PWトーナメントURL管理 AI操作マニュアル

## AIへの依頼方法

このMD全文を自分のAIへ貼り付け、今回登録・確認・修復するイベント名とPokerWeb上の正式な大会名を追加してください。AIには操作するボタン、対象件数、削除範囲を実行前に確認させてください。

## 使用するツール

- PW URL Cache Manager（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-url-cache-manager.user.js

## URL Cacheの保存場所

URL CacheはGoogleアカウントやGoogle Driveには保存されません。PokerWebを開いている現在のブラウザ・ブラウザProfileのlocalStorageに、`PW_SHARED_TOURNAMENT_URL_CACHE_V1`として保存されます。

- 別のパソコンには自動共有されません。
- 同じパソコンでも、ChromeとEdge、または別のブラウザProfileでは別のCacheになります。
- PokerWebとPWツールを使用する同じブラウザ・同じProfileで操作します。

## 基本操作：イベント全体を登録する

1. 「Event Prefix」に対象イベントの共通部分を入力する。例：`【JOPT 2026 Grand Final】`
2. 「Build by Event Prefix」を押す。
3. ツールが以下のOPEN・CLOSED一覧を開き、全ページからPrefixを含む大会を収集する。
   - `/torneio/abertos`
   - `/torneio/fechados`
4. 完了後、OK件数とNG件数を確認する。
5. 「View Current Event」で現在のイベントだけを表示する。
6. 「Copy Sheet TSV Current」でSheet保存用TSVをコピーする。

## 基本操作：指定した大会名だけを検索する

Inputへ大会名を1行ずつ貼り付けます。`Name`の表頭は省略できます。

```tsv
Name
【JOPT 2026 Grand Final】#1 NLH
【JOPT 2026 Grand Final】#2 NLH Turbo
```

1. Inputへ大会名リストを貼り付ける。
2. 「Build by Names」を押す。
3. OPEN・CLOSEDの両方から各大会名を検索する。
4. 結果の`OK`、`NOT_FOUND`、`AMBIGUOUS`を確認する。
5. `AMBIGUOUS`は自動確定せず、候補URLを人が確認する。

## 正しいURLを直接登録する

正しいTournament IDまたはURLが分かっている場合は、次のTSVをInputへ貼り付けて「Import TSV」を押します。

```tsv
Name	TournamentId	URL	Actual_Name
正式な大会名	1234	https://japanopt.bt.pokerweb.com.br/torneio/painel/1234	PokerWeb画面に表示された大会名
```

`Actual_Name`は省略できます。Tournament IDまたはURLだけでは登録せず、必ず大会名も確認してください。

## 各ボタンの役割

- `Build by Event Prefix`：OPEN・CLOSED全ページから、Prefixを含む大会を一括収集する。
- `Build by Names`：Inputの大会名をOPEN・CLOSEDから一件ずつ検索する。
- `Import TSV`：確認済みのName、TournamentId、URLを現在のCacheへ追加する。
- `View Current Event`：Event Prefixに一致するCacheだけをOutputへ表示する。
- `Copy Sheet TSV Current`：現在イベントを`Name / TournamentId / URL / Actual_Name`の4列でコピーする。
- `Copy Sheet TSV All`：全イベントを4列TSVでコピーする。
- `Audit Current Event`：現在イベントの欠損、URLとIDの不一致、NameとActual_Nameの不一致、重複を確認する。
- `Repair Current Event Cache`：AuditのERROR対象を削除し、同じEvent Prefixを再スキャンする。
- `View All`：このブラウザに保存された全Cacheを表示する。
- `Copy Full Cache`：Source、SavedAt、Matched_Rowを含む全Cacheをコピーする。
- `Stop`：現在の一件が終わった後に検索を停止する。
- `Clear Current Event Cache`：Event Prefixに一致するCacheだけを削除する。
- `Clear All Cache`：このブラウザの全Cacheを削除する。
- `Replace All Cache From TSV`：入力TSVに存在しない既存Cacheも削除し、全Cacheを置換する。

## URL Cacheの汚染

過去に大会をスキャンした後でPokerWeb上の大会名が変更された場合、古い名前とURLがCacheに残ることがあります。同名大会を削除して作り直した場合や、確認していないTSVをImportした場合も、同じ名前に古いTournament IDが残る原因になります。

現在の大会URLとCacheが違う場合は、次の順番で処理します。

1. 「Copy Sheet TSV Current」で現在イベントをバックアップする。
2. 「Audit Current Event」を押し、ERRORとWARNを確認する。
3. 「人工核查 / 同名比赛URL冲突」に複数候補が出た場合は、それぞれの「打开URL」で実際の大会を確認する。
4. 正しい候補の「采用 Tournament ID 并清除其他记录」を押す。
5. AuditでERRORが出た場合は、内容を確認してから「Repair Current Event Cache」を実行する。
6. イベント全体が古い場合は、「Clear Current Event Cache」で対象イベントだけを削除し、「Build by Event Prefix」で再作成する。

少数の修正に「Replace All Cache From TSV」を使用しないでください。このボタンはTSVに存在しない他イベントのCacheも削除します。

## 完了確認

- Name、TournamentId、URL、Actual_Nameが同じ大会を示している。
- AuditのERRORが0件になっている。
- 同名複数候補を人が確認している。
- 必要なイベントのSheet用TSVを保存できている。
