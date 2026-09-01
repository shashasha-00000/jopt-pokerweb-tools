# 事前予約メール送信 AI操作マニュアル

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
