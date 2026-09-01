# TICKET LINK AI操作マニュアル

## このタスクで行う仕事

既存のPokerWebトーナメントへ、正式な受付用TICKETをLinkします。全大会へ同じTICKETを設定する簡単モードと、社内のTicket Linkルール表を読み取る詳細モードがあります。

## 使用するツール

- PW Ticket Link Semi Auto（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-ticket-link-semi-auto.user.js

PokerWebを操作するブラウザと同じブラウザ・同じProfileへインストールし、PokerWebを再読み込みします。

## 1. 大会名入力欄

対象大会のPokerWeb上の正式名称を、表頭なしで1行につき1大会貼り付けます。

    【入力例】#01 NLH Main Event Day 1A
    【入力例】#05 NLH Turbo

大会名を省略したり、同名のDayを1行へまとめたりしません。

## 2. 簡単モードのTicket名入力欄

すべての入力大会へ同じTICKETをLinkする場合に使用します。PokerWeb上の正式なTICKET名を1行につき1件貼り付けます。表頭は省略できます。Google Sheetから貼る場合は「チケット名称」または「チケット名」列を表頭ごとコピーできます。

    チケット名称
    正式なTICKET名

## 3. 詳細モードのTicketLink用ルール表

大会ごとに異なるTICKETをLinkする場合は、社内で実際に使用しているTicket Linkルール表を表頭から最終データ行までそのままコピーします。

TSVファイルを別途作る必要はありません。Google Sheetの使用範囲全体を選択してコピーすると、列がTAB区切りのTSVとしてクリップボードへ入り、そのまま入力欄へ貼り付けられます。

- 「チケット名称」または「チケット名」列が必要です。
- 大会Key列は「#01」「#01A」「s01」などの形式です。
- Link対象セルは TRUE、✓、○、〇、1 のいずれかで指定します。
- Ticket名がある行にTRUEが1つも無い場合は警告になります。
- Ticket名が空なのに大会Key列へ値がある行は異常行となり、STARTできません。

社内で過去に使用したGoogle Sheetに同じ形式の表がないか確認してください。該当する表がある場合は、表頭・空欄列を含む使用範囲全体をそのままコピーし、「TicketLink用ルール表」へ貼り付けてください。列の順番、表頭名、空欄列を自己判断で整理・変更しないでください。入力元を特定できない場合は、過去の同形式表を実際の担当者またはAIに探させてから使用します。

## 4. 手動修正欄

ルール表の大会Keyと大会名の対応を個別に直す場合だけ、次の2列を表頭なしで貼り付けます。

    大会名キーワード<TAB>修正Key

    Main Event Day 1A<TAB>#01A
    Satellite<TAB>s01

## 使用手順

1. 「簡単モード」または「詳細モード」を選びます。
2. 大会名入力欄と、選択したモードのTicket入力欄へ貼り付けます。
3. 「1. 候補作成」を押します。
4. Candidatesで大会名、Ticket名、判定を確認します。
5. URL未解決だけ「2. URL pool検索」を実行します。同名・複数候補は実際のURLを開いて確認します。
6. 候補とTICKETが正しい行だけ「使用」にし、「3. 已确认比赛执行Link」を押します。
7. 「Copy Report」で実行結果を保存し、PokerWeb画面を再読み込みしてTICKET LINKを確認します。

## 注意事項

- TICKET名はPokerWeb上の正式名称と照合します。
- 同名トーナメント、複数URL候補、複数TICKET候補をAIに推測させません。
- 実行結果が不明な行を一括で再実行しません。
