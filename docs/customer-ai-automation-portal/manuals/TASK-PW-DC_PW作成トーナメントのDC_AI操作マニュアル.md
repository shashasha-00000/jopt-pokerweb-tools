# PW作成トーナメントのDC AI操作マニュアル

## このタスクで行う仕事

Portalの大会設定表と受付PortalのTicket Link表を基準に、PokerWebの大会名、開始日時、EN・RE・TE、Chips、Settings、USDT、TICKET LINKを読み取り専用でDCします。

## 使用するツール

- PW Tournament Double Check（Tampermonkey）
- インストールURL: https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-double-check.user.js

PokerWebを操作するブラウザと同じブラウザ・同じProfileへインストールし、PokerWebを再読み込みします。

ここで使用するTSVは、別途ファイルを作成するものではありません。PortalまたはGoogle Sheetの表全体を選択してコピーすると、列がTAB区切りのTSVとしてクリップボードへ入り、そのまま各入力欄へ貼り付けられます。

## 入力① 総大会名

PokerWeb上で大会名の先頭に付くイベント共通名を入力します。

    【JOPT 2026 Tokyo #02】

## 入力② PortalのTournamentページ

Portal Tournamentページの表を、表頭とデータ行を含めてそのまま全体コピーし、「② Portal の Tournament ページ」へ貼り付けます。次の表頭が必要です。

    Date<TAB>Start<TAB>#<TAB>Name<TAB>Chips<TAB>DBI<TAB>Ticket

列の途中に別の列があっても構いません。Dateが省略されている連続行は直前の日付を引き継ぐため、対象大会行だけを切り出さず、日付行からまとめてコピーします。

## 入力③ 受付PortalのTicket Linkページ

受付PortalのTicket Linkページを、上部の日付、大会番号、Tournament IDが入るメイン行、全Ticket行を含めてそのまま全体コピーし、「③ 受付Portal の Ticket Link ページ」へ貼り付けます。空欄列は大会とTicketの位置関係を保持するため削除しません。

社内で過去に使用したGoogle SheetまたはPortal出力に同じ形式の表がないか確認してください。該当する表がある場合は、表頭・空欄列を含む使用範囲全体をそのままコピーして貼り付けます。列の順番、表頭名、空欄列を自己判断で整理・変更しません。入力元を特定できない場合は、過去の同形式表を実際の担当者またはAIに探させてから使用します。

## 詳細設定：ドリンク券ルール

通常は既存値を使用します。変更が必要な場合だけ、1行につき「大会名キーワード: 加算額」の形式で入力します。

    DEFAULT: 1000
    Tag Team: 2000
    3on3: 3000
    Satellite: 0

## 使用手順

1. 総大会名、Portal Tournament表、受付Portal Ticket Link表を貼り付けます。
2. 入力範囲に表頭、日付、Tournament ID、Ticket行が含まれていることを確認します。
3. 「Double Check」を押します。
4. Overall、Tournament、Start、EN、RE、TE、Chips、Settings、USDT、Ticket Linkを確認します。
5. NGまたはCHECK行は、基準表とPokerWeb画面を人が照合します。
6. 「Copy Last LOG」で結果を保存します。

## 注意事項

- このツールは読み取り専用で、PokerWebの値を修正しません。
- 表の空欄列を削除すると、大会列とTicket列の対応がずれる可能性があります。
- DC結果だけで修正を自動実行しません。
