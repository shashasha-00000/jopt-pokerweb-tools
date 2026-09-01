import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(repoRoot, 'apps-script', 'customer-ai-automation-portal');
const docsRoot = path.join(repoRoot, 'docs', 'customer-ai-automation-portal');
const manualsRoot = path.join(docsRoot, 'manuals');
const guidesRoot = path.join(docsRoot, 'guides');
const rawBase = 'https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/';
const raw = (repoPath) => rawBase + repoPath.split('/').map(encodeURIComponent).join('/');

function res(id, name, type, requiredTools, installMode, url, source, note = '') {
  return { id, name, type, requiredTools, installMode, url, source, note };
}

function task(id, order, name, category, description, completion, completionStatus, usability, difficulty, resources, manual) {
  return {
    id, order, name, category, description, completion, completionStatus, usability, difficulty, resources, manual,
    manager: 'Sha', users: 'カスタマー', lastVerified: '',
  };
}

const USDT_AI_MANUAL_V2 = `# USDT表 AI補助作成 AI操作マニュアル

## このMDの目的

このMDは、イベントのTournamentsとUSDT表をAIへ渡し、AIが最初に構造と不足情報を確認し、人の回答後にUSDT表の作業用Sheetを完成させるための指示書です。AIの種類、Google Sheets・Slackへの接続状況、利用者の確認精度により結果は変わります。今日と同じ完成度を保証するものではありませんが、確認なしの推測を防ぎ、質問、作成、監査まで進めることを最低条件とします。

## AIへ渡すもの

1. このMD全文
2. 今回のイベントポータルまたはTournamentsのURL・Excel・TSV
3. USDT表のURL。直接操作できないAIにはExcel形式のコピー
4. 今回のUSDTレート、端数表示、イベント名
5. 分かっている例外、Slackリンク、スクリーンショット

参考:

- Tournaments: https://docs.google.com/spreadsheets/d/1S6nJXvQcoRL7jPhx-9ewgbyY7ukvXIbZaiuzi6qYRrg/edit?gid=2138249796#gid=2138249796
- USDT表: https://docs.google.com/spreadsheets/d/1WkZvEnAa5Vv666wdOxJ-wBgmipt1FC8A5g-KCVq3g9k/edit

## AIへ最初に送る依頼文

このMDと資料を読み、まだ変更しないでください。全ファイル・全Sheet名、今回の正本Tournaments、USDT表の原本Sheetと作業候補Sheet、表頭、日付ブロック、数式セル、手入力セルを報告してください。次に、全大会の対応表、不一致、料金・TICKET・Re-entry・Day 2・事前予約・特殊大会の確認候補を示し、必要な質問をまとめてください。私が回答して実行を指示した後だけ、原本を変更せず、対象Sheetを1枚だけコピーして作業してください。

## 情報の優先順位

1. 人が今回明示した指示
2. 今回のTournaments
3. 今回の大会についてSlackに明記された運用
4. 今回の正式資料
5. 過去大会の同形式Sheet・Slack。書式や先例としてのみ使用

Tournamentsを日程、番号、名称、DBI、TICKET、Chips、Colorの第一基準にします。過去大会の金額や例外を本大会へ自動転用しません。情報が矛盾する場合は、勝手に選ばず一覧にして質問します。

## Slack確認

特殊大会がある場合は、今回のイベント名、大会番号、正式名、短縮名でSlackを検索します。今回の記載が見つからない場合だけ、過去の同形式大会を検索します。検索結果は、今回の明記、過去の先例、未確認に分け、リンクまたは検索語と要点を報告します。Slackへ接続できないAIは、ユーザーへリンク、検索結果、スクリーンショットの提供を依頼します。

## 変更前に必ず質問する項目

- 使用するUSDTレートと適用日時
- 端数処理と表示桁
- 事前予約、Satellite、Tag、3on3、Day 2、Final、High Roller、Flipoutなどの例外
- Re-entryなしを示す値が空欄かハイフンか
- TICKET購入行と現金購入行を分けるか。DBI行を残すか
- Tournamentsと既存表で名称・金額・時刻が一致しない大会

## 作業用Sheetの作り方

Google Sheetsを直接操作できる場合は、原本Spreadsheet全体をコピーせず、今回使用する対象Sheetを1枚だけ複製します。既に修正版がある場合は新しいコピーを作らず、そのSheetを続けて使うか確認します。原本、過去大会Sheet、他の作業Sheetは変更しません。直接操作できない場合は、ダウンロードされたExcelを複製し、作業用ファイルだけを編集して返します。不要なファイル、Sheet、コードを作りません。

## USDT表の基本項目

- Reg.-Open
- Reg.-Close
- 大会番号
- Tournament
- JPY Entry Fee
- JPY Re Entry Fee
- USDT Entry Fee
- USDT Re Entry Fee

列記号ではなく表頭で識別します。見本の日付ブロック、結合、行高、罫線、フォント、表示形式、数式を保ちます。数式セルを固定値へ置換しません。

## 料金と大会名

通常大会の基本候補は、TournamentsのDBIをJPY Re Entry Fee、そこへ通常のドリンク代を加えた金額をJPY Entry Feeとします。ただし、これは自動確定ルールではありません。Satellite、Tag、3on3、事前予約、Day 2、High Roller、Flipout、TICKETのみ、ドリンク代なしは必ず今回の根拠で確定します。

TICKET表記はTournamentsと今回の運用に合わせます。T対象だからという理由だけでDBI行とTICKET行を両方作りません。チケット枚数、追加現金、Re-entry、購入方法が不明なら質問します。Re-entryなしは指定されたセルへハイフンを入れ、空欄と混在させません。

大会名から保証額や購入方法の案内文を除く場合でも、大会番号、Day、1A・1B、Finalなど識別に必要な語を残します。判断できない語は削除しません。

USDT列は指定レートと見本数式で計算し、表示桁を見本に合わせます。数式の参照先、日付別レート、ゼロ除算、文字列のハイフンを監査します。

## 完了前の監査

- Tournamentsの全対象大会が存在し、欠落・意図しない重複がない
- 番号、日時、名称、JPY料金、TICKET、Re-entryが根拠と一致する
- USDTレート、数式、参照先、表示桁が正しい
- 例外大会は人の回答または今回のSlack根拠に従っている
- 原本と過去大会Sheetを変更していない
- 文字、数値、数式がセルからはみ出さず、見本の外観を保っている

最後に、元大会数、完成行数、追加・削除した行、適用した例外、TICKET行、未解決事項、変更したSheet名を報告してください。未解決事項がある場合は完成と断定しないでください。
`;

const TOURNAMENT_CUE_AI_MANUAL_V2 = `# トナメカンペ AI補助作成 AI操作マニュアル

## このMDの目的

このMDは、Tournaments、トナメカンペ、Slackの運用情報をAIへ渡し、AIが受付用カンペの作業用Sheetを完成させるための指示書です。AIの能力や接続状況により結果は変わるため、今日と同じ完成度は保証しません。少なくとも、変更前の構造報告、例外質問、作業用Sheet作成、全件監査まで実施させます。

## AIへ渡すもの

1. このMD全文
2. 今回のTournamentsのURL・Excel・TSV
3. トナメカンペのURL。直接操作できないAIにはExcel形式のコピー
4. 今回の受付例外、Slackリンク、スクリーンショット

参考:

- Tournaments: https://docs.google.com/spreadsheets/d/1S6nJXvQcoRL7jPhx-9ewgbyY7ukvXIbZaiuzi6qYRrg/edit?gid=2138249796#gid=2138249796
- トナメカンペ: https://docs.google.com/spreadsheets/d/1aud8xDS7_WtWDooQPfH3sg8QFAjgPvjdb1dZnbb1eGk/edit

## AIへ最初に送る依頼文

このMDと資料を読み、まだ変更しないでください。全Sheet名、今回の正本Tournaments、カンペ原本と見本候補、表頭、日付ブロック、数式セル、手入力セル、書式を報告してください。次に全大会の対応表を作り、名称・時刻・料金・Chips・Color・備考の不一致、TICKET、Re-entry、特殊受付の候補を示してください。Slackで確認できる項目と人へ質問する項目を分け、私が回答して実行を指示した後だけ対象Sheetを1枚コピーして編集してください。

## 情報の優先順位

1. 人が今回明示した指示
2. 今回のTournaments
3. 今回の大会についてSlackに明記された受付運用
4. 今回の正式資料
5. 過去のカンペとSlack。書式や先例としてのみ使用

Tournamentsを日程、番号、正式名、DBI、TICKET、Chips、Colorの第一基準とします。過去大会を現在の事実として扱いません。差異は勝手に修正せず、人へ確認します。

## Slackから特殊運用を探す方法

今回のイベント名、大会番号、正式名、特徴語で検索します。今回の明記がなければ、過去の同形式大会を検索し、受付が何をするかを確認します。過去情報はそのまま採用せず「今回も同じ運用でよいか」と質問します。Slackへ接続できないAIはリンク、検索結果、スクリーンショットを求めます。

フロアだけが行う処理を受付の備考へ入れません。チップをつかむ、くじを引く、サイコロを振るなど特殊動作がある場合は、受付が案内・配布・回収するのか、フロア対応なのかを確認します。

## 作業用Sheet

原本Spreadsheet全体をコピーしません。今回の対象Sheetを1枚だけ複製し、既に修正版がある場合はそれを使うか確認します。原本、過去大会Sheet、他タブを変更しません。直接操作できない場合のみExcelの作業用コピーを編集します。不要なファイル、Sheet、コード、色付けスクリプトを作りません。

## 基本項目

- Reg.-Open
- Reg.-Close
- 大会番号
- Tournament
- JPY Entry Fee
- JPY Re Entry Fee
- Chips
- トナメカラー
- 備考

列記号ではなく表頭で識別します。日付ブロック、結合、行高、罫線、フォント、文字サイズ、数式、表示形式を見本から維持します。長い大会名と備考はセル内に収め、隣のセルへはみ出させません。

## 転記と料金

Tournamentsの全対象大会を番号、日付、正式名で対応付けます。保証表記や購入方法の案内を大会名から除く場合でも、番号、Day、flight、Finalなど識別語は残します。

通常大会はTournamentsのDBIをRe-entry、通常のドリンク代を加えた金額をEntryとする候補ですが、例外を名前だけで確定しません。Satellite、Tag、3on3、事前予約、Day 2、High Roller、Flipout、TICKETのみ、ドリンク代なし、飲み放題は今回の根拠を確認します。Re-entryなしは指定どおりハイフンを入力します。TICKET対象でもDBI行とTICKET行を自動で二重作成しません。

ChipsはTournamentsを確認し、空欄やハイフンにする根拠がない限り転記します。Flipoutなど特殊形式も、Chipsが本当に不要かを確認してから変更します。

## トナメカラー

ColorからH75、H230、H345 S70、S0などのコードを完全一致で転記します。色名だけや見た目だけで推測しません。背景色を直接設定できるAIは既存コード対応に合わせて設定し、できない場合はSheetに既存の色付け機能があれば使用します。新しい色付けコードは導入しません。黒など見本上の正しい表示を独断で変更しません。

## 備考

備考は受付が見てすぐ行動できる短い語句にします。例:

- くじ引き
- ドリンク代なし
- 全員ドリンク代
- ドリチケ6枚渡す
- チンチロ案内
- 専用リストバンド
- 受付マット

これらは例であり、大会名だけから付けません。今回のSlack、正式資料、人の回答で確認した語だけを使用します。必要以上の説明文を入れず、改行、フォント、文字サイズを周囲へ合わせます。

## 完了前の監査

- Tournamentsの全大会があり、欠落・意図しない重複がない
- 日時、番号、名称、Entry、Re-entry、Chips、Colorが根拠と一致する
- TICKET、Day 2、Flipout、事前予約、ドリンク例外を確認済み
- 備考が受付の作業だけを短語で示している
- 背景色、フォント、文字サイズ、行高が揃い、文字がセルからはみ出していない
- 原本、過去大会Sheet、他タブを変更していない

最後に、元大会数、完成行数、追加行、例外一覧、Slack確認結果、色コード欠落、未解決事項、変更したSheet名を報告してください。未解決事項がある場合は完成と断定しないでください。
`;

const TREASURY_MANAGEMENT_AI_MANUAL_V1 = `# 金庫管理 AI補助作成 AI操作マニュアル

## このMDの目的

このMDは、Tournaments、金庫管理表、Slackの受付運用をAIへ渡し、金庫管理の作業用Sheetを完成させるための指示書です。AIの能力や接続状況により結果は変わり、今日と同じ完成度は保証しません。変更前の構造報告、特殊科目の質問、作業用Sheet作成、全件監査を最低条件とします。

## AIへ渡すもの

1. このMD全文
2. 今回のTournamentsのURL・Excel・TSV
3. 金庫管理表のURL。直接操作できないAIにはExcel形式のコピー
4. 今回の受付運用、Slackリンク、スクリーンショット

参考:

- Tournaments: https://docs.google.com/spreadsheets/d/1S6nJXvQcoRL7jPhx-9ewgbyY7ukvXIbZaiuzi6qYRrg/edit?gid=2138249796#gid=2138249796
- 金庫管理: https://docs.google.com/spreadsheets/d/1ME4f4lGIXEMi-_EnxhFv7XMGwC-RBTV3DwmAOdaOULg/edit?gid=1612435257#gid=1612435257

## AIへ最初に送る依頼文

このMDと資料を読み、まだ変更しないでください。全Sheet名、今回の正本Tournaments、金庫管理の原本・修正版・見本候補、表頭、日付ブロック、数式セル、手入力セル、書式を報告してください。全大会を対応付け、open、close、No.、トーナメント、Entry、封筒、カウンター、備考の不一致と、TICKET、Qualifiers、複数の受付科目、特殊大会を一覧にしてください。Slackで確認できる項目と人へ質問する項目を分け、私が回答して実行を指示した後だけ対象Sheetを1枚コピーして編集してください。

## 情報の優先順位

1. 人が今回明示した指示
2. 今回のTournaments
3. 今回の大会についてSlackに明記された受付・金庫運用
4. 今回の正式資料
5. 過去の金庫管理・Slack。書式や先例としてのみ使用

Tournamentsを日程、番号、正式名、DBI、TICKETの第一基準とします。ただし金庫管理のEntryは、受付で実際に受け付ける金額・チケット・Qualifiersなどの科目を記載するため、カンペのJPY Entry Feeをそのままコピーしません。ドリンク代をEntryへ含めるか、別扱いか、不徴収かを今回の運用で確認します。

## Slack確認

今回のイベント名、大会番号、正式名、特徴語で検索し、受付が受け取る金額、チケット、ドリンク代、配布物、専用導線を確認します。今回の明記がなければ過去の同形式大会を先例として探し、「今回も同じか」を質問します。Slackへ接続できないAIはリンク、検索結果、スクリーンショットを求めます。フロアだけの作業を金庫管理の備考へ混ぜません。

## 作業用Sheet

原本Spreadsheet全体をコピーせず、金庫管理の対象Sheetを1枚だけ複製します。既に修正版がある場合は、新しいコピーを作る前にそのSheetを使うか確認します。原本、日別シフト、他の管理Sheetは変更しません。直接操作できない場合のみExcelの作業用コピーを編集します。不要なファイル、Sheet、コードを作りません。

## 表の構造

日付ごとの既存ブロックと次の表頭を維持します。

- open
- close
- No.
- トーナメント
- Entry
- 封筒
- カウンター
- 備考

列記号だけで判断せず表頭を確認します。日付見出し、空白行、結合、罫線、フォント、文字サイズ、行高、数式、表示形式を見本に合わせます。封筒・カウンターに根拠がない値を入れません。

## 行とEntry科目

Tournamentsの全対象大会を番号、日付、正式名で対応付けます。保証表記など運用に不要な案内は名称から除きますが、番号、Day、flight、Finalなど識別語は残します。

通常は1大会1行です。ただし、受付で異なる科目として処理することが今回確認できた場合は、同じ大会番号でも行を追加できます。例としてFlip Stageの通常参加とFinalへの直接参加が別科目なら、3,000円と27,000円を別行にします。追加行は時刻、番号、名称、備考を揃え、既存レイアウトを崩しません。

TICKETのみ、チケットと追加現金、現金受付、Qualifiers、事前予約、Day 2などはTournamentsだけで決めず、今回の受付方法を確認します。T対象という理由だけでDBI行とTICKET行を自動作成しません。金額や科目が不明なら空欄で完成させず、質問します。

## 備考

受付が金庫・配布・案内で必要とする短い語句だけを記載します。例:

- チケットのみ
- ドリンク代なし
- 全員ドリンク代
- ドリチケ6枚渡す
- くじ引き
- チンチロ案内
- 専用リストバンド
- 受付マット

例を大会名から自動適用しません。今回のSlack、正式資料、人の回答で確認した内容だけを使います。文章を長くせず、必要な場合だけセル内改行を使い、文字をはみ出させません。

## 完了前の監査

- Tournamentsの全対象大会と必要なSit & Go行が存在する
- 日付、open、close、No.、名称、Entry科目が根拠と一致する
- 同一番号の追加科目は理由が説明できる
- TICKET、追加現金、Qualifiers、ドリンク、配布物が確認済み
- 封筒・カウンターへ推測値を入れていない
- 備考が受付の行動だけを短語で示す
- レイアウト、フォント、文字サイズ、罫線、行高が揃っている
- 原本と他Sheetを変更していない

最後に、元大会数、完成行数、追加科目行、TICKET・Qualifiers行、特殊運用一覧、Slack確認結果、未解決事項、変更したSheet名を報告してください。未解決事項がある場合は完成と断定しないでください。
`;

const tasks = [
  task(
    'TASK-PW-URL-CACHE', 1, 'PWトーナメントURL管理', '共通補助',
    'PokerWebのトーナメント名、Tournament ID、URLをブラウザ内の共通URL Cacheへ保存・監査・修復する。', 90,
    '実運用可能。新しいイベントの追加や大会名変更後は、Cacheの再収集・監査が必要。',
    '普通', '大会名を変更した場合、または同名のトーナメントを作成した場合、過去のCacheが不整合データ（汚染データ）として残る可能性があります。その場合は、マニュアルに従って該当データを確認し、削除する必要があります。',
    [
      res('RES-PW-URL-MANAGER', 'PW URL Cache Manager', 'Tampermonkey', 'Tampermonkey', 'クリックしてインストール', raw('tampermonkey/pw-url-cache-manager.user.js'), 'tampermonkey/pw-url-cache-manager.user.js', 'トーナメントURLの検索・収集・監査・修復に使用する。'),
    ],
    {
      markdown: `# PWトーナメントURL管理 AI操作マニュアル

## AIへの依頼方法

このMD全文を自分のAIへ貼り付け、今回登録・確認・修復するイベント名とPokerWeb上の正式な大会名を追加してください。AIには操作するボタン、対象件数、削除範囲を実行前に確認させてください。

## 使用するツール

- PW URL Cache Manager（Tampermonkey）
- インストールURL: ${raw('tampermonkey/pw-url-cache-manager.user.js')}

## URL Cacheの保存場所

URL CacheはGoogleアカウントやGoogle Driveには保存されません。PokerWebを開いている現在のブラウザ・ブラウザProfileのlocalStorageに、\`PW_SHARED_TOURNAMENT_URL_CACHE_V1\`として保存されます。

- 別のパソコンには自動共有されません。
- 同じパソコンでも、ChromeとEdge、または別のブラウザProfileでは別のCacheになります。
- PokerWebとPWツールを使用する同じブラウザ・同じProfileで操作します。

## 基本操作：イベント全体を登録する

1. 「Event Prefix」に対象イベントの共通部分を入力する。例：\`【JOPT 2026 Grand Final】\`
2. 「Build by Event Prefix」を押す。
3. ツールが以下のOPEN・CLOSED一覧を開き、全ページからPrefixを含む大会を収集する。
   - \`/cb/torneio/abertos\`
   - \`/cb/torneio/fechados\`
4. 完了後、OK件数とNG件数を確認する。
5. 「View Current Event」で現在のイベントだけを表示する。
6. 「Copy Sheet TSV Current」でSheet保存用TSVをコピーする。

## 基本操作：指定した大会名だけを検索する

Inputへ大会名を1行ずつ貼り付けます。\`Name\`の表頭は省略できます。

\`\`\`tsv
Name
【JOPT 2026 Grand Final】#1 NLH
【JOPT 2026 Grand Final】#2 NLH Turbo
\`\`\`

1. Inputへ大会名リストを貼り付ける。
2. 「Build by Names」を押す。
3. OPEN・CLOSEDの両方から各大会名を検索する。
4. 結果の\`OK\`、\`NOT_FOUND\`、\`AMBIGUOUS\`を確認する。
5. \`AMBIGUOUS\`は自動確定せず、候補URLを人が確認する。

## 正しいURLを直接登録する

正しいTournament IDまたはURLが分かっている場合は、次のTSVをInputへ貼り付けて「Import TSV」を押します。

\`\`\`tsv
Name\tTournamentId\tURL\tActual_Name
正式な大会名\t1234\thttps://japanopt.pokerweb.com.br/cb/torneio/painel/1234\tPokerWeb画面に表示された大会名
\`\`\`

\`Actual_Name\`は省略できます。Tournament IDまたはURLだけでは登録せず、必ず大会名も確認してください。

## 各ボタンの役割

- \`Build by Event Prefix\`：OPEN・CLOSED全ページから、Prefixを含む大会を一括収集する。
- \`Build by Names\`：Inputの大会名をOPEN・CLOSEDから一件ずつ検索する。
- \`Import TSV\`：確認済みのName、TournamentId、URLを現在のCacheへ追加する。
- \`View Current Event\`：Event Prefixに一致するCacheだけをOutputへ表示する。
- \`Copy Sheet TSV Current\`：現在イベントを\`Name / TournamentId / URL / Actual_Name\`の4列でコピーする。
- \`Copy Sheet TSV All\`：全イベントを4列TSVでコピーする。
- \`Audit Current Event\`：現在イベントの欠損、URLとIDの不一致、NameとActual_Nameの不一致、重複を確認する。
- \`Repair Current Event Cache\`：AuditのERROR対象を削除し、同じEvent Prefixを再スキャンする。
- \`View All\`：このブラウザに保存された全Cacheを表示する。
- \`Copy Full Cache\`：Source、SavedAt、Matched_Rowを含む全Cacheをコピーする。
- \`Stop\`：現在の一件が終わった後に検索を停止する。
- \`Clear Current Event Cache\`：Event Prefixに一致するCacheだけを削除する。
- \`Clear All Cache\`：このブラウザの全Cacheを削除する。
- \`Replace All Cache From TSV\`：入力TSVに存在しない既存Cacheも削除し、全Cacheを置換する。

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
`,
    },
  ),
  task(
    'TASK-PW-PANEL-HELPER', 2, 'PWツールパネル移動補助', '共通補助',
    'PokerWeb上の対応済みPWツールパネルを移動し、選択したパネルを手前へ表示する。', 90,
    '実運用可能。新しいPWスクリプトのパネルを追加した場合は、対応パネルIDの更新が必要。',
    '易', '導入後の追加設定は不要です。PokerWebを再読み込みすれば、対応済みのPWツールパネルをそのまま移動できます。',
    [
      res('RES-PW-PANEL-HELPER', 'PW 共通パネル移動・最小化', 'Tampermonkey', 'Tampermonkey', 'クリックしてインストール', raw('tampermonkey/pw-panel-drag-helper.user.js'), 'tampermonkey/pw-panel-drag-helper.user.js', '対応済みPWパネルの移動、位置保存、重なり順を補助する。'),
    ],
    {
      markdown: `# PWツールパネル移動補助 AI操作マニュアル

## AIへの依頼方法

このMD全文を自分のAIへ貼り付け、Tampermonkeyへのインストールだけを案内させてください。追加設定やTSVは不要です。

## 使用するツール

- PW 共通パネル移動・最小化（Tampermonkey）
- インストールURL: ${raw('tampermonkey/pw-panel-drag-helper.user.js')}

## 使用手順

1. PokerWebを使用する同じブラウザ・同じブラウザProfileへインストールする。
2. PokerWebを再読み込みする。
3. 対応済みPWツールのパネルを開く。
4. パネル上部に追加された「移動」をドラッグし、見やすい位置へ移動する。

## 動作

- 移動した位置は現在のブラウザに保存される。
- 画面外へ出ないように位置が自動調整される。
- パネルをクリックまたはドラッグすると、そのパネルが手前に表示される。
- 最小化は各PWツールにもともとある「Min」ボタンを使用する。

## 注意事項

- インストール後の設定操作は不要です。
- 新しいPWツールが対応一覧に追加されるまでは、そのパネルに「移動」が表示されない場合があります。
`,
    },
  ),
  task(
    'TASK-TICKET-GRANT', 3, 'TICKET自動付与', 'TICKET',
    'Game IDと正式なTICKET名を記載したTSVをPWへ貼り付け、ナショナルチケットを一括付与する。', 90,
    '実運用可能。PokerWebの画面仕様やTICKET構成が変更された場合は更新が必要。',
    '易', 'TSVのGame ID・正式なTICKET名・枚数が正しければ、そのまま貼り付けて実行できます。PWのナショナルチケット画面以外では使用しません。',
    [
      res('RES-PW-NATIONAL-TICKET-BATCH', 'PW ナショナルチケット Batch', 'Tampermonkey', 'Tampermonkey', 'クリックしてインストール', raw('tampermonkey/pw-national-ticket-batch.user.js'), 'tampermonkey/pw-national-ticket-batch.user.js', 'ログイン済みのPokerWeb管理画面でTSVを読み込み、一括付与する。'),
    ],
    {
      markdown: `# TICKET自動付与 AI操作マニュアル

## AIへの依頼方法

このMD全文を自分のAIへ貼り付け、PW ナショナルチケット Batchのインストール、TSV作成、DRY RUN、正式付与の順に案内させてください。

## 使用するツール

- PW ナショナルチケット Batch（Tampermonkey）
- インストールURL: ${raw('tampermonkey/pw-national-ticket-batch.user.js')}

## TSVの作成方法

Google SheetまたはExcelに、次の表頭を入力します。

社内で既にナショナルチケット付与用TSVを生成・管理しているGoogle Sheetがある場合は、その出力を表頭ごとコピーします。入力元を特定できない場合は、過去に同じ付与作業で使用した表がないか実際の担当者またはAIに探させ、該当する表の表頭・空欄列を含む使用範囲全体をそのままコピーしてください。列の順番や表頭名を自己判断で変更しません。過去表が無い場合だけ、次の最小形式を新しく作成します。

\`\`\`tsv
GameID\tチケット名
12345678\tPokerWeb上の正式なTICKET名
23456789\tPokerWeb上の正式なTICKET名
\`\`\`

同じ人へ同じTICKETを複数枚付与する場合は、任意で「枚数」列を追加できます。

\`\`\`tsv
GameID\tチケット名\t枚数
12345678\tPokerWeb上の正式なTICKET名\t2
\`\`\`

表頭を含む範囲を選択してコピーし、PW ナショナルチケット Batchの入力欄へ貼り付けます。

## 使用手順

1. ログイン済みのPokerWeb管理画面を開く。
2. 「PW ナショナルチケット Batch」が表示されていることを確認する。
3. 表頭を含むTSVを入力欄へ貼り付ける。
4. 「TSV読取」を押す。
5. 「検証・プレビュー / DRY RUN」を押す。
6. Game ID、TICKET名、枚数、ステータスを確認する。
7. 全件が正しい場合だけ「正式付与」を押す。
8. 完了後に「ログ出力」を押し、付与結果を保存する。

## 完了確認

- TSVの対象件数とプレビューの件数が一致している。
- Game IDとTICKET名が正しい。
- 正式付与後のログに各対象の結果が記録されている。

## 注意事項

- TICKET名はPokerWeb上の正式名称と完全一致させる。
- DRY RUNでエラーが出た場合は正式付与しない。
- 同じTICKET名のGROUPが複数表示された場合は、自動判断せず正しいGROUPを選択する。
- 結果が不明な行を自動で再実行しない。
`,
    },
  ),
  task(
    'TASK-PW-CREATE', 4, 'PWでトーナメント作成', 'PokerWeb',
    'TSVのトーナメント情報を読み込み、PokerWebへトーナメントを新規作成する。', 60,
    '基本フローは使用可能。新しいトーナメント形式や作成項目を追加する場合は更新と動作確認が必要。',
    '普通', '取り込んだTSVの内容がそのままトーナメント設定へ反映されるため、作成前に大会名・日時・金額・回数・Chips・TICKET名に誤りがないことを確認する必要があります。',
    [res('RES-PW-CREATE-TM', 'PW Tournament Create Auto', 'Tampermonkey', 'Tampermonkey / PokerWeb / TSV', 'クリックしてインストール', raw('tampermonkey/pw-tournament-create-auto.user.js'), 'tampermonkey/pw-tournament-create-auto.user.js', '作成後にUSDT・Item・TICKET LINKを設定する。')],
    {
      markdown: `# PWでトーナメント作成 AI操作マニュアル

## AIへの依頼方法

このMD全文と作成元の大会情報を自分のAIへ渡し、正式なトーナメント名、日付、開始時間、EN・RE・TE、Chips、TICKET名を確認しながらTSVを作成させてください。不明な設定をAIに推測させず、必ず正式情報を追加してください。

## 使用するツール

- PW Tournament Create Auto（Tampermonkey）
- インストールURL: ${raw('tampermonkey/pw-tournament-create-auto.user.js')}

## TSVの表頭

次の表頭をそのままGoogle SheetまたはExcelの1行目へ貼り付ける方法を推奨します。

作成元となる社内Sheetが不明な場合は、過去にこのトーナメント作成で使用した同形式の表がないか実際の担当者またはAIに探させてください。該当する表がある場合は、表頭・空欄列を含む使用範囲全体をそのままコピーし、列の順番、表頭名、空欄列を自己判断で整理・変更しません。過去表が見つからない場合は、次の表頭で新しく作成し、正式な大会資料から値を入力します。

\`\`\`tsv
大会名\t日付\t開始時間\tEN名称\tEN略称\tEN金額\tEN手数料\tEN回数\tENチップ数\tRE名称\tRE略称\tRE金額\tRE手数料\tRE回数\tREチップ数\tTE名称\tTE略称\tTE金額\tTE手数料\tTE回数\tチケット名称
\`\`\`

必須表頭は以下です。表頭自体は必要ですが、「チケット名称」はリンクするTICKETがない場合、データを空欄にできます。

- 大会名
- 日付
- 開始時間
- EN金額、EN手数料、EN回数
- RE金額、RE手数料、RE回数
- TE金額、TE手数料、TE回数
- チケット名称

次の表頭は任意です。空欄の場合は括弧内の標準値が使われます。

- EN名称（Entry）、EN略称（En）、ENチップ数（50000）
- RE名称（Re Entry）、RE略称（Re）、REチップ数（50000）
- TE名称（Ticket Entry）、TE略称（TE）

## TSV入力例

以下は列位置を示す例です。金額、回数、Chips、TICKET名をそのまま本番で使用しないでください。

\`\`\`tsv
大会名\t日付\t開始時間\tEN名称\tEN略称\tEN金額\tEN手数料\tEN回数\tENチップ数\tRE名称\tRE略称\tRE金額\tRE手数料\tRE回数\tREチップ数\tTE名称\tTE略称\tTE金額\tTE手数料\tTE回数\tチケット名称
【入力例】#1 NLH\t2026/09/01\t13:00\tEntry\tEn\t10000\t1000\t1\t50000\tRe Entry\tRe\t10000\t1000\t3\t50000\tTicket Entry\tTE\t0\t0\t0\t【入力例】正式なTICKET名
\`\`\`

- 日付は「2026/09/01」の形式で入力できます。
- 開始時間は「13:00」の形式で入力します。
- RE回数などを無制限にする場合は「0」または「無制限」を入力できます。
- TE金額・TE手数料・TE回数がすべて空欄または0の場合、Ticket Entryは作成されません。
- 複数のTICKETをリンクする場合は、チケット名称を「TICKET A|TICKET B」のように半角 \`|\` で区切ります。
- TICKET名はPokerWeb上の正式名称を入力します。

## 使用手順

1. 表頭とデータを含むTSVを用意する。
2. ログイン済みのPokerWeb管理画面を開く。
3. 「PW Tournament Background Create」の入力欄へTSVを貼り付ける。
4. 「Preview」を押す。
5. トーナメント名、日付、開始時間、EN・RE・TE、Chips、TICKET名を確認する。
6. PreviewにERRORがなく、全行が正しい場合だけ「CREATE + SET + LINK」を押す。
7. 完了後に「Copy Report」を押し、Tournament ID、URL、成功・失敗結果を保存する。

## 完了確認

- TSVのデータ行数と処理結果の件数が一致している。
- 各トーナメントにTournament IDとURLが発行されている。
- EN・RE・TE、Chips、USDT、TICKET LINKが正式情報と一致している。
- ReportにERRORまたは途中停止がない。

## 注意事項

- 「CREATE + SET + LINK」はPokerWebへ実際に書き込みます。必ず先にPreviewを確認してください。
- 現在のスクリプトは複数トーナメントを並行処理します。一件ずつ作成する仕様ではありません。
- 作成後にERRORになった行を、そのまま再実行しないでください。先にReportのTournament IDと停止段階を確認してください。
- 大会名、日付、開始時間、金額、回数、TICKET名を推測で補完しないでください。
`,
    },
  ),
  task(
    'TASK-PW-PATCH', 5, 'PW作成トーナメントの設定修正', 'PokerWeb',
    '既存トーナメントの名称、Item Fee、EN・RE Chipsなど、指定された項目だけを修正する。', 80,
    '対象限定の修正は運用可能。新しい修正項目を追加する場合は更新が必要。',
    '普通', '空欄は「変更なし」、0は「0へ変更」として扱われます。同名大会やDay違いがある場合は、URLまたはTournament IDを指定しないと別大会を修正する危険があります。',
    [res('RES-PW-PATCH-TM', 'PW Existing Tournament Patch', 'Tampermonkey', 'Tampermonkey / PokerWeb / TSV', 'クリックしてインストール', raw('tampermonkey/pw-existing-item-fee-patch.user.js'), 'tampermonkey/pw-existing-item-fee-patch.user.js', 'TSVに記載された項目だけを修正する。')],
    {
      markdown: `# PW作成トーナメントの設定修正 AI操作マニュアル

## このタスクで行う仕事

既存トーナメントの大会名、EN・RE・TE手数料、EN・RE Chipsのうち、TSVで値を指定した項目だけを修正します。

## 使用するツール

- PW Existing Tournament Patch（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-existing-item-fee-patch.user.js

PokerWebを操作するブラウザと同じブラウザ・同じProfileへインストールし、PokerWebを再読み込みします。

## TSVの入手元

PW URL Cache Managerの「Copy Sheet TSV Current」または「Copy Sheet TSV All」で大会名、TournamentId、URLを取得できます。そのTSVを使用する場合は、表頭の「Name」を「大会名」へ変更し、今回修正する列を右側へ追加します。

社内で過去に使用したGoogle Sheetに同じ形式の修正表がある場合は、表頭・空欄列を含む使用範囲全体をそのままコピーしてください。入力元を特定できない場合は、過去にこの作業を行った担当者またはAIへ同形式の表がないか確認し、列の順番、表頭名、空欄列を自己判断で整理・変更しないでください。

## TSVの表頭

必須列は「大会名」です。次の修正列のうち、今回使用する列を1つ以上入れます。

    大会名<TAB>TournamentId<TAB>URL<TAB>新大会名<TAB>EN手数料<TAB>RE手数料<TAB>TE手数料<TAB>ENチップ数<TAB>REチップ数

入力例：

    【入力例】#01 NLH<TAB>1234<TAB>https://japanopt.pokerweb.com.br/cb/torneio/painel/1234<TAB><TAB>1000<TAB>1000<TAB><TAB>50000<TAB>50000

- 「大会名」は必須です。
- TournamentIdまたはURLは任意ですが、同名大会、Day違い、店舗違いがある場合は必ず指定します。
- 「新大会名」は大会名を変更する場合だけ入力します。
- EN手数料、RE手数料、TE手数料は数値で入力します。
- ENチップ数、REチップ数は0以上の整数で入力します。
- TSVに存在しない修正列、および存在していても空欄のセルは変更されません。
- 修正しない項目へ0を入れません。0は「0へ変更する」という正式な指示になります。

## 使用手順

1. 表頭を含むTSV全体を「PW Existing Tournament Patch」の最上部入力欄へ貼り付けます。
2. 「Preview」を押し、対象大会、現在の値、変更後の値、URL状態を確認します。
3. URLが無い行だけ「URL pool検索」を使用します。複数候補や同名大会は自動確定しません。
4. Candidatesの大会名、TournamentId、URLと修正内容が正しいことを人が確認します。
5. 確認済み行だけ「EXECUTE」を実行します。
6. 「Copy Report」で結果を保存します。
7. 対象大会を再読み込みし、変更した項目がTSVと一致し、指定していない項目が変わっていないことを確認します。

## 注意事項

- HTTP成功だけで完了と判断しません。再読み込み後の画面値を確認します。
- 実行結果が不明な行を自動で再実行しません。
- 本番TSVの値をAIに推測させません。
`,
    },
  ),
  task(
    'TASK-TICKET-LINK', 6, 'TICKET LINK', 'PokerWeb',
    '対象トーナメントと受付用TICKETを確認し、既存トーナメントへTICKET LINKを設定する。', 60,
    '基本フローは使用可能。同名トーナメントやTICKETルール追加時は確認と更新が必要。',
    '普通', '同名大会・Day違い・複数のTICKET候補がある場合は自動確定できません。候補URLと正式なTICKET名を確認し、正しい組み合わせを選ぶ必要があります。',
    [res('RES-TICKET-LINK-TM', 'PW Ticket Link Semi Auto', 'Tampermonkey', 'Tampermonkey / PokerWeb / Google Sheet', 'クリックしてインストール', raw('tampermonkey/pw-ticket-link-semi-auto.user.js'), 'tampermonkey/pw-ticket-link-semi-auto.user.js', '既存トーナメント用のTICKET LINK設定ツール。')],
    {
      markdown: `# TICKET LINK AI操作マニュアル

## このタスクで行う仕事

既存のPokerWebトーナメントへ、正式な受付用TICKETをLinkします。全大会へ同じTICKETを設定する簡単モードと、社内のTicket Linkルール表を読み取る詳細モードがあります。

## 使用するツール

- PW Ticket Link Semi Auto（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-ticket-link-semi-auto.user.js

PokerWebを操作するブラウザと同じブラウザ・同じProfileへインストールし、PokerWebを再読み込みします。

## 1. 大会名入力欄

対象大会のPokerWeb上の正式名称を、表頭なしで1行につき1大会貼り付けます。

    【入力例】#01 NLH Main Event Day 1A
    【入力例】#05 NLH Turbo

大会名を省略したり、同名のDayを1行へまとめたりしません。

## 2. 簡単モードのTicket名入力欄

すべての入力大会へ同じTICKETをLinkする場合に使用します。PokerWeb上の正式なTICKET名を1行につき1件貼り付けます。表頭は省略できます。Google Sheetから貼る場合は「チケット名称」または「チケット名」列を表頭ごとコピーできます。

    チケット名称
    正式なTICKET名

## 3. 詳細モードのTicketLink用ルール表

大会ごとに異なるTICKETをLinkする場合は、社内で実際に使用しているTicket Linkルール表を表頭から最終データ行までそのままコピーします。

TSVファイルを別途作る必要はありません。Google Sheetの使用範囲全体を選択してコピーすると、列がTAB区切りのTSVとしてクリップボードへ入り、そのまま入力欄へ貼り付けられます。

- 「チケット名称」または「チケット名」列が必要です。
- 大会Key列は「#01」「#01A」「s01」などの形式です。
- Link対象セルは TRUE、✓、○、〇、1 のいずれかで指定します。
- Ticket名がある行にTRUEが1つも無い場合は警告になります。
- Ticket名が空なのに大会Key列へ値がある行は異常行となり、STARTできません。

社内で過去に使用したGoogle Sheetに同じ形式の表がないか確認してください。該当する表がある場合は、表頭・空欄列を含む使用範囲全体をそのままコピーし、「TicketLink用ルール表」へ貼り付けてください。列の順番、表頭名、空欄列を自己判断で整理・変更しないでください。入力元を特定できない場合は、過去の同形式表を実際の担当者またはAIに探させてから使用します。

## 4. 手動修正欄

ルール表の大会Keyと大会名の対応を個別に直す場合だけ、次の2列を表頭なしで貼り付けます。

    大会名キーワード<TAB>修正Key

    Main Event Day 1A<TAB>#01A
    Satellite<TAB>s01

## 使用手順

1. 「簡単モード」または「詳細モード」を選びます。
2. 大会名入力欄と、選択したモードのTicket入力欄へ貼り付けます。
3. 「1. 候補作成」を押します。
4. Candidatesで大会名、Ticket名、判定を確認します。
5. URL未解決だけ「2. URL pool検索」を実行します。同名・複数候補は実際のURLを開いて確認します。
6. 候補とTICKETが正しい行だけ「使用」にし、「3. 已确认比赛执行Link」を押します。
7. 「Copy Report」で実行結果を保存し、PokerWeb画面を再読み込みしてTICKET LINKを確認します。

## 注意事項

- TICKET名はPokerWeb上の正式名称と照合します。
- 同名トーナメント、複数URL候補、複数TICKET候補をAIに推測させません。
- 実行結果が不明な行を一括で再実行しません。
`,
    },
  ),
  task(
    'TASK-PW-DC', 7, 'PW作成トーナメントのDC', 'PokerWeb',
    'トーナメント名、開始条件、EN・RE・TE、Chips、TICKET LINK、USDTなどの主要設定をDCする。', 80,
    '主要設定の読み取り確認は運用可能。新しい設定項目を追加した場合はチェック項目の更新が必要。',
    '普通', '大会表とTicket Link表は、表頭・日付行・空欄列を含めてそのまま貼り付ける必要があります。空欄列を削除すると、大会とTICKETの対応がずれます。',
    [res('RES-PW-DC-TM', 'PW Tournament Double Check', 'Tampermonkey', 'Tampermonkey / PokerWeb', 'クリックしてインストール', raw('tampermonkey/pw-tournament-double-check.user.js'), 'tampermonkey/pw-tournament-double-check.user.js', '書き込みを行わない確認専用ツール。')],
    {
      markdown: `# PW作成トーナメントのDC AI操作マニュアル

## このタスクで行う仕事

Portalの大会設定表と受付PortalのTicket Link表を基準に、PokerWebの大会名、開始日時、EN・RE・TE、Chips、Settings、USDT、TICKET LINKを読み取り専用でDCします。

## 使用するツール

- PW Tournament Double Check（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-double-check.user.js

PokerWebを操作するブラウザと同じブラウザ・同じProfileへインストールし、PokerWebを再読み込みします。

ここで使用するTSVは、別途ファイルを作成するものではありません。PortalまたはGoogle Sheetの表全体を選択してコピーすると、列がTAB区切りのTSVとしてクリップボードへ入り、そのまま各入力欄へ貼り付けられます。

## 入力① 総大会名

PokerWeb上で大会名の先頭に付くイベント共通名を入力します。

    【JOPT 2026 Tokyo #02】

## 入力② PortalのTournamentページ

Portal Tournamentページの表を、表頭とデータ行を含めてそのまま全体コピーし、「② Portal の Tournament ページ」へ貼り付けます。次の表頭が必要です。

    Date<TAB>Start<TAB>#<TAB>Name<TAB>Chips<TAB>DBI<TAB>Ticket

列の途中に別の列があっても構いません。Dateが省略されている連続行は直前の日付を引き継ぐため、対象大会行だけを切り出さず、日付行からまとめてコピーします。

## 入力③ 受付PortalのTicket Linkページ

受付PortalのTicket Linkページを、上部の日付、大会番号、Tournament IDが入るメイン行、全Ticket行を含めてそのまま全体コピーし、「③ 受付Portal の Ticket Link ページ」へ貼り付けます。空欄列は大会とTicketの位置関係を保持するため削除しません。

社内で過去に使用したGoogle SheetまたはPortal出力に同じ形式の表がないか確認してください。該当する表がある場合は、表頭・空欄列を含む使用範囲全体をそのままコピーして貼り付けます。列の順番、表頭名、空欄列を自己判断で整理・変更しません。入力元を特定できない場合は、過去の同形式表を実際の担当者またはAIに探させてから使用します。

## 詳細設定：ドリンク券ルール

通常は既存値を使用します。変更が必要な場合だけ、1行につき「大会名キーワード: 加算額」の形式で入力します。

    DEFAULT: 1000
    Tag Team: 2000
    3on3: 3000
    Satellite: 0

## 使用手順

1. 総大会名、Portal Tournament表、受付Portal Ticket Link表を貼り付けます。
2. 入力範囲に表頭、日付、Tournament ID、Ticket行が含まれていることを確認します。
3. 「Double Check」を押します。
4. Overall、Tournament、Start、EN、RE、TE、Chips、Settings、USDT、Ticket Linkを確認します。
5. NGまたはCHECK行は、基準表とPokerWeb画面を人が照合します。
6. 「Copy Last LOG」で結果を保存します。

## 注意事項

- このツールは読み取り専用で、PokerWebの値を修正しません。
- 表の空欄列を削除すると、大会列とTicket列の対応がずれる可能性があります。
- DC結果だけで修正を自動実行しません。
`,
    },
  ),
  task(
    'TASK-PW-CLOSE-AUDIT', 8, 'トーナメントCLOSE・監査', 'PokerWeb',
    '複数トーナメントのCLOSE処理と設定監査を分けて実行する。', 60,
    'CLOSEと監査の分離実行は可能。イベントごとのURL解決と結果確認が必要。',
    '易', 'CLOSEは実際に大会を終了させる処理です。対象URLを確定したTSVだけを使用し、CLOSEと監査を別操作として実行する必要があります。',
    [res('RES-PW-CLOSE-AUDIT-TM', 'PW Tournament CLOSE + AUDIT Background Batch', 'Tampermonkey', 'Tampermonkey / PokerWeb / TSV', 'クリックしてインストール', raw('tampermonkey/pw-tournament-close-audit-batch.user.js'), 'tampermonkey/pw-tournament-close-audit-batch.user.js', 'CLOSEとAUDITを別操作として実行する。')],
    {
      markdown: `# トーナメントCLOSE・監査 AI操作マニュアル

## このタスクで行う仕事

TSVで指定した複数トーナメントだけを対象に、CLOSEと監査を別々に実行します。

## 使用するツール

- PW Tournament CLOSE + AUDIT Background Batch（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-close-audit-batch.user.js

PokerWebを操作するブラウザと同じブラウザ・同じProfileへインストールし、PokerWebを再読み込みします。

## TSVの入手元と表頭

最も簡単なのは、PW URL Cache Managerの「Copy Sheet TSV Current」で対象イベントのTSVをコピーする方法です。出力された表頭と対象大会行をそのまま使用できます。

推奨形式：

    Name<TAB>TournamentId<TAB>URL<TAB>Actual_Name
    正式な大会名<TAB>1234<TAB>https://japanopt.pokerweb.com.br/cb/torneio/painel/1234<TAB>PokerWeb上の大会名

- Nameまたは大会名が必要です。
- TournamentIdとURLは片方だけでも使用できますが、両方ある場合は同じIDでなければなりません。
- Actual_Name、Source、SavedAt、Matched_RowなどURL Managerの追加列が残っていても構いません。
- 大会名だけを表頭なしで1行ずつ貼ることもできますが、URL補完が必要になるため、正式なCLOSE作業ではURL付きTSVを推奨します。

別の社内Sheetから取得する場合は、同じ形式の過去表について、表頭・空欄列を含む使用範囲全体をコピーします。列の順番や表頭を自己判断で変更せず、最低でも大会名、TournamentIdまたはURLが正しいことを確認します。

## 使用手順

1. 今回CLOSEまたは監査する大会だけをTSVへ残します。別イベントや実行しない大会を同じTSVへ入れません。
2. 「Input: Name / URL TSV」へ表頭を含めて貼り付けます。
3. 「TSVを読み取る（本地）」を押します。
4. Validated Inputの大会名、TournamentId、URLと件数を確認します。
5. URLが無い行だけ「URLを補完（Pool）」を実行します。URL不明・複数候補は実行対象にしません。
6. CLOSEする場合は、対象件数を再確認してから「Run CLOSE」を押します。
7. Background ProgressとReportを確認し、「Copy Report」で結果を保存します。
8. CLOSE完了後、同じ確定済みTSVで「Run 監査」を別操作として実行します。
9. 監査Reportに未確認項目がないことを確認します。

## 注意事項

- 「Run CLOSE」は実際に大会をCLOSEします。監査と同じボタンではありません。
- 停止中または結果不明の大会を自動で再実行しません。
- HTTP応答だけで成功と判断せず、Reportと実際の大会状態を確認します。
`,
    },
  ),
  task(
    'TASK-PW-PRIZE', 9, 'PWのPrize入力・DC', 'Prize',
    'Prize PLANを作成してPokerWebへ入力し、入力結果とGame IDをDCする。', 80,
    'Prize PLANの作成・入力・確認は運用可能。新しいPrize形式や重名トーナメントでは追加確認が必要。',
    '普通', '同名大会・Day違い・Tag／2on2／3on3などの複数人制では、自動判定できない場合があります。PLANで人数展開、順位、金額を確認してからPWへ入力する必要があります。',
    [
      res('RES-PW-PRIZE-TM', 'PW Prize Plan 書込・確認', 'Tampermonkey', 'Tampermonkey / PokerWeb / Prize表', 'クリックしてインストール', raw('tampermonkey/pw-prize-batch-manual.user.js'), 'tampermonkey/pw-prize-batch-manual.user.js', 'Prize PLANの作成・入力・確認を行う。'),
      res('RES-PW-PRIZE-GAMEID-TM', 'PW・シーズン Prize Game ID照合', 'Tampermonkey', 'Tampermonkey / PokerWeb / シーズンDB', 'クリックしてインストール', raw('tampermonkey/pw-prize-gameid-check.user.js'), 'tampermonkey/pw-prize-gameid-check.user.js', 'Prize行のGame IDを照合する。'),
    ],
    {
      markdown: `# PWのPrize入力・DC AI操作マニュアル

## このタスクで行う仕事

大会全体のPrize Google SheetからPokerWeb用のPrize PLANを作り、大会URL、使用Prize、順位別金額、Totalを確認してからPokerWebへ書き込みます。書き込み後はCHECKで再読込し、必要に応じてシーズンDBとPrize受賞者のGame IDを照合します。

## 使用するリソース

- PW Prize Plan 書込・確認（Tampermonkey）: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-batch-manual.user.js
- PW・シーズン プライズGameID照合（Tampermonkey）: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-gameid-check.user.js

TampermonkeyとPokerWebは、同じブラウザ、同じブラウザプロフィールで開きます。インストール後にPokerWebを再読み込みし、PW Prize Plan 書込・確認が有効になっていることを確認します。

## AIへ渡すもの

このMD全文、対象大会の正式な大会名、Prize Google Sheet、PokerWeb上のイベント名、テストか本番かを自分のAIへ渡してください。Tag、2on2、3on3、Twinsなどの複数人制、特殊賞、同名大会、Prizeの複数候補がある場合は最初にAIへ伝えます。

## 入力するPrize表の条件

「大会Prize Google Sheet全体」には、Google SheetのPrize表を表頭から順位行までそのままコピーして貼り付けます。通常の固定TSV表頭ではなく、次の行を表全体から検出します。

TSVファイルを別途作る必要はありません。Google Sheetの使用範囲全体を選択してコピーすると、列がTAB区切りのTSVとしてクリップボードへ入り、そのまま「大会Prize Google Sheet全体」へ貼り付けられます。

- Tournamentまたは大会名が並ぶ行
- Total行
- 確定、不使用、アップグレードなどPrizeの状態が分かる行
- PW COIN、Player、1人分などPrize単位が分かる行
- 1位、2位、3位など順位別金額の行

Total行、Prize状態行、PW COIN行、順位行のどれかが無い場合はPLANを作れません。不要な説明行があっても構いませんが、大会名・Prize状態・単位・順位金額の列対応をずらしません。

社内で過去に実際に使用したGoogle Sheetに同じ形式のPrize表がないか確認してください。該当する表がある場合は、表頭・空欄列・説明行を含む使用範囲全体をそのままコピーし、「大会Prize Google Sheet全体」へ貼り付けます。列の順番、表頭名、空欄列を自己判断で整理・変更しません。入力元を特定できない場合は、過去の同形式表を実際の担当者またはAIに探させてから使用します。

ツールが使用するTotalは、表のTotalセルをそのまま信用せず、最終的に採用した順位別Prize明細の合計から計算します。PLAN確認では表のRaw Totalと明細合計の差も確認します。

## 1. 大会名prefixを入力する

「大会名 prefix」にPokerWeb上の対象イベントを特定できる共通名を入力します。

例：

    【JOPT 2026 Tokyo #02】

短すぎる文字や別イベントにも共通する名前を使いません。ツールはOpen Tournamentを検索するため、対象大会がPokerWebのOPEN側に存在することを先に確認します。

## 2. Prize表を貼り付ける

Google SheetのPrize表全体をコピーし、「大会Prize Google Sheet全体」へ貼り付けます。一部分だけを切り出さず、Tournament、Total、状態、PW COIN、順位行を一緒に貼ります。

## 3. PLANを作る

1. 「PLAN作成」を押します。
2. ツールがOpen Tournamentを検索し、大会名prefixに一致するPokerWeb URLを集めます。
3. Prize表の大会名とPokerWeb大会名を照合し、使用するPrize候補を選びます。
4. PLAN作成後、候補確定、人工確認、要確認、URL件数を確認します。

大会番号がある場合は番号の一致を優先します。番号がない場合は大会名を比較します。同名、近似名、Day違い、候補複数を推測で確定しません。

## 4. 「要確認」を処理する

自動で決められない大会は要確認として表示されます。

1. PokerWeb候補を開き、正式な大会名とTournament IDを確認します。
2. 使用Prizeの候補から正しいPrizeを選びます。
3. 正しい組み合わせであることを確認して「この内容で人工確認」を押します。
4. 候補URLが無い場合は、PokerWebの別タブで対象大会を開き、URLまたはTournament IDをコピーして「URL入力」へ入れます。

別タブで開いたPokerWeb大会はツールへ自動連携されません。URLを人がコピーして戻します。

## 5. PLAN COPYで内容を確認する

「PLAN COPY」を押し、空のGoogle Sheetへ貼り付けて次を確認します。

- PW大会名が正式な対象大会と一致する。
- 大会IDが正しい。
- 参照Prizeがその大会に使用するPrizeである。
- 判定が候補確定または人工確認になっている。
- 1位から最終順位までの金額が正しい。
- 各大会のTotalが順位別明細の合計と一致する。
- 不使用や誤ったアップグレードPrizeを採用していない。
- Tag、2on2、3on3、Twinsなどが必要人数分へ正しく展開されている。

大会名にTag、2on2、3on3などの表記がない複数人制大会は、人数を自動判定できないことがあります。必ずPLAN COPYをGoogle Sheetで確認します。

## 6. PLANを手動修正して読み直す

PLANに誤りがある場合は、Google Sheetへ貼り付けたPLAN横表を直接修正します。

PLAN横表では、各大会が列、左端が項目です。少なくとも次の項目と順位行を残します。

- PW大会名
- 大会ID
- 参照Prize
- ステータス
- 判定
- Total
- 備考
- 1位、2位、3位などの順位行

修正後は次の順で読み直します。

1. 操作画面の入力欄をCtrl+Aで全選択し、内容を削除します。
2. 修正済みPLAN横表をそのまま貼り付けます。
3. 「PLAN作成」を押します。

PW大会名、大会ID、順位行があるPLAN横表として認識された場合、URLスキャンを行わず、貼り付けたPLANを人工確認済みの入力として読み込みます。大会IDと順位金額が空の列は書き込み対象になりません。

## 7. CHECKと書込開始を使い分ける

### CHECK

CHECKは読み取り専用です。PokerWebへ書き込みません。現在のPLANとPokerWeb上のPrize、Totalを比較し、CHECK COPYで結果を出します。既に入力済みのPrize確認や、書き込み後の再確認に使用します。

### 書込開始

書込開始はPokerWebへPrize明細とTotalを実際に書き込みます。

1. 要確認が0件であることを確認します。
2. PLAN COPYを確認済みであることを確認します。
3. 「書込開始」を押します。
4. 確認ダイアログの書込対象件数とスキップ件数を確認して実行します。
5. ツールがPrizeとTotalを書き込み、その後PokerWebを再読込して検証します。

URL未確定、人工確認未完了、Prize未確定の大会は書込スキップになります。失敗行を原因確認なしで再実行しません。

## 8. 結果を保存する

- PLAN作成後：PLAN COPY
- CHECK後：CHECK COPY
- 書込後：書込コピー

各結果を空のGoogle Sheetへ貼り付け、大会名、Tournament ID、判定、Total、備考を保存します。

書込コピーに書込失敗やVerify Total不一致がある場合は、PokerWebの画面で実際のPrizeとTotalを確認します。HTTP応答だけで成功と判断しません。

## 複数人制Prize

Tag Team、2on2、Twinsは2人、3on3は3人として判定します。Prize表にPlayerまたは1人分の列がある場合、その1人分の金額を必要人数分へ展開し、順位番号を1位から連続で作ります。

例：3on3のチーム順位1位が1人10,000の場合、PW側では1位、2位、3位へ各10,000として展開されることを確認します。

大会名やPrize列に人数を判定できる表記が無い場合は自動展開を信用しません。PLAN COPYをAIへ渡し、必要人数分に順位と金額を展開したPLAN横表へ修正してから読み直します。

## Prize Game IDを照合する

PW・シーズン プライズGameID照合は単一大会用の読み取り専用ツールです。Prizeを書き換えません。

1. PokerWebで確認する大会のPrize画面を開きます。
2. シーズンDBのCSVまたはTSVをファイル選択、ドラッグ＆ドロップ、または入力欄へ貼り付けます。
3. 対応する表頭形式を使用します。

    ymf-rank,game-id,playername,memo

    または

    順位<TAB>Game_ID<TAB>プレイヤー名<TAB>memo

4. 通常大会はチーム人数1、2人制は2、3on3は3を選びます。
5. 「読込・チェック」を押します。
6. OK、OK_特殊賞合算、NG_順位、NG_GameID、NG_抽出失敗、SKIPの件数を確認します。
7. 「結果コピー」で確認用TSVを保存します。必要な場合は「GameIDのみコピー」も使用します。

確認用TSVの表頭は次の形式です。

    大会<TAB>PW順位<TAB>換算順位<TAB>説明<TAB>判定<TAB>Game_ID<TAB>金額<TAB>シーズン順位<TAB>シーズン名前<TAB>シーズンmemo<TAB>備考

NG行はGame ID、順位、チーム人数、特殊賞の説明を人が確認します。

## 完了確認

- Prize表のTournament、Total、状態、PW COIN、順位行を正しく読み取っている。
- 全大会のPokerWeb大会名とTournament IDが正しい。
- 要確認が残っていない。
- 使用Prize、順位別金額、明細合計、Totalが正しい。
- 複数人制が必要人数分へ展開されている。
- 書込後のCHECK COPYが全対象で一致している。
- Prize Game ID照合に未確認のNG行が残っていない。
`,
    },
  ),
  task(
    'TASK-PW-COIN', 10, 'PW Coin 自動リクエスト', 'Prize',
    '支払対象と未払いPrizeを照合し、対象者へPW Coinを順番にリクエストする。', 60,
    '基本処理は使用可能。支払条件やPrize形式の変更時は更新と実機確認が必要。',
    '易', 'コインPrize管理Sheetには多数の大会が含まれるため、表頭を含め、今回使用する大会分のTournament Prizeだけを選んで貼り付ける必要があります。',
    [res('RES-PW-COIN-TM', 'PW Prize Coin Batch', 'Tampermonkey', 'Tampermonkey / PokerWeb / TSV', 'クリックしてインストール', raw('tampermonkey/pw-prize-coin-batch.user.js'), 'tampermonkey/pw-prize-coin-batch.user.js', '未払いPrizeを照合してPW Coinをリクエストする。')],
    {
      markdown: `# PW Coin 自動リクエスト AI操作マニュアル

## このタスクで行う仕事

社内のPrize支払管理表を唯一の支払基準として、Transfer MethodがPOKERWEB COINで未履行Prizeが残っている対象だけをCHECKし、確認済み対象へPW Coinを一件ずつリクエストします。

## 使用するツール

- PW Prize Coin Batch（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-coin-batch.user.js

PokerWebを操作するブラウザと同じブラウザ・同じProfileへインストールし、PokerWebを再読み込みします。

## 実行元TSVの取得方法

このツールは簡単な4列TSVではなく、過去から使用しているPrize支払管理表の列構成を読み取ります。社内で過去に実際に使用したGoogle Sheetに同じ形式の表がないか確認してください。該当する表がある場合は、表頭・空欄列を含む使用範囲全体をそのままコピーし、「実行元TSV」へ貼り付けてください。列の順番、同名表頭、空欄列を自己判断で整理・変更しないでください。

TSVファイルを別途作る必要はありません。Google Sheetの使用範囲全体を選択してコピーすると、列がTAB区切りのTSVとしてクリップボードへ入り、そのまま「実行元TSV」へ貼り付けられます。

入力元Sheetを特定できない場合は、過去にPW Coin支払を行った担当者またはAIへ同形式のPrize支払管理表を探させ、その表を基準にします。新しい簡易表を推測で作成しません。

## 必要な表頭

表の途中に説明行があっても構いませんが、次の条件を満たす表頭行を必ず含めます。

- # Tournament
- Transfer Method
- 未履行prize
- GameIDが2列

ツールは2つあるGameID列のうち、後ろ側のGameIDをPW付与対象として使用します。同名表頭を1列へ統合しません。

次の列は確認表示に使用します。元の表にある場合は残します。

- Place
- Note
- Family Name / Given Name
- Nick Name

処理条件：

- Transfer Methodが「POKERWEB COIN」の行だけが対象です。
- 未履行prizeは0以上の整数で、0より大きい行だけが対象です。
- # TournamentはPokerWeb上の大会名と厳密照合します。
- 同じ大会・同じGameIDの複数行は、未履行prizeを合計して1件の支払対象になります。

## 使用手順

1. 必要なイベントだけに絞ったPrize支払管理表を、表頭を含めてコピーします。
2. 「実行元TSV（C列 # Tournament を厳密照合）」へそのまま貼り付けます。
3. 必要な場合だけ「PokerWeb Event Scope」へイベント共通名を入力します。TSV内のTitleやSeason列は対象判定に使用されません。
4. 「CHECK ALL（読取のみ）」を押します。この段階では支払いません。
5. 対象大会、GameID、TSV構成、TSV合計、PW未払い、URL、Statusを確認します。
6. 大会が曖昧な場合はCHECKが一時停止します。「OPEN大会一覧を別タブで開く」で実際の大会名を確認し、元のタブを移動・更新せず「この大会で確認」を押します。
7. READYになった対象者、件数、金額を人が承認してから「RUN READY（実支払）」を押します。
8. 完了後に「結果TSV COPY」で結果を保存し、PW側の記録と未払い残額を再確認します。

## 注意事項

- CHECK ALLは読取専用、RUN READYは実支払です。
- 金額、GameID、大会名をAIに推測させません。
- 支払POST結果が不明な場合は全体を停止し、自動再試行しません。最初にPW側の支払記録を確認します。
- TSVをCHECK後に変更した場合は、もう一度CHECK ALLを実行します。
`,
    },
  ),
  task(
    'TASK-RECEIPT-MANUAL', 11, '領収書自動生成・送信', '領収書',
    'Google Formの申請内容とPokerWebの支払情報を照合し、領収書PDFの生成・確認・メール送信を行う。', 95,
    '実運用可能。新しいForm列、対象トーナメントまたはメール設定を追加する場合は更新が必要。',
    '難', 'PokerWeb確認用Tampermonkeyと領収書発行GSの2つを併用するため、処理手順が複雑です。申請数が多い大会では誤入力・重複申請・誤申請が増えるため、コードが自動除外する条件と、人工確認で「処理終了」「確認OK」「処理方針」をどう使い分けるかを事前に理解する必要があります。',
    [
      res('RES-RECEIPT-MANUAL-TM', 'PW 領収書 Manual Check', 'Tampermonkey', 'Tampermonkey / PokerWeb', 'クリックしてインストール', raw('tampermonkey/pw-receipt-manual-check.user.js'), 'tampermonkey/pw-receipt-manual-check.user.js', '申請単位で支払情報を確認してTSVを出力する。'),
      res('RES-RECEIPT-RSE-GS', '領収書発行・管理GS', 'Google Apps Script', 'Google Form / Google Sheets / Google Apps Script / Gmail / Drive', 'AIマニュアルで導入', raw('apps-script/ReceiptSemiAutoExperimental.gs'), 'apps-script/ReceiptSemiAutoExperimental.gs', '申請照合、番号、PDF、メールを管理する。'),
      res('RES-RECEIPT-TEMPLATE', 'Google Sheet参考例', 'Google Sheet', 'Google Sheets', '参考例を開く', 'https://docs.google.com/spreadsheets/d/1TOWDDSwA6tyiAmgK14VOssxsn3cbRbLpFrb3qBxdK14/edit?gid=1000165875#gid=1000165875', '正式使用版', '現在の正式使用版。コピーして使う場合は、表頭・Sheet構成・Apps Scriptを残し、既存大会の回答・処理データを空にする。'),
    ],
    {
      markdown: `# 領収書自動生成・送信 AI操作マニュアル

## このタスクで行う仕事

大会終了後のGoogle Form回答とPokerWebの支払情報を照合し、領収書番号の採番、PDF生成、Gmail下書き作成、確認済みメールの送信までを行います。PDFはGoogle Apps Scriptが直接生成してDriveへ保存します。HTML Rendererは使用しません。

## 最初にAIへ渡すもの

このMD全文、今回使うGoogle SheetのURL、対象大会名、対象期間、PDF保存先Driveフォルダ、使用する送信元メールアドレスを自分のAIへ渡してください。AIには、以下の順番を変えず、各CHECKの未確定行が残っていないことを確認しながら案内させてください。

## 使用するリソース

- PW 領収書 Manual Check（Tampermonkey）: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-receipt-manual-check.user.js
- 領収書発行・管理GS（Google Apps Script）: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/apps-script/ReceiptSemiAutoExperimental.gs
- Google Sheet参考例（正式使用版）: https://docs.google.com/spreadsheets/d/1TOWDDSwA6tyiAmgK14VOssxsn3cbRbLpFrb3qBxdK14/edit?gid=1000165875#gid=1000165875

## Google Sheet参考例をコピーするとき

1. 参考例をコピーし、表頭、Sheet構成、RSE_設定の設定項目、Apps Scriptは残します。
2. 参考例に残っている過去大会のForm回答、PW TSV、CHECK、管理記録などの処理データは、新しい大会へ流用する前に空にします。
3. 表頭行は削除しません。RSE_設定は設定項目を消さず、設定値だけ今回の運用に合わせます。
4. 参考例は現在の正式使用版です。ただし、コピーしたSheetが新しいGoogle Formへ自動接続されるわけではありません。

## 申請者の原始データを準備する

1. 対象大会ですでに受付を終了したGoogle Formの回答Sheetを開きます。
2. 表頭行と回答行を一緒にコピーし、新しい領収書Sheetの「フォームの回答 1」へ貼り付けます。
3. 表頭と各列の回答がずれないよう、列を並べ替えずに貼り付けます。
4. 「施設利用料への同意」など、領収書処理で使用しない列が含まれていても削除する必要はありません。
5. 主に使用する列は、Game ID、本名、領収書受け取り用メールアドレス、宛名、対象大会、対象期間の開始日・終了日です。対象期間を指定しない場合は開始日と終了日の両方を空白にします。片方だけ入力しません。

## 初期設定

1. Google Sheetに領収書発行・管理GSが入っていない場合だけ、拡張機能 → Apps Scriptを開き、GSを追加して保存します。
2. Apps Scriptエディタで最初の1回だけ RSE_setup を実行し、必要な権限を許可します。
3. Sheetを再読み込みし、「領収書 半自動 EXP」メニューが表示されることを確認します。
4. RSE_setupはRSE用の各Sheetを準備し、Form回答Sheetへ「処理終了」列を追加します。

## RSE_設定で入力する場所

| 設定項目 | 入力内容 |
|---|---|
| FORM_SHEET_NAME | Form回答を貼り付けたSheet名。通常は「フォームの回答 1」 |
| PW_SHEET_NAME | Manual Checkの支払TSVを貼るSheet名。通常は「PW TSVショウ用」 |
| NEXT_RECEIPT_NO | 次に発行する領収書番号。数字だけ、または JOPT-0001 のような接頭辞付き連番 |
| MAX_RECEIPTS_PER_RUN | 空白なら対象全件。分割したい場合だけ1回の上限件数 |
| PDF_UPLOAD_BATCH_SIZE | PDF生成中に進捗をSheetへ保存する間隔。通常は10のまま |
| MAX_EXECUTION_SECONDS | 1回の処理時間上限。通常は既存値のまま |
| RECIPIENT_MIN_FONT_MM | 長い宛名を自動縮小するときの最小文字サイズ。通常は5.5のまま |
| RECEIPT_FOLDER_URL | 生成したPDFを保存するGoogle DriveフォルダのURLまたはフォルダID |
| FROM_ALIAS | Gmailの送信元エイリアスを使う場合だけ入力。使わない場合は空白 |
| FROM_NAME | 受信者に表示する送信者名 |
| BCC | 必要な場合だけBCCアドレス |
| SUBJECT | 領収書メールの件名 |

PDF_FETCH_BATCH_SIZEは旧ブラウザ生成用であり、現在のGS直接生成では使用しません。

領収書番号はRSE_領収書CHECKへ手入力しません。メニュー6がNEXT_RECEIPT_NOから必要件数を連番で予約し、採番後にRSE_設定の次番号を自動更新します。既存領収書の差替では、原則として元の領収書番号を再利用します。

## PW 領収書 Manual Checkをインストールする

1. 普段PokerWebを操作するブラウザとブラウザプロフィールを開きます。Tampermonkeyのインストール先とPokerWebを開く場所は必ず同じにします。
2. そのブラウザにTampermonkeyが入っていない場合は、先にTampermonkey拡張機能をインストールして有効にします。
3. 「使用するリソース」にある「PW 領収書 Manual Check」のURLを同じブラウザで開きます。GSのようにコードをコピーして貼り付ける必要はありません。
4. Tampermonkeyのインストール画面が開いたら、スクリプト名が「PW 領収書 Manual Check」であることを確認し、「インストール」を押します。すでに入っている場合は更新画面から上書きします。
5. Tampermonkeyの管理画面で「PW 領収書 Manual Check」が有効になっていることを確認します。
6. 同じブラウザプロフィールでPokerWebへログインし、https://japanopt.pokerweb.com.br/ 配下の画面を開いて再読み込みします。
7. 画面右下に「PW 領収書抜き出し 人工確認版 v1.6.17」というパネルが表示されれば導入完了です。最小化されている場合は「Open」を押します。
8. パネルが出ない場合は、別のブラウザや別プロフィールへインストールしていないか、Tampermonkey本体とスクリプトの両方が有効か、開いているURLがPokerWebかを確認してから再読み込みします。

## PokerWeb支払TSVを作る

1. Google Sheetの「領収書 半自動 EXP」メニューから「3. PW 1.6.17入力を生成・表示」を実行します。
2. 「PW 1.6.17 入力」画面が開いたら「TSVをコピー」を押します。このTSVは確認済み申請から作られます。
3. Tampermonkeyを入れたのと同じブラウザプロフィールでPokerWebを開き、右下の「PW 領収書抜き出し 人工確認版 v1.6.17」パネルを表示します。
4. パネルの「Input TSV: Game ID + 対象大会 + 対象期間（1列/2列/3列対応）」欄をクリックし、以前の内容が残っている場合はすべて消してから、コピーしたTSVを貼り付けます。貼り付け先は「Candidates / 候補確認欄」や「Output」ではありません。
5. 入力TSVに表頭は付けません。最大3列で、列の区切りは空白ではなくTABです。

    Game ID<TAB>対象大会<TAB>対象期間

    51763548<TAB>JOPT<TAB>01/07/2026 - 31/07/2026

6. 1列目はGame ID、2列目は対象大会の検索語、3列目は対象期間です。3列目を空白にする行がある場合は、パネル上部の「総期間（個別期間が空白の行に使用）/ dateRange」へ期間を入力します。個別期間と総期間の両方を空白にはできません。
7. 同じGame IDで複数の大会を確認する場合は、大会ごとに1行ずつ分け、Game IDと期間を繰り返します。

    58468542<TAB>JOPT 2026 Grand Final<TAB>24/04/2026 - 20/07/2026

    58468542<TAB>JOPT 2026 Tokyo #02<TAB>24/04/2026 - 20/07/2026

    2大会名を1つのセルへ「、」で連結しません。現在の検索では1つの大会名が両方の語を含むというAND条件になり、候補が見つからないことがあります。2列目を空白にすると、指定期間内の全大会が対象になるため、意図して全大会を確認するときだけ使用します。

8. 「1. 候補大会をAPI検索」を押し、確認画面の検索単位、入力行数、期間を確認して続行します。
9. 検索完了後、「Candidates / 候補確認欄」の大会名、TournamentId、URLと「人工核查 / 仅显示需要确认的比赛」を確認します。人工確認が0件でない場合は「2. URL未解決/疑似汚染を検索」を実行し、表示されたURLを実際に開いて正しい大会だけを採用します。判断できない大会は「本次暂不处理」にし、推測で採用しません。
10. 人工確認が0件になり、今回処理する候補が「使用」になっていることを確認してから「3. 已确认比赛的支付信息」を押します。
11. 完了すると結果が「Output / TSV + NEED_CHECK + REPORT」へ表示され、現在選択中の形式でクリップボードにもコピーされます。再コピーする場合は「只复制可粘贴的领收书结果」を選び、「按所选格式复制」を押します。
12. コピーされる貼り付け用TSVには次の表頭が含まれます。

    Game ID<TAB>購入時間<TAB>年<TAB>月<TAB>日<TAB>大会名<TAB>種別<TAB>現金<TAB>クレジットカード<TAB>ポイント<TAB>USDT

13. Google Sheetへ戻り、「PW TSVショウ用」のA1を選択して貼り付けます。既存データが残っている場合は、古い大会の行を先に消し、A1から表頭ごと貼り付けます。
14. Output内のNEED_CHECKに行が出ている場合は理由を確認します。支払方法、大会URL、購入明細が未確認のまま「4. PW TSV → 領収書CHECK更新」へ進みません。

## 実行順序

1. 「1. Form → Game ID CHECK更新」を実行します。
2. RSE_GAME_ID_CHECKでGame ID、本名、メールアドレス、宛名、処理方針を確認します。
3. 確認する行の「確認OK」をONにし、「2. Game ID CHECK勾選行を確定」を実行します。
4. 「3. PW 1.6.17入力を生成・表示」でManual Check用TSVを作り、PokerWebから支払TSVを取得します。
5. 支払TSVをPW TSVショウ用へ貼り付け、「4. PW TSV → 領収書CHECK更新」を実行します。
6. RSE_領収書CHECKで本名、メールアドレス、宛名、大会名、種別、金額、処理方針を確認します。
7. 確認する行の「確認OK」をONにし、「5. 領収書CHECK勾選行を確定」を実行します。
8. 未確定行が残っていないことを確認し、「6. 未採番行へ領収書番号を採番」を実行します。
9. 「7. GSで未生成PDFを生成」を実行します。PDFはRECEIPT_FOLDER_URLのDriveフォルダへ保存されます。
10. PDFの宛名、対象大会、日付、金額、領収書番号を確認します。
11. 「8. 未作成Gmail草稿を生成」を実行し、Gmailの宛先、件名、本文、添付PDFを人が確認します。
12. 送信してよいGame IDの組長行だけ「送信OK」をONにし、「9. 送信OK → 承認済み草稿を送信」を実行します。

## 「処理終了」列の意味

- 自動：まだ処理対象です。通常の新規回答はこの状態にします。
- 完了：必要な領収書が送信済み、または対象明細がすべて対象外・重複除外として確定した申請です。メニュー9の完了同期で自動更新されます。
- 重複：そのForm回答自体を今後の処理対象から外します。誤入力を訂正するために再申請があり、古い回答を二度と採用しない場合などに手動で設定します。

処理終了が「完了」または「重複」のForm回答は、次回のCHECK更新で読み込まれません。まだ確認中の行を「完了」にしません。

## 重複申請の処理

### 同じ内容の回答が完全に重複している

同じGame ID、同じ対象期間、本名、メール、宛名が同じ回答はCHECK上で1件に統合されます。Form回答側では、残す1行を「自動」にし、不要な重複行を「重複」にすると後続の再読込を防げます。

### 同じGame ID・同じ対象期間で内容が異なる

本名、メール、宛名のどれかが異なる場合は自動確定しません。先にForm回答側で正しい申請を1件決め、誤った回答の処理終了を「重複」にします。その後メニュー1を再実行します。履歴を残したまま修正する必要がある場合は、RSE_GAME_ID_CHECKの確定値を正しい内容へ直し、修正理由を記入して「確認OK」をONにし、メニュー2で確定します。

### すでに発行済みの同一支払が再度出た

RSE_領収書CHECKの処理方針を「重複として除外」にし、修正理由へ既発行であることを記録します。「確認OK」をONにしてメニュー5で確定します。PDFやメールは新しく作りません。

## 入力間違い・確認必要の処理

### Game ID、本名、メール、宛名が間違っている

RSE_GAME_ID_CHECKの緑色の確定欄で、Game ID、確定本名、確定メールアドレス、確定宛名を修正します。処理する場合は処理方針を「採用」、申請自体を使わない場合は「除外」にします。修正理由を記入し、「確認OK」をONにしてメニュー2を実行します。

### 対象大会・対象期間が間違っている

Form回答Sheetの元データを訂正するか、誤った回答を「重複」にして正しい回答を残します。その後メニュー1からやり直します。開始日と終了日は必ず両方入力するか、両方空白にします。

### PokerWebの大会名、購入時間、支払金額が間違っている

RSE_領収書CHECKで直接金額を書き換えず、PW 領収書 Manual Checkの候補URLとNEED_CHECKを見直し、正しい支払TSVをPW TSVショウ用へ貼り直します。その後メニュー4を再実行します。

### 領収書にしない支払がある

RSE_領収書CHECKの処理方針を「対象外」にし、必要なら修正理由を記入します。「確認OK」をONにしてメニュー5で確定します。対象外行には採番、PDF生成、メール送信を行いません。

### 修正後も今後この申請を使わない

申請全体を今後読み込ませない場合は、Form回答側の処理終了を「重複」にします。Game ID CHECKだけで除外する場合は処理方針を「除外」、支払明細だけを除外する場合は領収書CHECKで「対象外」または「重複として除外」を使います。

### PDF作成後に本名・メール・宛名を直す必要がある

PDF_FILE_IDやDraft IDが入った後は、CHECK値だけを直接変更して確定しません。Game ID CHECKの正式値を修正して再度CHECKを更新し、差替判定と元の領収書番号が引き継がれることを確認します。未送信PDFの再生成は対象行を選択してメニュー7aを実行し、その後メニュー7から作り直します。送信済みの場合は自動再生成せず、管理記録と送信履歴を人が確認します。

### USDTレートが未設定

RSE_USDTレートへ対象日とUSDJPYレートを入力し、メニュー7を再実行します。既存Sheetの計算式や他の行を上書きしません。

### Gmail送信時にエラーになった

最初にGmailの送信済みを確認します。送信済みなら重複送信しません。未送信で草稿が残っていればメニュー9を再実行します。草稿が無い場合だけ組長行のDraft ID・草稿状態・送信状態を確認し、メニュー8から再作成します。

## 人が必ず確認する箇所

- RSE_GAME_ID_CHECKの確認必要行。正しい個人情報または除外方針を決めてから確認OKをONにします。
- PW 領収書 Manual Checkの候補大会、URL、NEED_CHECK。曖昧な候補を自動確定しません。
- RSE_領収書CHECKの確認必要行、差替行、重複行、対象外行。処理方針を人が決めます。
- 生成PDFの宛名、日付、大会名、金額、領収書番号。
- Gmail下書きの宛先、件名、本文、添付。確認後に送信OKをONにします。

## 完了確認

- Form回答の処理終了が、未処理は自動、送信済みは完了、使用しない重複回答は重複になっている。
- Game ID CHECKと領収書CHECKに未確定行が残っていない。
- 領収書番号に重複や欠落理由不明の行がない。
- PDFがRECEIPT_FOLDER_URLで指定したDriveフォルダに保存されている。
- Gmail下書きと添付PDFを人が確認している。
- 送信OKを付けたGame IDだけが送信済みになっている。
`,
    },
  ),
  task(
    'TASK-PRE-RESERVATION-MAIL', 12, '事前予約メール送信', 'メール',
    '事前予約Formの回答からメール種別別のREPORTとGmail下書きを作成し、確認後に送信する。', 80,
    '3on3、2on2・Tag、Heads-upの実運用テンプレートをコピーして使用可能。大会ごとにForm内容、メール本文、Form URL、LivePocket URLなどの差し替えが必要。',
    '難', '申請数が多い大会では重複申請が多く、コードの重複判定とスタッフがSheet上で行った編集・承認が一致しない場合があります。事前に重複排除ロジックを理解し、どの回答を残すか、どの回答を除外するかを人工確認する必要があります。',
    [
      res('RES-PRE-RESERVATION-GS', '事前予約メール current', 'Google Apps Script', 'Google Form / Google Sheets / Google Apps Script / Gmail', 'AIマニュアルで導入', '', 'apps-script/pre-reservation/current/PreReservationMenus.gs\napps-script/pre-reservation/current/PreReservationTemplateExtractor.gs\napps-script/pre-reservation/current/PreReservationTemplateDrivenMailer.gs\napps-script/pre-reservation/current/PreReservationColorRules.gs', '現在運用中の汎用・テンプレート方式。'),
      res('RES-PRE-RESERVATION-TEMPLATE-3ON3', '事前予約テンプレート（3on3）', 'Google Sheet', 'Google Form / Google Sheets / Gmail', 'ファイルごとコピー', 'https://docs.google.com/spreadsheets/d/1Iyfm0Y9lIeK0VH5gLO2srFLolW5ihzxVUKpUCIBMAcE/edit?gid=788200121#gid=788200121', 'フォームの回答 1 / LIVEPOCKET_GAME_ID / REPORT_PRE_RES_MAIL / PreReservationTemplateSource', '3人チーム戦用。コピー時に対応Formもコピーされるため、新しいFormを別途作成しない。'),
      res('RES-PRE-RESERVATION-TEMPLATE-2ON2', '事前予約テンプレート（2on2 / Tag）', 'Google Sheet', 'Google Form / Google Sheets / Gmail', 'ファイルごとコピー', 'https://docs.google.com/spreadsheets/d/1sv1IvT8GNGM1Nhol7Fh7MDEX81qBj6FbnIyV5splh1o/edit?gid=1359156924#gid=1359156924', 'フォームの回答 3 / LIVEPOCKET_GAME_ID / REPORT_PRE_RES_MAIL / PreReservationTemplateSource', '2人チーム戦・Tag用。コピー時に対応Formもコピーされるため、新しいFormを別途作成しない。'),
      res('RES-PRE-RESERVATION-TEMPLATE-HEADSUP', '事前予約テンプレート（Heads-up）', 'Google Sheet', 'Google Form / Google Sheets / Gmail', 'ファイルごとコピー', 'https://docs.google.com/spreadsheets/d/1fGO24N_qYNi_WVz5SiVwUYoqVHDc8P5KTEVIeuAnnKQ/edit?gid=327898353#gid=327898353', 'フォームの回答 1 / LIVEPOCKET_GAME_ID / REPORT_PRE_RES_MAIL / PreReservationTemplateSource', 'Heads-up用。コピー時に対応Formもコピーされるため、新しいFormを別途作成しない。'),
    ],
    {
      markdown: `# 事前予約メール送信 AI操作マニュアル

## このタスクで行う仕事

大会形式に合う事前予約テンプレートをファイルごとコピーし、コピー時に作成されたGoogle Formとメール設定を新大会用へ変更します。Form回答からREPORTとGmail下書きを作成し、人が確認したメールだけを送信します。

## 最初にAIへ渡すもの

このMD全文、使用するテンプレート、新しい大会名、開催日時、受付時間、会場、定員、支払方法、金額、予約締切、LivePocket URL、正式なメール本文を自分のAIへ渡してください。AIには既存の数式とメール構成を残し、大会固有の情報だけを差し替えさせてください。

## 大会形式に合うテンプレートを選ぶ

- 3on3: https://docs.google.com/spreadsheets/d/1Iyfm0Y9lIeK0VH5gLO2srFLolW5ihzxVUKpUCIBMAcE/edit?gid=788200121#gid=788200121
- 2on2・Tag: https://docs.google.com/spreadsheets/d/1sv1IvT8GNGM1Nhol7Fh7MDEX81qBj6FbnIyV5splh1o/edit?gid=1359156924#gid=1359156924
- Heads-up: https://docs.google.com/spreadsheets/d/1fGO24N_qYNi_WVz5SiVwUYoqVHDc8P5KTEVIeuAnnKQ/edit?gid=327898353#gid=327898353

3on3は3on3、2on2・Tagは2on2・Tag、Heads-upはHeads-upのテンプレートを使用します。参加人数とFormの質問構成が異なるため、別形式のテンプレートを流用しません。

## 1. テンプレートをファイルごとコピーする

1. 対応するGoogle Sheetを開き、「ファイル → コピーを作成」で新大会用ファイルを作ります。
2. コピー後のファイル名を新大会名へ変更します。
3. 本テンプレートでは、Google Sheetをコピーすると対応するGoogle Formも同時にコピーされ、コピー後の回答Sheetへ接続された状態になります。
4. 新しいFormを別途作成・複製しません。回答保存先の再接続も行いません。

## 2. コピーされたFormを編集する

1. コピー後の回答Sheetを開き、「ツール → フォームを管理 → フォームを編集」を選びます。
2. 開いたFormのURLがコピー元Formと異なることを確認します。
3. Formのタイトル、説明、大会名、開催日、受付期間、支払方法、チケット、注意事項を新大会用へ変更します。
4. 3on3は3人、2on2・Tagは2人、Heads-upは1人用の質問構成を維持します。
5. メールアドレス、プレイヤーネーム、GameID、決済方法選択など、GSが使用する質問名を無確認で変更しません。
6. Formの編集URLと回答者用URLを取得します。

## 3. コピー元の処理データを空にする

AIに各Sheetの表頭と数式を確認させ、次の旧大会データだけを空にします。

- 回答Sheet：旧申込者の回答行と処理状態。上部の大会設定、メールボタン、集計式、表頭、チェックボックス、色分けは残す。
- LIVEPOCKET_GAME_ID：表頭を残し、旧Game IDと照合結果を空にする。
- REPORT_PRE_RES_MAIL：表頭を残し、旧REPORT、Draft ID、送信状態を空にする。
- PreReservationTemplateSource：表頭を残し、旧大会の抽出結果を空にする。

列、表頭、数式、Gmail HYPERLINK、Apps Scriptを削除しません。

## 4. 回答Sheet上部を新大会用へ変更する

コピーした回答Sheet上部で、少なくとも次を変更します。

- 大会名とファイル名
- 予約締切、支払期限の基準（支払期限が空白の場合はREPORT生成ボタンを押した時刻から自動計算）
- マックス
- Form編集URL
- Form回答者用URL
- LivePocket URL
- 金額、会場、開催日時、受付時間

古い大会名、古い金額、古いForm URL、古いLivePocket URLが残っていないか、AIにA1:L20とHYPERLINK数式を確認させます。

## 5. Gmail HYPERLINKの件名・本文を変更する

回答Sheet上部のメールボタンはGmail作成画面を開くHYPERLINK数式です。対象セルの数式をAIへ渡し、次の大会固有情報だけを新大会用へ差し替えます。

- 件名の大会名
- 本文の大会名
- 支払方法と金額
- LivePocket URL
- 支払期限の案内
- 会場、住所、開催日時、受付時間
- 参加人数と受付方法
- 担当者名など今回変更が必要な正式文言

HYPERLINK、ENCODEURL、CHAR(10)、引用符、括弧、メールボタンの表示名は壊しません。AIにメール本文を新規作成させず、担当者が確認した正式原文を使用します。

次のメールボタンを一つずつ開き、件名と本文を確認します。

- コイン支払案内
- LivePocket支払案内
- 決済完了・選手契約履行の当日案内
- 当日案内
- キャンセル通知

## 6. メールテンプレートを再抽出する

1. Gmail HYPERLINKを置いた回答Sheetを開きます。
2. 「事前予約テンプレート → メール変更時だけ：現在の表からテンプレート再抽出」を実行します。
3. PreReservationTemplateSourceで、新大会名、件名、本文、mail_typeを確認します。
4. mail_typeがunknownの行、旧大会名、旧URLが残っている行は使用しません。

## 7. テストする

1. コピーされたFormから自分のテスト回答を1件送信します。
2. コピー後の回答Sheetへ自動追加されることを確認します。
3. 回答、管理列、支払期限、Form URL、LivePocket URLを確認します。
4. REPORTを1件作成し、Gmail下書きで宛先、件名、本文、金額、日付、URLを確認します。
5. テスト行は手動指示を「テスト」にして本番対象から除外します。

## 本番運用

1. 重複申請を整理し、LivePocket決済確認を反映します。
2. 必要なREPORTを作成します。
3. Gmail下書きを作成し、人が内容を確認します。
4. 送信する行だけ送信OKをONにします。
5. 「REPORTの送信OKメールを送信」を実行します。

## 完了確認

- 大会形式に合うテンプレートをコピーしている。
- コピー時に作成されたFormを使用し、別のFormを新規作成していない。
- Form回答がコピー後の回答Sheetへ追加される。
- 旧大会の回答、Game ID、REPORT、Draft ID、メール本文が残っていない。
- Form URL、LivePocket URL、大会名、金額、会場、日時が新大会用になっている。
- 5種類のメール本文とGmail下書きを人が確認している。
`,
      _legacyMarkdown: `# 事前予約メール送信 AI操作マニュアル

## このタスクで行う仕事

新しい事前予約Google Formを作り、その回答先を大会用Google Sheetへ接続します。Form回答から支払案内、決済完了・当日案内、キャンセル通知などのREPORTとGmail下書きを作り、人が確認したメールだけを送信します。

## 最初にAIへ渡すもの

このMD全文、現行運用テンプレートのURL、新しい大会名、Google Formに必要な質問、支払方法、金額、定員、予約締切、LivePocket URL、使用する正式な件名・本文を自分のAIへ渡してください。メール本文は担当者が用意した原文を使用し、AIに内容を勝手に補作・変更させません。

## 使用するリソース

- 現行運用テンプレート: https://docs.google.com/spreadsheets/d/1fGO24N_qYNi_WVz5SiVwUYoqVHDc8P5KTEVIeuAnnKQ/edit?gid=327898353#gid=327898353
- PreReservationMenus.gs
- PreReservationTemplateExtractor.gs
- PreReservationTemplateDrivenMailer.gs
- PreReservationColorRules.gs

4つのGSファイルは同じApps Scriptプロジェクトへ入れます。ファイル名と役割を混ぜません。

## 全体の関係

1. 新しいGoogle Formが申込を受け付ける。
2. Formの回答先として指定したGoogle Sheet内に、新しい「フォームの回答」Sheetが作られる。
3. 回答Sheetの管理列で、決済メール、決済確認、当日案内、キャンセル、支払期限、手動指示を管理する。
4. 大会設定用SheetのGmail hyperlinkから、PreReservationTemplateSourceへ件名と本文を抽出する。
5. REPORT_PRE_RES_MAILがForm回答とテンプレートを組み合わせる。
6. REPORTからGmail下書きを作り、送信OKを付けた行だけ送信する。

## 新しい大会用Google Sheetを作る

1. 現行運用テンプレートをファイルごとコピーします。元の正式運用ファイルへ新大会のデータを書きません。
2. コピー後、既存の申込回答、LIVEPOCKET_GAME_ID、REPORT_PRE_RES_MAILの処理結果を新大会へ持ち越さないよう空にします。表頭、管理列、Gmail hyperlink、PreReservationTemplateSourceの表頭、Apps Scriptは残します。
3. コピー元の「フォームの回答 1」は新Formには接続されません。旧回答を消しただけでは新Formの回答先になりません。
4. コピー元の回答・メール設定を一体化したSheetを残す場合は「事前予約設定」などへ改名し、新しいFormが作る「フォームの回答」Sheetと区別します。
5. 設定用SheetのA1、A2またはA3に「新しい大会名 予約確認」と入力します。末尾の「予約確認」はテンプレート抽出時に自動で外れます。
6. 設定用SheetのA1:L20内に、Form編集URL、回答用URL、Gmail hyperlink、LivePocket URL、マックスを配置します。抽出ツールはA1:L20だけを読み取ります。

## 新しいGoogle Formを作って回答先を接続する

1. 現行Formを複製するか、新しいGoogle Formを作成します。
2. 大会名、説明、受付期間、選択肢を新大会用に更新します。古い大会名、古い金額、古い日付、古いLivePocket URLが残っていないか確認します。
3. Formの「回答」画面から回答の保存先を選び、「既存のスプレッドシートを選択」で先ほどコピーした大会用Google Sheetを指定します。
4. Google Formが新しい「フォームの回答」Sheetを作ったことを確認します。既存のSheetを手動コピーしただけではForm接続になりません。
5. テスト回答を1件送信し、新しい回答Sheetへ自動追加されることを確認します。ここを確認する前にメール処理へ進みません。

## Formの質問名と回答Sheetの表頭

最低限、次の情報をFormで取得します。質問文を大きく変更した場合は、回答Sheetの表頭が現在のGSの認識名に合うかAIに確認させます。

- メールアドレス、または代表者のメールアドレス
- プレイヤーネーム【代表者】、プレイヤーネーム、またはお名前
- GameID【代表者】、Game ID【代表者】、GameID、またはGame ID
- 決済方法、または決済方法選択
- バウチャー回答を使用する場合は、現行テンプレートと同じバウチャー質問

タイムスタンプはFormが自動作成します。列の並びは固定ではありませんが、表頭名を空白にしたり、同じ意味の管理列を複数作ったりしません。

## 新しい回答Sheetへ追加する管理列

Formが作った回答列の右側へ、次の表頭を1回ずつ追加します。

- 決済メール送信
- 決済確認
- 当日案内メール
- キャンセルメール
- 支払期限
- 手動指示

決済メール送信、決済確認、当日案内メール、キャンセルメールはチェックボックスにします。支払期限は日付形式にします。手動指示は「事前予約メール送信 → 手動指示の選択肢を設定」で、キャンセル、キャンセル通知済、テスト、重複、スキップの選択肢を設定します。

回答Sheetを開いた状態で「事前予約色分け → 現在の表に色分けルールを適用」を実行します。決済済み、期限前、期限当日、期限超過、キャンセル・除外が色で区別されます。

## 大会ごとに設定する値

- 大会名：設定用SheetのA1～A3のどこかに置く。
- マックス：A1:L20内に「マックス」と入力し、その右または下のセルに定員数を入力する。
- LivePocket URL：A1:L20内に「LivePocket URL」と入力し、その右または下のセルに今回のURLを入力する。
- Form編集URLと回答用URL：コピー元の古いForm URLを、新しいFormの編集URLと回答用URLへ差し替える。
- 支払期限：回答Sheetの支払期限列へ個別入力できる。空白の場合はREPORT生成ボタンを押した時刻から現在のルールで自動計算されるため、今回の運用期限と合うか必ず確認する。
- 送信元：現行コードは customer@japanopenpoker.com を使用する。実行アカウントでこの送信元を利用できる必要がある。

## Gmail hyperlinkとメール本文の仕組み

設定用Sheetのメールボタンは、Gmail作成画面を開くURLを持つHYPERLINKです。テンプレート抽出ツールは、A1:L20にある次の形式で始まるリンクだけを読み取ります。

    https://mail.google.com/mail/?view=cm&fs=1

各リンクのURLに、to、bcc、su、bodyが含まれます。suが件名、bodyが本文です。参考例のHYPERLINK式をコピーし、URLの骨組み、ENCODEURL、改行、引用符を壊さず、正式な件名と本文だけを新大会用へ更新します。長い式を手作業で部分修正する場合は、必ずAIに式の括弧と引用符を確認させます。

メールボタンの表示名と件名から、次のmail_typeが判定されます。

- コインまたはcoin：coin_payment
- LivePocket：livepocket_payment
- 当日案内かつ決済完了または選手契約履行：contract_confirmed
- 当日案内：day_guide
- キャンセル：cancel

表示名が曖昧だとunknownになり、そのメールはREPORTに出ません。

## 本文で使用できる差し込み記号

事前予約メールで自由な {{表頭}} 置換はできません。現在のコードが正式に置換する記号は次の5つだけです。

- {{NAME}}：Form回答のプレイヤーネーム
- {{EVENT_NAME}}：設定用Sheetから取得した大会名
- {{GAME_ID}}：Form回答のGame ID
- {{PAYMENT_DEADLINE}}：支払期限
- {{LIVEPOCKET_URL}}：設定用SheetのLivePocket URL

正しい例：

    {{NAME}}様
    「{{EVENT_NAME}}」へお申込みいただきありがとうございます。
    Game ID：{{GAME_ID}}
    お支払い期限：{{PAYMENT_DEADLINE}}
    お支払い用リンク：{{LIVEPOCKET_URL}}

波括弧は半角の {{ と }} を使い、記号名は上記の英大文字と完全一致させます。日本語の【】や全角括弧は差し込み記号ではありません。{{test@gmail.com}}のように実際のメールアドレスを括弧へ入れても置換されません。送信先メールアドレスはForm回答の「メールアドレス」列から自動取得します。

旧テンプレートの「様」だけの行、空白の支払期限行、空白のLivePocketリンク行も一部自動補完されますが、行位置や文言に依存します。新しく作る本文は上記5つの明示的な記号を使用します。

## テンプレートを反映する

1. 設定用Sheetで5種類のGmail hyperlinkの件名、本文、BCC、mail_type判定用の表示名を確認します。
2. 設定用Sheetを開いた状態で「事前予約テンプレート → メール変更時だけ：現在の表からテンプレート再抽出」を実行します。
3. PreReservationTemplateSourceに、抽出日時、source_sheet、source_cell、event_name、template_label、mail_type、to、bcc、subject、body、link_urlが作成されます。
4. 今回のevent_nameについて5種類が揃い、unknownが無いことを確認します。
5. 同じsource_sheet・event_nameで再抽出すると、その大会の古い抽出行を置き換えます。メールを変更していないのに何度も再抽出しません。

## 申込と決済を管理する

1. 「重複申請を整理（最新を残す）」で同じメールまたはGame IDの重複を整理します。決済確認済みが1件ある場合はその行を残します。決済確認済みが複数ある場合は自動処理を停止するため、人が確認します。
2. テスト、重複、スキップは手動指示で除外します。キャンセル通知を作る行は「キャンセル」、送信後は「キャンセル通知済」になります。
3. LivePocket決済済みGame IDの全件リストをLIVEPOCKET_GAME_IDのA2以降へ貼り付け、「LivePocket決済確認を反映」を実行します。
4. 照合結果、プレイヤーネーム、元シート行を確認し、入力重複、旧重複、複数候補、未一致を人が処理します。
5. 「申込・決済人数を監査」で定員、現在の有効申込数、決済完了数、残枠を確認します。

## REPORT、下書き、送信

1. 目的に合うREPORTメニューを選びます。全対象を一度に作るか、COIN支払案内、LivePocket支払案内、選手契約履行 当日案内、当日案内、キャンセル通知を分けて作ります。
2. REPORT_PRE_RES_MAILのsource_sheetとsource_rowが、送信予定のForm回答行と一致することを確認します。
3. mail_type、email、player_name、game_id、payment_method、payment_deadline、subject、bodyを確認します。
4. Gmailリンクを開き、差し込み後の本文を少数件で確認します。
5. 「REPORTのGmail下書きを作成」を実行します。Draft IDとDraft Statusを確認し、Gmail上でも宛先、BCC、件名、本文を確認します。
6. 送信する行だけ送信OKをONにし、「REPORTの送信OKメールを送信」を実行します。
7. 送信後、元の回答Sheetの決済メール送信、当日案内メール、キャンセルメールが対象mail_typeに応じて更新されたことを確認します。

## よくある停止原因

- Form回答が新しいSheetへ増えない：新Formの回答保存先がコピー先Google Sheetになっていません。Form側から接続し直します。
- 元の回答Sheetを特定できない：タイムスタンプ、メールアドレス、プレイヤーネームまたはGame IDの表頭を確認し、新Formが作った回答Sheetを開いてから実行します。
- テンプレートが見つからない：PreReservationTemplateSourceのevent_nameと設定用Sheetの大会名、mail_typeを確認します。
- 本文の差し込みが残る：記号が {{NAME}} などの正式な5種類と完全一致しているか、全角括弧になっていないか確認します。
- LivePocket URLが空白：設定用SheetのA1:L20に「LivePocket URL」とURLが隣接しているか確認します。
- 下書き作成で送信元エラー：実行アカウントのGmailで customer@japanopenpoker.com が送信元またはエイリアスとして使えるか確認します。
- REPORTが0件：すでに送信済み、決済済み、手動除外、バウチャー回答、mail_type不明、重複競合のいずれかを確認します。

## 完了確認

- 新Formのテスト回答が新しい回答Sheetへ自動追加される。
- 回答Sheetに必要な管理列と色分けルールがある。
- 大会名、マックス、LivePocket URL、Form URLが新大会用になっている。
- PreReservationTemplateSourceに必要な5種類のmail_typeがあり、件名と本文が正式原文と一致する。
- {{NAME}}などの差し込み結果、支払期限、LivePocket URLがREPORTで正しい。
- 重複、テスト、スキップ、キャンセル、決済済みの状態が正しい。
- Gmail下書きを人が確認し、送信OKを付けた行だけ送信している。
`,
    },
  ),
  task(
    'TASK-MIX-CONFIRMATION', 13, 'MIX参加確認受付', '受付',
    '固定端末で参加確認を受け付け、確認時刻と端末情報をGoogle Sheetへ記録する。', 99,
    '実運用可能。対象トーナメントや確認文言を変更する場合は設定更新が必要。',
    '易', '日常利用は専用端末で確認ボタンを押すだけです。同じブラウザで複数のGoogleアカウントを使用すると、正しいアカウントが選ばれずAppを開けない場合があります。',
    [
      res('RES-MIX-KIOSK-APP', 'MIXトーナメント確認APP', 'Web App', '専用端末', 'Web Appを開く', 'https://script.google.com/macros/s/AKfycbx8HiDs4qrnRvqRI71xi4cEWZ4ixyfUOfmksmeDDITHDOPVqWrYoT96-w7T3BFSqI2n/exec', 'apps-script/entry-confirmation-kiosk/', '同じブラウザで複数Googleアカウントへログインしない。'),
      res('RES-MIX-KIOSK-GS', 'MIXトーナメント確認Kiosk ソース', 'Google Apps Script', 'Google Sheets / Google Apps Script / Web App', 'AIマニュアルで導入', '', 'apps-script/entry-confirmation-kiosk/Code.gs\napps-script/entry-confirmation-kiosk/Index.html\napps-script/entry-confirmation-kiosk/appsscript.json', '別のSheetへ展開する場合に使用する。'),
    ],
    {
      preparation: ['標準URLと専用端末を用意する。'],
      steps: ['Web Appを開く。', '確認ボタンを一度押す。', '完了表示とSheet記録を確認する。'],
      checks: ['日本時間、端末ID、記録IDが追加される。'],
      warnings: ['複数Googleアカウントを同じブラウザで同時利用しない。'],
    },
  ),
  task(
    'TASK-BULK-MAIL', 14, 'メール一括自動送信', 'メール',
    'Google Sheetの宛先と差し込み項目からGmail下書きを一括作成し、確認後にまとめて送信する。', 80,
    '汎用メール送信フローは運用可能。差し込み列や添付条件を変更する場合は設定確認が必要。',
    '易', '差し替える項目はすべて{{表頭名}}の形式で指定します。添付ファイルはGoogle Driveへ保存し、設定にはそのファイルのURLを使用する必要があります。',
    [
      res('RES-BULK-MAIL-GS', '汎用Google Sheetメール送信', 'Google Apps Script', 'Google Sheets / Google Apps Script / Gmail', 'AIマニュアルで導入', raw('apps-script/GenericSheetMailer.gs'), 'apps-script/GenericSheetMailer.gs', '差し込み、添付、Gmail下書き、承認送信を行う。'),
      res('RES-BULK-MAIL-SAMPLE', 'Google Sheet参考例', 'Google Sheet', 'Google Sheets / Gmail', '自分用にコピー', 'https://docs.google.com/spreadsheets/d/1wYbAfWXJ1HkMQgL3TeIRnkF24diUpLjunSTxlcyDCkk/edit?gid=0#gid=0', '送信データ / メール本文', 'Shaの作成例。共同運用せず、各担当者が自分用のファイルをコピーして使用する。'),
    ],
    {
      markdown: `# メール一括自動送信 AI操作マニュアル

## このタスクで行う仕事

Google Sheetの「送信データ」1行を1通のメールとして読み取り、「メール本文」の件名・本文へ表頭名で差し込みます。Gmail下書きを作り、人が確認して送信OKを付けた下書きだけを送信します。

## 自分用のGoogle Sheetを作る

参考例: https://docs.google.com/spreadsheets/d/1wYbAfWXJ1HkMQgL3TeIRnkF24diUpLjunSTxlcyDCkk/edit?gid=0#gid=0

これはShaが作成した運用例です。同じファイルを複数人で共同使用せず、各担当者がファイルをコピーして自分用のGoogle Sheetを作ります。コピー後は参考データの宛先、Draft ID、処理結果、送信日時、本文、添付URLを残したまま使用しません。

コピーしたファイルに汎用Google Sheetメール送信GSが無い場合だけ、拡張機能 → Apps Scriptを開き、GenericSheetMailer.gsを追加して保存します。Sheetを再読み込みして「汎用メール」メニューを確認します。

## GSで自分の送信元を確認する

GenericSheetMailer.gs上部のGENERIC_MAIL_CONFIGで、次を自分の運用に合わせます。

- from：実際に送信するGmailアドレス、または利用可能な送信元エイリアス
- senderName：受信者に表示する送信者名
- bcc：毎回BCCへ入れるアドレス

fromが自分のGmailアカウントでも利用できるアドレスでない場合、下書き作成は停止します。別担当者の設定をそのまま使いません。

## 必要な2つのSheet

### 送信データ

1行目が表頭、2行目以降が送信データです。固定で必要な表頭は「メールアドレス」です。差し込みに使う列は自由に追加できます。

例：

    Player Name<TAB>メールアドレス<TAB>大会名<TAB>クーポンコード<TAB>送信対象<TAB>送信OK<TAB>Draft ID<TAB>処理結果<TAB>送信日時

運用列の意味：

- メールアドレス：各行の送信先。表頭名は完全一致が必要。
- 送信対象：任意列。列が無い場合は、有効なメールアドレスがある全行が下書き対象。列を作った場合はTRUE、1、送信、OK、〇、○の行だけが対象。
- 送信OK：Gmail下書きを人が確認した後、実際に送る行だけOKまたはチェックを入れる。
- Draft ID：作成したGmail下書きのID。GSが入力する。
- 処理結果：下書き作成済み、送信済み、重複除外、エラーなど。GSが入力する。
- 送信日時：送信成功時にGSが入力する。

「汎用メール → 初期シートを作成」を実行すると、必要な運用列が準備されます。既存データは上書きされません。

### メール本文

- A1に「件名」、B1に件名テンプレート
- A2に「本文」、B2に本文テンプレート
- A3に「添付ファイル」、B3に全員へ共通添付するGoogle Drive URLまたはファイルID

複数の添付はB3の同じセル内で1行に1ファイルずつ入力します。添付を使わない場合はB3を空白にします。

## {{XXX}}差し込みの正式ルール

件名または本文に {{表頭名}} と書くと、送信データの同じ行にあるその列の値へ置き換わります。XXXへ入れるのは実データではなく、「送信データ」1行目の表頭名です。

送信データ：

    Player Name<TAB>メールアドレス<TAB>大会名
    Yamada Taro<TAB>taro@example.com<TAB>JOPT Tokyo

本文：

    Hi {{Player Name}},
    {{大会名}}のご案内です。

生成結果：

    Hi Yamada Taro,
    JOPT Tokyoのご案内です。

記号は半角の {{ と }} を使います。括弧の内側の前後に空白があっても読み取れますが、表頭名自体は送信データの1行目と完全一致させます。大文字・小文字、半角・全角、内部の空白が違う名前は別の表頭として扱います。

正しい例：

- {{Player Name}}
- {{氏名}}
- {{大会名}}
- {{クーポンコード}}

誤った例：

- {{taro@example.com}}：メールアドレスの実データであり、表頭名ではない。
- 【氏名】：【】は差し込み記号ではない。
- {{名前}}：送信データの表頭が「氏名」の場合は一致しない。

テンプレートに存在する {{XXX}} と同名の表頭が無い場合は、送信前チェックがエラーで停止します。表頭はあるが対象行の値が空白の場合も、その行は「差し込み値が空です」となり下書きを作りません。

## 原始データを送信データへ合わせる

1. 元のGoogle Sheet、CSV、TSVから必要列を確認します。
2. 新しい「送信データ」の1行目に、使用する表頭を重複なしで作ります。
3. 元データの各列を、対応する表頭の下へ貼り付けます。メールアドレスと氏名などの列をずらしません。
4. 件名・本文で差し込みたい列だけ {{表頭名}} を使います。差し込みに使わない列はそのまま残しても問題ありません。
5. 数値、日付、URLはSheetに表示されている文字列がそのままメールへ入ります。希望する表示形式をSheet側で整えてから下書きを作ります。

## 添付ファイル

- B3へGoogle DriveのファイルURLまたはファイルIDを入力する。
- 複数ファイルはセル内改行で分ける。
- 実行するGoogleアカウントがそのファイルを閲覧できる必要がある。
- Google Docs、Google Sheets、Google Slides、Google DrawingsはPDFへ変換して添付される。
- 共通添付は全送信対象へ同じファイルが付く。行ごとに別添付を切り替える機能ではない。
- 最大250ファイル、合計25MBまで。通常はGmail側の制限を考慮し、必要最小限にする。

## 実行手順

1. まずテスト用の自分のメールアドレスを1行用意します。
2. 送信対象列を作り、テスト行だけTRUEまたはOK、その他の行は空白にします。
3. 件名、本文、{{表頭名}}、添付ファイル、from、senderName、bccを確認します。
4. 「汎用メール → 送信前チェック」を実行します。
5. 送信対象件数、下書き作成可能件数、使用変数、添付名、エラー、重複除外を確認します。
6. 「Gmail下書きを作成」を実行します。この時点では送信されません。
7. Gmailでテスト下書きの宛先、BCC、件名、本文の改行、全差し込み値、添付を確認します。
8. テストが正しければ、本番対象行の送信対象をTRUEまたはOKにして、再度送信前チェックと下書き作成を実行します。
9. 作成された全下書きを確認し、実際に送る行だけ送信OKへOKまたはチェックを入れます。
10. 「送信OKの下書きを送信」を実行し、最終確認ダイアログで件数を確認してから送信します。

## 再実行と修正

- Draft IDがある行は下書き作成をスキップします。
- 処理結果が送信済みの行は再送しません。
- 同じメールアドレス、差し込み後の件名、差し込み後の本文が同一の行は重複除外されます。
- 下書き作成後に件名、本文、差し込み元データ、添付を変更した場合は、Gmail上の旧下書きを削除し、該当行のDraft IDと処理結果を空にしてから新しい下書きを作ります。古いDraft IDを残したまま再実行しません。
- 送信中にエラーが出た場合は、先にGmailの送信済みと下書きを確認します。送信済みか不明な状態で同じ行を再送しません。

## 完了確認

- 各担当者が自分用にコピーしたGoogle Sheetを使用している。
- 送信データのメールアドレスと各差し込み列が同じ行で対応している。
- 件名・本文のすべての {{XXX}} が実在する表頭名と一致する。
- 送信前チェックに未解決エラーがない。
- テスト下書きで差し込み、改行、BCC、送信元、添付を確認した。
- 本番下書き件数と送信対象件数が一致する。
- 人が確認して送信OKを付けた行だけ送信済みになっている。
`,
    },
  ),
  task(
    'TASK-BYBIT-DEPOSIT', 15, 'Bybit入金管理APP', '入金管理',
    'Bybitへログインせず、登録済みAPIデータソースの入金履歴を社内Web Appで確認・検索・保存する。', 80,
    '主要機能は未テスト。管理権限を持つ責任者のアカウントでAPI情報を登録し、実データの取得・表示を確認する必要がある。',
    '易', '日常利用はログイン後にデータソースを選び、更新ボタンを押すだけです。API Keyの追加・更新は管理者が行い、Secretを利用者やAIへ渡しません。',
    [res('RES-BYBIT-APP', 'Bybit 入金モニター', 'Web App', '社内ログインアカウント', '既存APPを開く', '', 'C:\\Users\\41512\\Documents\\GitHub\\bybit-deposit-monitor', '公開URLは管理画面から追記する。初回起動に時間がかかる場合がある。')],
    {
      preparation: ['スタッフ用ログイン情報と対象データソース名を確認する。'],
      steps: ['Web Appへログインする。', 'データソースを選び「Bybitから最新情報を取得」を押す。', '同期時刻と入金履歴を確認し、必要に応じて検索・CSV保存する。'],
      checks: ['選択したデータソースだけが表示される。', '同期時刻とTXID・金額・状態を確認できる。'],
      warnings: ['自動監視ではなく、更新ボタンを押した時点で取得する。', 'API Keyは読み取り専用にし、SecretをAIへ渡さない。'],
    },
  ),
  task(
    'TASK-HENDON-AI', 16, 'Hendon AI自動生成', 'データ作成',
    'イベント資料と既存テンプレートをAIへ渡し、Hendon Mob提出用のTHM_EVENTS・THM_RESULTSを生成して検証する。', 80,
    'Fukuoka版で生成実績あり。イベントごとに元データと特殊順位・参加人数を再確認する必要がある。',
    '難', 'Tag Team、3on3、Dealの順位展開と、複数日大会の参加人数集計に注意が必要です。Day 1は合算しますが、Day 2・Day 3進出者は参加人数へ再加算しません。',
    [res('RES-HENDON-FUKUOKA', 'JOPT 2026 Fukuoka #01_THM', 'Google Sheet', 'Google Sheets / AI', '参考データを開く', 'https://docs.google.com/spreadsheets/d/1MSwt2EBU7WBlEvYt3_ofgEBh5qbj8HVzp8-11AQi06k/edit', '2026 Fukuoka生成実績', '新イベントでは元資料とテンプレート構造を再確認する。')],
    {
      preparation: ['Hendon用テンプレート、正式スケジュール、参加人数、Rebuy数、Prize結果、氏名・国籍資料を用意する。', '不明な氏名・国籍は空欄にする。'],
      steps: ['AIに全Sheet名を確認させ、変更対象をTHM_EVENTSとTHM_RESULTSに限定する。', 'イベント番号、名称、日付、Buy-in、Feeを元資料から対応付ける。', 'Entries・Rebuys・Prize結果を生成する。', 'Tag Teamは1・1、2・2、3・3、3on3は1・1・1、2・2・2、3・3・3の順に順位を展開する。', 'Dealや分配調整を架空の独立順位にせず、実際の受賞者と金額へ反映する。', 'Entriesは初回参加、Rebuysは追加参加として分ける。複数日は全Day 1 flightを合算し、Day 2・Day 3進出者を再加算しない。', 'イベント数、順位、件数、Prize合計、未入力、重複を監査する。'],
      checks: ['イベント番号に重複・欠落がない。', 'Tag Team・3on3の順位数がチーム人数と一致する。', 'Dealが独立順位として残っていない。', 'Day 2・Day 3が参加人数へ重複加算されていない。', 'Prize合計が元資料と一致する。', '対象外Sheetが変更されていない。'],
      warnings: ['氏名、国籍、順位、参加人数を推測で補完しない。', 'AI生成後は件数と金額の監査結果を提出させる。'],
    },
  ),
  task(
    'TASK-USDT-AI', 17, 'USDT表 AI補助作成', 'データ作成',
    '既存Google Sheetの数式と構造を維持しながら、AIの補助でUSDT表を作成・更新する。', 70,
    'AIと利用可能な連携機能により結果の精度が変わる。構造確認、質問、作業用Sheet作成、監査までの標準手順は整備済みだが、今日と同等の品質は保証しない。',
    '普通', '既存Sheetの数式セルを壊さず、入力対象のセルだけを更新する必要があります。AIへSheet全体を渡し、数式列と手入力列を先に区別させます。',
    [res('RES-USDT-AI-MANUAL', '各大会USDT レート表', 'Google Sheet', 'Google Sheets / AI / Slack', '参考例を開く', 'https://docs.google.com/spreadsheets/d/1WkZvEnAa5Vv666wdOxJ-wBgmipt1FC8A5g-KCVq3g9k/edit', 'Google Sheet参考例（正式運用版）', '対象Sheetを1枚だけ複製して作業する。直接操作できないAIにはExcelの作業用コピーを渡す。')],
    {
      markdown: USDT_AI_MANUAL_V2,
    },
  ),
  task(
    'TASK-TOURNAMENT-CUE-AI', 18, 'トナメカンペ AI補助作成', 'データ作成',
    '既存Google Sheetのバインド機能とAIを使い、トーナメント用カンペを作成して指定コードで色付けする。', 70,
    'AIと利用可能な連携機能により結果の精度が変わる。TournamentsとSlackを使う確認手順は整備済みだが、今日と同等の判断・仕上がりは保証しない。',
    '普通', 'カンペ内容の作成に加えて、J列の色コードを完全一致で入力する必要があります。表記が違うと既存の色付け機能が反映されません。',
    [res('RES-TOURNAMENT-CUE-AI-MANUAL', '新トナメカンペ', 'Google Sheet', 'Google Sheets / AI / Slack', '参考例を開く', 'https://docs.google.com/spreadsheets/d/1aud8xDS7_WtWDooQPfH3sg8QFAjgPvjdb1dZnbb1eGk/edit', 'Google Sheet参考例（正式運用版）', '対象Sheetを1枚だけ複製して作業する。直接操作できないAIにはExcelの作業用コピーを渡す。')],
    {
      markdown: TOURNAMENT_CUE_AI_MANUAL_V2,
    },
  ),
  task(
    'TASK-TREASURY-MANAGEMENT-AI', 19, '金庫管理 AI補助作成', 'データ作成',
    'Tournamentsと受付運用を基準に、AIの補助で金庫管理の作業用Sheetを作成・監査する。', 70,
    'AIと利用可能な連携機能により結果の精度が変わる。特殊科目とSlack運用の確認手順は整備済みだが、今日と同等の判断・仕上がりは保証しない。',
    '普通', '受付で実際に扱う金額、TICKET、Qualifiers、追加科目、備考をTournamentsとSlackから確認し、原本を変えずに作業する必要があります。',
    [res('RES-TREASURY-MANAGEMENT-AI-MANUAL', '金庫管理', 'Google Sheet', 'Google Sheets / AI / Slack', '参考例を開く', 'https://docs.google.com/spreadsheets/d/1ME4f4lGIXEMi-_EnxhFv7XMGwC-RBTV3DwmAOdaOULg/edit?gid=1612435257#gid=1612435257', 'Google Sheet参考例（現行運用版）', '対象Sheetを1枚だけ複製して作業する。直接操作できないAIにはExcelの作業用コピーを渡す。')],
    {
      markdown: TREASURY_MANAGEMENT_AI_MANUAL_V1,
    },
  ),
];

const guides = [
  {
    id: 'GUIDE-APP',
    title: '本APPの使い方',
    summary: 'タスクの探し方、AI操作マニュアルの渡し方、編集・ファイル配布の方法を確認します。',
    fileName: '本APP利用マニュアル.md',
    markdown: `# カスタマーチーム AI活用・業務自動化ポータル 利用マニュアル

## 最初に行うこと

このMD全文をコピーし、普段使用している自分のAIへ貼り付けてください。対象タスクのAI操作マニュアル、使用するSheet・Form・TSV・URLも同じAIへ渡し、そのAIの案内に従って操作してください。

## APPを開く

1. japanopenpoker.comの社内アカウントでGoogleへログインする。
2. ポータルのURLを開く。
3. 開けない場合は、同じブラウザで別のGoogleアカウントが選択されていないか確認する。
4. 必要に応じて社内アカウントだけを使用するブラウザプロファイルで開く。

## タスクを使用する

1. 検索、カテゴリ、完成度、易用度から対象タスクを探す。
2. タスク名、説明、完成状況、易用度、必要なリソースを確認する。
3. 「AIマニュアル」を開き、「内容をコピー」または「MDを保存」を選ぶ。
4. マニュアルMDを自分のAIへ渡す。
5. タスクに表示されたコード、Google Sheet、Web App、入力データも必要に応じて同じAIへ渡す。
6. AIに現在の環境、変更対象、変更禁止範囲、不足情報を先に確認させる。
7. CHECKまたはプレビューを確認してから本番操作を行う。

## 配布ファイルを取得する

- TampermonkeyのGitHub Raw URLは「インストール」から開く。
- GitHubに置かれたGS・HTMLは「GitHubからダウンロード」から保存する。
- Google Driveの共有ファイルは「Driveで開く」から開き、必要に応じてDrive画面から保存する。
- Google SheetとWeb Appは「開く」から対象を確認する。

## タスクを追加・編集する

1. 「タスクを追加」または各行の「編集」を押す。
2. タスク名、説明、完成度、完成状況、易用度、利用難易度、担当者、利用者を入力する。
3. コード、Sheet、Web App、MDを「タスク内のリソース」として追加する。
4. GitHubを使用する場合は「配布URL（GitHub / Google Drive）」へRaw URLまたは通常のblob URLを貼る。
5. GitHubを使用しない場合は、作成者本人が自分のGoogle Driveへコードをアップロードする。
6. Drive側で必要な社内メンバーが閲覧できる共有設定にし、共有URLを「配布URL（GitHub / Google Drive）」へ貼る。
7. AI操作マニュアル本文を入力し、保存する。

## 削除

「削除」は公開一覧からタスクを外し、タスク、リソース、AIマニュアルを管理Sheetの削除済みページへ移動します。削除前に対象タスク名を確認してください。

## AIへ追加で伝える内容

- 使用するタスク名
- 対象のSheet、Form、TSV、URL
- テストか本番か
- 自分が行う操作とAIに案内してほしい操作
- 変更してよい範囲と変更禁止の範囲
- 表示されたエラーや不明点
`,
  },
  {
    id: 'GUIDE-TAMPERMONKEY',
    title: 'Tampermonkey導入マニュアル',
    summary: 'PokerWebを使用する同じブラウザ・同じブラウザプロファイルへTampermonkeyとPWツールを導入します。',
    fileName: 'Tampermonkey導入マニュアル.md',
    markdown: `# Tampermonkey導入マニュアル

## 最初に行うこと

このMD全文をコピーし、普段使用している自分のAIへ貼り付けてください。インストールしたいツールのAI操作マニュアルも同じAIへ渡し、そのAIの案内に従って操作してください。

## 最重要確認

Tampermonkeyは、普段PokerWebを開いて作業するブラウザの同じブラウザプロファイルへインストールしてください。PWツールも必ずその同じブラウザ・同じブラウザプロファイルでインストールしてください。

別のブラウザや別のプロファイルへインストールすると、PokerWebを開いてもツールは動きません。インストール前に、現在のブラウザでPokerWebへログインしていることを確認してください。

## Tampermonkeyを導入する

1. 普段PokerWebを使用するブラウザとブラウザプロファイルを開く。
2. そのブラウザの公式拡張機能ストアで「Tampermonkey」を検索する。
3. 提供元と権限表示を確認して拡張機能を追加する。
4. ブラウザの拡張機能一覧にTampermonkeyが表示されることを確認する。
5. 同じブラウザでPokerWebを開けることを確認する。

## PWツールをインストールする

1. 本ポータルで対象タスクを開く。
2. Tampermonkeyリソースの「インストール」を押す。
3. 表示されたスクリプト名と対象サイトを確認する。
4. Tampermonkeyのインストール操作を行う。
5. 同じブラウザ・同じプロファイルでPokerWebを再読み込みする。
6. 対象画面でツールのパネルまたは機能が表示されることを確認する。

## Google Driveで共有されたuser.jsを導入する

1. ポータルの「Driveで開く」から共有ファイルを開く。
2. Google Drive画面でファイル名と共有元を確認し、user.jsを保存する。
3. Tampermonkeyの管理画面を開く。
4. 保存したuser.jsをインポートするか、新規スクリプトへ内容を貼り付ける。
5. 保存後、同じブラウザでPokerWebを再読み込みする。

## 動かない場合

- PokerWebとTampermonkeyを同じブラウザ・同じプロファイルで開いているか確認する。
- 対象スクリプトが有効になっているか確認する。
- スクリプトの対象URLと現在のPokerWeb URLをAIに確認させる。
- 複数の類似スクリプトが同時に動いていないか確認する。
- 表示されたエラーをコピーし、ツールのAI操作マニュアルと一緒にAIへ渡す。

## 注意事項

- 内容を確認していないスクリプトをインストールしない。
- CHECKと実行が分かれている場合は、CHECK結果を確認してから実行する。
- 対象や結果が曖昧な状態で連続実行しない。
`,
  },
  {
    id: 'GUIDE-GS',
    title: 'Google Apps Script導入マニュアル',
    summary: 'claspを使わず、GSをダウンロードして対象Sheetの拡張機能から追加・貼り付け・権限許可します。',
    fileName: 'Google Apps Script導入マニュアル.md',
    markdown: `# Google Apps Script 最小導入マニュアル

## 最初に行うこと

このMD全文をコピーし、普段使用している自分のAIへ貼り付けてください。導入したいタスクのAI操作マニュアル、ダウンロードしたGS・HTML、対象Google Sheetも同じAIへ渡し、そのAIの案内に従って操作してください。

## GSをダウンロードする

1. 本ポータルで対象タスクを開く。
2. 必要なGoogle Apps Scriptリソースを確認する。
3. GitHubの場合は「GitHubからダウンロード」、Google Driveの場合は「Driveで開く」からDrive画面へ進み、GSを保存する。
4. 複数のGSやHTMLが表示されている場合は、必要なファイルをすべて保存する。

## 対象Sheetへ追加する

1. GSを使用する対象Google Sheetを開く。
2. 上部メニューから「拡張機能」→「Apps Script」を開く。
3. 既に存在するGS・HTML・設定を自分のAIに確認させる。
4. 既存ファイルを削除・上書きせず、左側の追加ボタンから新しいスクリプトファイルを作る。
5. ダウンロードしたGSをテキストで開き、内容をすべてコピーして新しいスクリプトファイルへ貼り付ける。
6. 複数のGSはファイルごとに追加する。
7. HTMLファイルが必要な場合は、追加ボタンからHTMLを選び、HTMLの内容を貼り付ける。
8. 保存する。

## 初回実行と権限許可

1. タスクのAI操作マニュアルに記載された初期設定関数または確認関数を選ぶ。
2. 関数名と実行内容を自分のAIに確認させる。
3. 実行ボタンを押す。
4. 権限確認が表示されたら、対象Sheetを使用する社内アカウントを選ぶ。
5. 表示された権限の内容を確認し、タスクに必要な権限だけを許可する。
6. 実行ログまたは完了表示を確認する。
7. Google Sheetを再読み込みし、追加されたメニューや結果を確認する。

## 既存Sheetへ導入する際の確認

- 既存の関数名と重複していないか。
- 同じ定数名や設定キーが既に存在しないか。
- 対象Sheet名、列名、開始行が現在の表と一致するか。
- 数式、ARRAYFORMULA、保護範囲を上書きしないか。
- Form回答ページをコピーしただけになっていないか。

Google Formの回答先は、表をコピーしただけでは新しいFormへ自動接続されません。Formを使用するタスクは、新しいFormが作成した回答ページと、GS・数式・他ページの参照先を自分のAIに確認させてください。

## AIへ依頼する内容

- ダウンロードした全ファイル
- 対象Google SheetのURL
- タスクのAI操作マニュアル
- 現在あるGS・HTMLの一覧
- 変更してよいSheet・列・セル
- 最初に実行する関数と期待する結果
- 表示された権限画面、エラー、実行ログ

## 注意事項

- この手順ではclaspを使用しない。
- 既存コードを無確認で置き換えない。
- 初回から送信・削除・一括更新の関数を実行しない。最初は設定またはCHECKを行う。
- AIが現在のSheet構成を確認できない場合は、作業を止めて不足情報を追加する。
`,
  },
];

function manualFileName(item) {
  return `${item.id}_${item.name.replace(/[\\/:*?"<>|]/g, '_')}_AI操作マニュアル.md`;
}

function bullets(values) { return values.map((value) => `- ${value}`).join('\n'); }
function numbered(values) { return values.map((value, index) => `${index + 1}. ${value}`).join('\n'); }

function manualText(item) {
  if (item.manual.markdown) return item.manual.markdown.trimEnd() + '\n';
  const resourceLines = item.resources.map((entry) => `- ${entry.name}（${entry.type}）: ${entry.url || entry.source || 'ポータルのリソース欄を確認'}`);
  return `# ${item.name} AI操作マニュアル\n\n## このタスクで行う仕事\n\n${item.description}\n\n## 必要なもの\n\n${bullets(item.manual.preparation)}\n\n## 使用するリソース\n\n${resourceLines.join('\n')}\n\n## AIへの依頼方法\n\nこのMDと対象ファイル・Sheet・URLを読み取り、最初に現在の構成と不足情報を確認してください。不明な列、対象、件数、金額、トーナメント名、TICKET名を推測で補完しないでください。本番データを書き換える処理は、CHECKまたはプレビューと人の確認を分けてください。\n\n## 導入・使用手順\n\n${numbered(item.manual.steps)}\n\n## 完了確認\n\n${bullets(item.manual.checks)}\n\n## 注意事項\n\n${bullets(item.manual.warnings)}\n\n## AIへ追加で伝える内容\n\n- 今回使用する対象イベント・Sheet・Form・PokerWeb画面\n- テストか本番か\n- 実行対象の件数と期間\n- 自分が行う操作とAIに任せたい操作\n- 表示されたエラーや未確認事項\n`;
}

function tsvEscape(value) { return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' / '); }

fs.mkdirSync(manualsRoot, { recursive: true });
fs.mkdirSync(guidesRoot, { recursive: true });
fs.mkdirSync(appRoot, { recursive: true });

const seen = new Set();
for (const item of tasks) {
  if (seen.has(item.id)) throw new Error(`Duplicate task id: ${item.id}`);
  seen.add(item.id);
}

const taskRows = tasks.map((item) => ({
  id: item.id, name: item.name, description: item.description, category: item.category,
  completion: item.completion, completionStatus: item.completionStatus,
  usability: item.usability, difficulty: item.difficulty,
  manager: item.manager, users: item.users, lastVerified: item.lastVerified,
  order: item.order, manualFile: manualFileName(item),
}));
const resourceRows = tasks.flatMap((item) => item.resources.map((entry, index) => ({
  id: entry.id, taskId: item.id, name: entry.name, type: entry.type,
  requiredTools: entry.requiredTools, installMode: entry.installMode,
  url: entry.url, source: entry.source, note: entry.note, order: index + 1,
})));

const manuals = {};
for (const item of tasks) {
  const markdown = manualText(item);
  manuals[item.id] = markdown;
  fs.writeFileSync(path.join(manualsRoot, manualFileName(item)), markdown, 'utf8');
}
const activeManuals = new Set(tasks.map(manualFileName));
for (const fileName of fs.readdirSync(manualsRoot)) {
  if (fileName.endsWith('.md') && !activeManuals.has(fileName)) fs.rmSync(path.join(manualsRoot, fileName));
}
for (const guide of guides) fs.writeFileSync(path.join(guidesRoot, guide.fileName), guide.markdown, 'utf8');
const activeGuides = new Set(guides.map((guide) => guide.fileName));
for (const fileName of fs.readdirSync(guidesRoot)) {
  if (fileName.endsWith('.md') && !activeGuides.has(fileName)) fs.rmSync(path.join(guidesRoot, fileName));
}

const taskHeaders = ['タスクID', 'タスク名', '説明', 'カテゴリ', '完成度', '完成状況・更新理由', '易用度', '利用難易度', '担当者', '利用者・利用部署', '最終動作確認日', '表示順', 'AI操作マニュアルMD'];
const taskValues = taskRows.map((item) => [item.id, item.name, item.description, item.category, item.completion, item.completionStatus, item.usability, item.difficulty, item.manager, item.users, item.lastVerified, item.order, item.manualFile]);
fs.writeFileSync(path.join(docsRoot, 'task-catalog.tsv'), [taskHeaders, ...taskValues].map((row) => row.map(tsvEscape).join('\t')).join('\n') + '\n', 'utf8');

const resourceHeaders = ['リソースID', 'タスクID', 'リソース名', '種類', '必要ツール', '導入方式', 'URL', 'ソース・参照', '補足', '表示順'];
const resourceValues = resourceRows.map((item) => [item.id, item.taskId, item.name, item.type, item.requiredTools, item.installMode, item.url, item.source, item.note, item.order]);
fs.writeFileSync(path.join(docsRoot, 'task-resources.tsv'), [resourceHeaders, ...resourceValues].map((row) => row.map(tsvEscape).join('\t')).join('\n') + '\n', 'utf8');

const oldCatalog = path.join(docsRoot, 'tool-catalog.tsv');
if (fs.existsSync(oldCatalog)) fs.rmSync(oldCatalog);

const seed = `/** Generated by tools/build-customer-ai-automation-catalog.mjs. */\nconst PORTAL_SEED_TASKS = ${JSON.stringify(taskRows, null, 2)};\n\nconst PORTAL_SEED_RESOURCES = ${JSON.stringify(resourceRows, null, 2)};\n\nconst PORTAL_SEED_MANUALS = ${JSON.stringify(manuals, null, 2)};\n\nconst PORTAL_SEED_GUIDES = ${JSON.stringify(guides, null, 2)};\n`;
fs.writeFileSync(path.join(appRoot, 'SeedData.gs'), seed, 'utf8');

const readme = `# カスタマーチーム AI活用・業務自動化ポータル\n\nこのフォルダは、ポータルへ登録する業務タスクとリソース、AI操作マニュアルのローカル正本です。\n\n- タスク数: ${taskRows.length}\n- リソース数: ${resourceRows.length}\n- AI操作マニュアル: ${Object.keys(manuals).length}\n- 共通利用マニュアル: ${guides.length}\n- タスク一覧: \`task-catalog.tsv\`\n- リソース一覧: \`task-resources.tsv\`\n- タスク別マニュアル: \`manuals/\`\n- 共通利用マニュアル: \`guides/\`\n\n配布ファイルはGitHub Raw URL、または作成者本人が自分のGoogle Driveへアップロードしたファイルの共有URLを登録します。Web App自体はDriveへファイルをアップロードしません。GitHubの通常のblob URLは保存時にRaw URLへ変換します。\n\nMDには操作に必要な情報だけを記載します。制作履歴、著作権表示、参考資料の説明は含めません。\n`;
fs.writeFileSync(path.join(docsRoot, 'README.md'), readme, 'utf8');

console.log(JSON.stringify({ tasks: taskRows.length, resources: resourceRows.length, manuals: Object.keys(manuals).length, guides: guides.length, docsRoot, appRoot }, null, 2));
