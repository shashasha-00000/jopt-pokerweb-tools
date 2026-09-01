# PWでトーナメント作成 AI操作マニュアル

## AIへの依頼方法

このMD全文と作成元の大会情報を自分のAIへ渡し、正式なトーナメント名、日付、開始時間、EN・RE・TE、Chips、TICKET名を確認しながらTSVを作成させてください。不明な設定をAIに推測させず、必ず正式情報を追加してください。

## 使用するツール

- PW Tournament Create Auto（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-create-auto.user.js

## TSVの表頭

次の表頭をそのままGoogle SheetまたはExcelの1行目へ貼り付ける方法を推奨します。

作成元となる社内Sheetが不明な場合は、過去にこのトーナメント作成で使用した同形式の表がないか実際の担当者またはAIに探させてください。該当する表がある場合は、表頭・空欄列を含む使用範囲全体をそのままコピーし、列の順番、表頭名、空欄列を自己判断で整理・変更しません。過去表が見つからない場合は、次の表頭で新しく作成し、正式な大会資料から値を入力します。

```tsv
大会名	日付	開始時間	EN名称	EN略称	EN金額	EN手数料	EN回数	ENチップ数	RE名称	RE略称	RE金額	RE手数料	RE回数	REチップ数	TE名称	TE略称	TE金額	TE手数料	TE回数	チケット名称
```

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

```tsv
大会名	日付	開始時間	EN名称	EN略称	EN金額	EN手数料	EN回数	ENチップ数	RE名称	RE略称	RE金額	RE手数料	RE回数	REチップ数	TE名称	TE略称	TE金額	TE手数料	TE回数	チケット名称
【入力例】#1 NLH	2026/09/01	13:00	Entry	En	10000	1000	1	50000	Re Entry	Re	10000	1000	3	50000	Ticket Entry	TE	0	0	0	【入力例】正式なTICKET名
```

- 日付は「2026/09/01」の形式で入力できます。
- 開始時間は「13:00」の形式で入力します。
- RE回数などを無制限にする場合は「0」または「無制限」を入力できます。
- TE金額・TE手数料・TE回数がすべて空欄または0の場合、Ticket Entryは作成されません。
- 複数のTICKETをリンクする場合は、チケット名称を「TICKET A|TICKET B」のように半角 `|` で区切ります。
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
