# PW作成トーナメントの設定修正 AI操作マニュアル

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
