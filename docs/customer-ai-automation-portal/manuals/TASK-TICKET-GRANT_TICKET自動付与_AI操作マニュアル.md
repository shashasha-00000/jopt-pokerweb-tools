# TICKET自動付与 AI操作マニュアル

## AIへの依頼方法

このMD全文を自分のAIへ貼り付け、PW ナショナルチケット Batchのインストール、TSV作成、DRY RUN、正式付与の順に案内させてください。

## 使用するツール

- PW ナショナルチケット Batch（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-national-ticket-batch.user.js

## TSVの作成方法

Google SheetまたはExcelに、次の表頭を入力します。

社内で既にナショナルチケット付与用TSVを生成・管理しているGoogle Sheetがある場合は、その出力を表頭ごとコピーします。入力元を特定できない場合は、過去に同じ付与作業で使用した表がないか実際の担当者またはAIに探させ、該当する表の表頭・空欄列を含む使用範囲全体をそのままコピーしてください。列の順番や表頭名を自己判断で変更しません。過去表が無い場合だけ、次の最小形式を新しく作成します。

```tsv
GameID	チケット名
12345678	PokerWeb上の正式なTICKET名
23456789	PokerWeb上の正式なTICKET名
```

同じ人へ同じTICKETを複数枚付与する場合は、任意で「枚数」列を追加できます。

```tsv
GameID	チケット名	枚数
12345678	PokerWeb上の正式なTICKET名	2
```

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
