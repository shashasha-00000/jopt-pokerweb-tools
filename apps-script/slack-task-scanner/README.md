# Slack タスク自動整理 + 中文「任务雷达」（Google Apps Script）

Slack で自分または Customer Team（`@cs`）が mention されたメッセージと、自分が発言したthreadを2時間ごとに検索し、Google Spreadsheetへ重複なく追加・更新します。同じデータを中国語のWeb App「任务雷达」で確認・操作できます。OpenAI APIは使用しません。

## 重要な仕様

- 対象 Spreadsheet ID: `1GU_7gpdV8PeU07JLq4MsG2lmtPJaDegJejwhQBrTsCs`（`sha タスク`）
- 対象 Sheet: `シート1`
- A:J は追加時の書き込みと指定項目の更新だけに使用し、列構成や既存見出しは変更しません。
- K:AD は初回の `setupProject()` / `setupDashboard()` / `scanSlackTasks()` で不足見出しだけを追加します。
- S:V はWeb App用の `任务 ID` / `提醒时间` / `置顶` / `最后界面操作` です。
- WはSlack候補の処理段階、X:Zは `截止日期` / `Calendar Event ID` / `同步日历` です。
- AA:ADは `关联任务 ID` / `Slack 最新消息 TS` / `Slack 新进展` / `Slack 最新进展摘要` です。
- K列は checkbox です。`TRUE` の行は、その後一切更新しません。
- A列が `已完成` の行も、その後一切更新しません。
- 一意キーは `Slack Channel ID + Slack Thread TS`、threadがない場合は `Slack Channel ID + Slack Message TS` です。
- 既存行では A / F / H / I / J / R とSlack追跡用のAB:ADだけを更新します。ユーザーが編集した B / C / D などは上書きしません。
- Sheetへ表示する日付は `Asia/Tokyo` の `yyyy/MM/dd` です。
- Apps Script project と Spreadsheet の両方を `Asia/Tokyo` にしてください。コードは Spreadsheet の設定が異なる場合、安全のため停止します。

## Slack token の選択

このツールは **user token（`xoxp-...`）が必須** です。Script Properties のキーは `SLACK_USER_TOKEN` です。

Slack の `search.messages` は `search:read` を持つ user token のみを受け付けます。bot token（`xoxb-...`）では全 Workspace の mention 検索を実行できないため、本ツールは `SLACK_BOT_TOKEN` を使用しません。

また、検索結果は token のユーザーが Slack 上で閲覧できるメッセージに限られます。Slack の `search.messages` は現在 legacy method ですが、GASから定期的に既存Workspaceを検索する本MVPでは実際に利用可能な方法です。

公式資料:

- [search.messages](https://docs.slack.dev/reference/methods/search.messages/)
- [conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies/)
- [chat.getPermalink](https://docs.slack.dev/reference/methods/chat.getPermalink/)
- [Slack Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)

## 1. Slack App を作成する

1. [Slack API: Your Apps](https://api.slack.com/apps) を開きます。
2. `Create New App` → `From scratch` を選びます。
3. App名を入力し、対象の `jopthq` Workspaceを選びます。
4. 作成後、左メニューの `OAuth & Permissions` を開きます。

## 2. User Token Scopes を設定する

`OAuth & Permissions` → `Scopes` → **User Token Scopes** に次を追加します。Bot Token Scopesではありません。

| Scope | 用途 |
|---|---|
| `search:read` | Workspace内のmention検索 |
| `channels:history` | public channelのthread取得 |
| `groups:history` | private channelのthread取得 |
| `im:history` | DMのthread取得 |
| `mpim:history` | group DMのthread取得 |
| `channels:read` | public channel名の取得 |
| `groups:read` | private channel名の取得 |
| `im:read` | DM情報の取得 |
| `mpim:read` | group DM情報の取得 |
| `users:read` | requester表示名の取得 |

メールアドレスは取得しないため `users:read.email` は不要です。対象をpublic/private channelだけに限定するなら、DM用の `im:*` / `mpim:*` は省略できます。ただし、その会話種別にmentionが存在した場合はthread情報を取得できません。

## 3. Workspaceへインストールし token を取得する

1. `OAuth & Permissions` 上部の `Install to Workspace` を押します。
2. 表示された権限を確認して許可します。
3. 同じ画面の `OAuth Tokens for Your Workspace` にある **User OAuth Token**（`xoxp-...`）をコピーします。
4. Scopeを後から変更した場合は、`Reinstall to Workspace` を実行してtokenへ反映します。

tokenはパスワードと同様に扱い、`.gs`、README、Git、Sheetのセルへ書かないでください。

## 4. GAS project を作成してファイルを配置する

### Spreadsheetに紐づける場合

1. 対象 Spreadsheet を開きます。
2. `拡張機能` → `Apps Script` を開きます。
3. このディレクトリの `Config.gs` / `Code.gs` / `Slack.gs` / `Classifier.gs` / `Sheet.gs` / `Dashboard.gs` / `Index.html` の内容を同名ファイルとして追加します。
4. Project設定で `appsscript.json` の表示を有効にし、このディレクトリのmanifest内容へ合わせます。

standalone GAS projectへ配置しても動作します。コードは `SpreadsheetApp.openById()` を使用するため、どちらの場合も対象Spreadsheetは固定IDで開きます。

## 5. 日付・タイムゾーンを確認する

1. Apps Script の `プロジェクトの設定` でタイムゾーンが `Asia/Tokyo` であることを確認します。
2. Spreadsheetで `ファイル` → `設定` → `タイムゾーン` を `（GMT+09:00）東京` にします。
3. このprojectの `appsscript.json` では `timeZone` を `Asia/Tokyo` に固定しています。

内部では4時間の検索窓と2時間triggerのため時刻を計算しますが、Sheetの I / R 列へは日付だけを書きます。

## 6. token を Script Properties に保存する

1. Apps Script editor左側の歯車 `プロジェクトの設定` を開きます。
2. `スクリプト プロパティ` → `スクリプト プロパティを追加` を押します。
3. プロパティに `SLACK_USER_TOKEN` と入力します。
4. 値に手順3で取得した `xoxp-...` tokenを貼り付けて保存します。

## 7. 初回セットアップとGoogle権限

1. 関数一覧から `setupProject` を選び、`実行` を押します。
2. 初回だけGoogleの権限確認が表示されます。
3. このGAS projectを実行するGoogle Accountを選びます。
4. Spreadsheetの読み書き、外部サービス（Slack API）への接続、Apps Script trigger管理を許可します。

`setupProject()` は次を行います。

1. SpreadsheetとSheetの存在、Spreadsheetのタイムゾーンを確認
2. K:Vの見出しを追加（競合する既存見出しがあれば停止）
3. K列へcheckbox validationを設定
4. U列へ置顶用checkbox validationを設定し、既存taskへS列の一意IDを割り当て
5. `SLACK_USER_TOKEN` が Slack User ID `U0ANUSDNVMK` のtokenか `auth.test` で確認
6. `scanSlackTasks` の2時間triggerを、重複しないよう1件だけ作成

`setupTrigger()` だけを手動実行することもできます。既に同名handlerのtriggerがあれば新規作成しません。`removeTriggers()` は `scanSlackTasks` のtriggerだけを削除します。

## 8. 手動テストする

1. 関数一覧から `scanSlackTasks` を選びます。
2. `実行` を押します。
3. 「シート1」のK:V見出しと追加行を確認します。
4. 同じ関数をもう一度実行し、同じthreadが追加されず既存行更新になることを確認します。
5. K列をONにして再実行し、その行が変更されないことを確認します。
6. K列をOFFへ戻し、A列を `已完成` にして再実行し、その行が変更されないことを確認します。

### 指定された実データの確認項目

- Channel ID: `C0924RS04CU`
- Thread TS: `1787035693.352449`
- Mention Message TS: `1787036144.932059`
- URL: `https://jopthq.slack.com/archives/C0924RS04CU/p1787036144932059?thread_ts=1787035693.352449&cid=C0924RS04CU`

このメッセージが実行時点の4時間以内にある場合、新規行には少なくとも次が入ることを確認します。

- A: `待确认`
- C: `客户支持`
- D: `中`
- K: checkbox OFF
- L: `个人提及`
- M: 上記Slack URL
- N: `1787036144.932059`
- O: `1787035693.352449`
- P: `C0924RS04CU`
- Q: Fumiya AIZAWAのSlack User ID

B / F / G はルールベースで原文から生成するため、句読点やSlack原文の書き方により例示文と完全一致しない場合があります。最終判断が難しいものは `待确认` に倒します。

実データが4時間より古い場合、テスト時だけ `CONFIG.LOOKBACK_HOURS` を十分大きくして一度手動実行し、確認後に必ず `4` へ戻してください。広げすぎると検索件数とAPI呼び出しが増えます。

## 9. 中文「任务雷达」を公開する

1. Apps Script editorで `setupDashboard()` を1回実行します。
2. 右上の `デプロイ` → `新しいデプロイ` を開きます。
3. 種類は `ウェブアプリ` を選びます。
4. 実行ユーザーは `自分`、アクセスできるユーザーは社内運用に合う範囲を選びます。
5. デプロイ後のURLを開きます。

画面は中国語のみです。データ列A:Jの日本語見出しや既存task本文はそのまま保持し、表示ラベルだけを中国語へ変換します。

Sheetは監査・重複防止用のバックエンドとして扱い、日常操作はHTMLだけで完結します。HTMLでは未完了taskだけを表示し、`＋ 新建任务` から手動taskを追加できます。Slack候補は直接taskにせず、まず `Slack 待整理` に表示します。threadの根messageに `【...】` の見出しがある場合はそれを候補タイトルとして使います。`转为任务` のほか、`关联现有任务` で既存の手動taskへthreadを紐づけられます。紐づけたthreadはtask完了まで継続確認し、新しい返信があればtask cardに通知します。`不是任务` はthreadを永久ignoreします。

task編集画面では日付だけの `截止日期（DL）` を設定できます。DLが3日以内または超過したtaskは `现在做` へ上がります。`同步到 Google Calendar` をONにするとdefault Calendarへ全天eventを作成し、Calendar側のdefault通知を使用します。完了または同期OFFで、このtoolが保存したevent IDのeventだけを削除します。`提醒时间` は従来どおり一時的なsnoozeで、DLとは別管理です。

- `现在做`: 进行中、置顶、または高優先度
- `等回复`: H列に待ち相手がいるtask
- `可能忘了`: 7日以上更新されていないtask
- `任务库`: その他の未完了task
- `稍后提醒`: 30分後 / 2時間後 / 翌日9:00（Asia/Tokyo）まで保留
- `已完成`: A列が `已完成` のtask。Slack scannerからも永久ignore

Web Appの操作はtask IDを再確認してから対象行だけを更新します。行番号だけで対象を決めないため、別の行を誤更新しにくい構造です。

## 10. 処理ルール

### 検索

- 自分宛: `auth.test` で取得した自分のSlack handle（`@handle`）を検索し、取得後に原文が `<@U0ANUSDNVMK>` を含むことを再確認
- Customer Team: `@cs` を検索し、取得後に原文が `<!subteam^S092SRF3JG0...>` を含むことを再確認
- 自分が参加したthread: `from:<@U0ANUSDNVMK> is:thread`。初回だけ30日分を取得し、以後は直近4時間を増分取得
- `待整理` と `关联` の未完了threadはSheetのChannel ID + Thread TSから毎回再取得し、mentionがない新replyも検出
- `#office_勤怠連絡`（`C093Z293J5N`）は検索結果・追跡対象の両方から除外
- Slack検索の日付境界は広めに取得し、最終的にはUnix `ts` で直近4時間だけに厳密filter
- `search.messages` は最大100件ずつpage pagination
- `conversations.replies` は cursor pagination

### 状態

- 自分宛で自分の後続返信なし: `未回复` → A列 `待确认`
- 自分が返信し、その後に依頼表現を含む相手の投稿あり: `处理中` → A列 `进行中`
- `@cs` または判断困難: `待确认` → A列 `待确认`
- 最終投稿に明確な完了表現あり: `完成候选` → A列 `待确认`
- 自動でA列を `已完成` にはしない

判定したSlack状態はJ列メモの先頭にも保存します。

### 更新

既存taskでは次だけを更新します。

- A ステータス
- F 次にやること
- H 確認待ち相手
- I 最終更新
- J メモ
- R Slack Last Checked

K `已确认 = TRUE` または A `已完成` なら、Rを含め何も更新しません。

## 11. Executions / Logs を見る

1. Apps Script editor左側の `実行数` を開きます。
2. 対象の `scanSlackTasks` 実行を選びます。
3. `ログ` を開きます。

開始・終了、direct mention件数、`@cs` 件数、新規、更新、無視、error件数をJSON形式で確認できます。単一メッセージの処理errorは記録後に次のメッセージへ進みます。検索自体、token、Spreadsheet設定などの全体errorは安全のため本実行を停止します。

## 12. Rate limit とエラー処理

- HTTP 429では `Retry-After` を読みます。
- 30秒以内なら1回だけ待ってretryします。
- 30秒を超える、またはretry後も429なら、そのAPI処理をerrorにして本実行での無制限待機を避けます。
- HTTP非2xx、JSON以外のresponse、`ok:false` はすべてerrorにします。
- `conversations.info` / `users.info` / `chat.getPermalink` の補助情報取得に失敗し、検索結果にfallback値がある場合は処理を継続します。

## 13. よくあるエラー

### `Script Properties に SLACK_USER_TOKEN が設定されていません`

手順6を実施してください。キー名の前後に空白を入れないでください。

### `not_allowed_token_type`

bot token（`xoxb-...`）を設定している可能性があります。`search:read` をUser Token Scopesへ追加し、Workspaceへ再インストールした後、User OAuth Token（`xoxp-...`）へ置き換えてください。

### `missing_scope`

errorになったSlack methodとScope表を照合してください。Scope追加後は必ず `Reinstall to Workspace` が必要です。

### `user_id ... が ... と一致しません`

別ユーザーのUser OAuth Tokenです。`@handle` の検索対象と本人返信判定が変わるため、安全のため停止しています。`U0ANUSDNVMK` 本人としてAppを許可して取得したtokenを設定してください。

### `channel_not_found` / `not_in_channel` / `no_permission`

tokenユーザーがその会話を閲覧できない、または必要な `*:history` / `*:read` scopeが不足しています。Slack上で対象channelを開けることとScopeを確認してください。

### `Spreadsheet のタイムゾーンを Asia/Tokyo に設定してください`

Spreadsheetの `ファイル` → `設定` → `タイムゾーン` を東京へ変更してください。Apps Script側だけ東京でも不十分です。

### K:Rの見出し競合error

コードは既存値を勝手に上書きしません。K:Rに別用途の列がある場合は、実行前にユーザーが列配置を判断してください。

### mentionが見つからない

次を順番に確認してください。

1. メッセージが直近4時間以内か
2. Slack原文が本当に対象ユーザーまたは `@cs` user groupへのmentionか
3. tokenユーザーが対象channelを閲覧できるか
4. Slack UIの検索filterが結果を除外していないか
5. `CONFIG.CS_SEARCH_TERM` が現在のuser group handle（`@cs`）と一致するか

Slackのlegacy検索は近接する複数hitをまとめる場合があります。本ツールの一意単位はthreadなので、同じthread内の重複は問題になりません。異なるthreadのmentionを取りこぼす運用問題が確認された場合は、次期版でSlack Events APIによる受信保存へ切り替えるのが推奨です。

`to:me` はSlack公式仕様上「自分宛のDM」だけを対象にするため、channel mention検索には使用していません。Slack検索がWorkspace固有の表示名設定により `@handle` を検索できない場合、`search.messages` だけで確実な全Workspace mention収集はできません。その場合も検索成功を装わず、Events API方式への切り替えを検討してください。

## ファイル構成

- `Config.gs`: 固定値、列番号、見出し
- `Code.gs`: main処理、trigger、集計log
- `Slack.gs`: Slack検索、thread、補助情報、API共通処理
- `Classifier.gs`: 正規化、保守的なルール分類、タイトル・次アクション生成
- `Sheet.gs`: Sheet構造確認、既存task読込、重複判定、upsert
- `Dashboard.gs`: 中文Web Appのデータ取得、安全な単一task更新
- `Calendar.gs`: DLの全天Calendar event作成・更新・削除
- `Index.html`: 中国語UI「任务雷达」
- `appsscript.json`: `Asia/Tokyo` とGoogle OAuth scopes
