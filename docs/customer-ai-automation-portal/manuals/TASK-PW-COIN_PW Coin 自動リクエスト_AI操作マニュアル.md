# PW Coin 自動リクエスト AI操作マニュアル

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
