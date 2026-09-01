# USDT表 AI補助作成 AI操作マニュアル

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
