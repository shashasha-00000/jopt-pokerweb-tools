# PWのPrize入力・DC AI操作マニュアル

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
