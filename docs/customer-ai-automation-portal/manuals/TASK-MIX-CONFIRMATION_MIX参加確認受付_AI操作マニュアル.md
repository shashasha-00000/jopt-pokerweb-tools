# MIX参加確認受付 AI操作マニュアル

## このタスクで行う仕事

固定端末で参加確認を受け付け、確認時刻と端末情報をGoogle Sheetへ記録する。

## 必要なもの

- 標準URLと専用端末を用意する。

## 使用するリソース

- MIXトーナメント確認APP（Web App）: https://script.google.com/macros/s/AKfycbx8HiDs4qrnRvqRI71xi4cEWZ4ixyfUOfmksmeDDITHDOPVqWrYoT96-w7T3BFSqI2n/exec
- MIXトーナメント確認Kiosk ソース（Google Apps Script）: apps-script/entry-confirmation-kiosk/Code.gs
apps-script/entry-confirmation-kiosk/Index.html
apps-script/entry-confirmation-kiosk/appsscript.json

## AIへの依頼方法

このMDと対象ファイル・Sheet・URLを読み取り、最初に現在の構成と不足情報を確認してください。不明な列、対象、件数、金額、トーナメント名、TICKET名を推測で補完しないでください。本番データを書き換える処理は、CHECKまたはプレビューと人の確認を分けてください。

## 導入・使用手順

1. Web Appを開く。
2. 確認ボタンを一度押す。
3. 完了表示とSheet記録を確認する。

## 完了確認

- 日本時間、端末ID、記録IDが追加される。

## 注意事項

- 複数Googleアカウントを同じブラウザで同時利用しない。

## AIへ追加で伝える内容

- 今回使用する対象イベント・Sheet・Form・PokerWeb画面
- テストか本番か
- 実行対象の件数と期間
- 自分が行う操作とAIに任せたい操作
- 表示されたエラーや未確認事項
