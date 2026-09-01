# トーナメントCLOSE・監査 AI操作マニュアル

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
