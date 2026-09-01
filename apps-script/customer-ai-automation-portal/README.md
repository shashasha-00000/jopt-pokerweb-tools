# カスタマーチーム AI活用・業務自動化ポータル

Google Sheetを管理台帳、Apps Script Web Appを社内向け画面として使用します。画面は業務タスクを起点とし、コード、Google Sheet、Web App、AI操作MDを各タスクのリソースとして管理します。

## 対象

- Spreadsheet ID: `1ujMFn2iNWLo7OTmi1VckiP9dYq5SdtIwdCNa5DjBrxc`
- Apps Script ID: `1IfMUAY7vQNoFo4f2LUlfOuJzpmTKqaOPzKTl-o4UnJpNLRMGP65RHdmo`
- 時区: `Asia/Tokyo`
- Web Appアクセス: `japanopenpoker.com` ドメイン内
- 実行者: デプロイしたユーザー
- Web App追加・編集・削除: `japanopenpoker.com` のログインユーザー

## 配布ファイル

- 自分のGitHubコード: リソースの「配布URL（GitHub / Google Drive）」へRaw URLまたは通常のblob URLを登録します。blob URLは保存時にRaw URLへ変換します。
- GitHubを使わないコード: 作成者本人が自分のGoogle Driveへファイルをアップロードし、必要な社内メンバーが閲覧できる共有設定にしてから、その共有URLを「配布URL（GitHub / Google Drive）」へ登録します。
- Web AppはDriveファイルをアップロード・保存しません。ファイルの所有者と共有権限は、登録したDriveファイル側で管理します。

TampermonkeyはGitHub Raw URLなら直接インストールできます。Drive共有URLの場合はDriveでファイルを開いて保存し、Tampermonkeyへインポートします。GSは保存後、AI操作MDと一緒にAIへ渡して対象Apps Scriptへ導入します。

## 管理Sheet

- `タスク一覧`: タスク、完成度、完成状況、易用度、担当者、利用部署
- `タスクリソース`: タスクに属するコード、Sheet、Web App、MD、配布URL
- `AIマニュアル`: 各タスクのAI操作MD本文
- `投稿受付`: 社員が登録したAI成果。初期状態は必ず `審査中`
- `利用ガイド`: ポータル共通の使い方
- `設定`: 対象ID、ドメイン、評価ルール
- `削除済みタスク` / `削除済みリソース` / `削除済みマニュアル`: Web Appで削除したデータの復元用保管先

## 更新手順

1. `node tools/build-customer-ai-automation-catalog.mjs` でローカル正本からSeedDataとMDを更新します。
2. このディレクトリで `clasp push` を実行します。
3. 対象Sheetで `rebuildCustomerAiPortalCatalog()` を実行して現行カタログへ再構築します。
4. 新しいバージョンを作成し、既存Web Appデプロイを更新します。
5. `japanopenpoker.com` アカウントでWeb Appを確認します。

Web Appではタスクの追加・編集・削除、リソース追加・削除、GitHub・Google Drive共有URL登録、AI操作MD編集を行えます。Google Sheetは管理者用バックエンドとして残します。
