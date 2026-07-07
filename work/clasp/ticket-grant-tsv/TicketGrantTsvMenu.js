/**
 * PokerWeb チケット付与TSV menu entrypoints.
 *
 * 初回:
 *   installNationalTicketTsvMenu()
 *
 * 実行:
 *   メニュー「チケット付与TSV」から対象イベントを選択する。
 */

function installNationalTicketTsvMenu() {
  NTB_addMenu_();
  NTB_alert_(
    'メニュー「チケット付与TSV」を追加しました。\n' +
    'Spreadsheetを再読み込みするとメニューが表示されます。'
  );
}

function onOpen() {
  NTB_addMenu_();
}

function NTB_addMenu_() {
  try {
    SpreadsheetApp.getUi()
    .createMenu('チケット付与TSV')
    .addItem('Tokyo #02 付与TSV生成', 'buildTokyo02NationalTicketTsv')
    .addItem('2026 Fukuoka #01 Main Ticket 付与TSV生成', 'buildFukuoka01NationalTicketTsv')
    .addToUi();
  } catch (error) {
    throw new Error(
      'SpreadsheetのUIを取得できません。対象Google Sheetを開き、' +
      '「拡張機能 > Apps Script」から、このSheetに紐づいたプロジェクトへコードを追加してください。'
    );
  }
}

function buildNationalTicketTsv() {
  buildTokyo02NationalTicketTsv();
}
