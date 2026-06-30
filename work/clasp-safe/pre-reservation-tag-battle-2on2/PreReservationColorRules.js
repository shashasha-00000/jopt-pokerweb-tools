/**
 * Standalone color-rule applicator for pre-reservation sheets.
 *
 * This script only manages conditional formatting.
 * It is intentionally separate from sheet setup / mail sending logic.
 */

const PRE_RES_COLOR_RULES = {
  menuName: '事前予約色分け',
  headerSearchRows: 30,
  requiredHeaders: {
    paymentConfirmed: ['決済確認'],
    cancelMailSent: ['キャンセルメール'],
    paymentDeadline: ['支払期限']
  },
  optionalHeaders: {
    manualAction: ['手動指示', 'メール指示']
  },
  colors: {
    gray: '#d9d9d9',
    purple: '#ead1dc',
    blue: '#c9daf8',
    red: '#f4cccc',
    orange: '#fce5cd',
    green: '#d9ead3'
  }
};

function openPreReservationColorRulesMenu() {
  SpreadsheetApp.getUi()
    .createMenu(PRE_RES_COLOR_RULES.menuName)
    .addItem('現在の表に色分けルールを適用', 'applyPreReservationColorRulesToActiveSheet')
    .addToUi();
}

function applyPreReservationColorRulesToActiveSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const map = preResColorFindColumnMap_(sheet);
  const startRow = map.headerRow + 1;
  const lastCol = Math.max(sheet.getLastColumn(), map.manualActionCol || 0);
  const target = sheet.getRange(startRow, 1, Math.max(sheet.getMaxRows() - startRow + 1, 1), lastCol);
  const targetA1 = target.getA1Notation();

  const existing = sheet.getConditionalFormatRules().filter(rule =>
    !rule.getRanges().some(range =>
      range.getSheet().getName() === sheet.getName() &&
      range.getA1Notation() === targetA1
    )
  );

  const deadline = preResColorColLetter_(map.paymentDeadlineCol);
  const paymentConfirmed = preResColorColLetter_(map.paymentConfirmedCol);
  const cancelMailSent = preResColorColLetter_(map.cancelMailSentCol);
  const rules = [];

  if (map.manualActionCol) {
    const manualAction = preResColorColLetter_(map.manualActionCol);
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=OR($' + cancelMailSent + startRow + '=TRUE,$' + manualAction + startRow + '="キャンセル通知済")')
        .setBackground(PRE_RES_COLOR_RULES.colors.gray)
        .setRanges([target])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + manualAction + startRow + '="キャンセル"')
        .setBackground(PRE_RES_COLOR_RULES.colors.purple)
        .setRanges([target])
        .build()
    );
  } else {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + cancelMailSent + startRow + '=TRUE')
        .setBackground(PRE_RES_COLOR_RULES.colors.gray)
        .setRanges([target])
        .build()
    );
  }

  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + paymentConfirmed + startRow + '=TRUE')
      .setBackground(PRE_RES_COLOR_RULES.colors.blue)
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + deadline + startRow + '<>"",$' + paymentConfirmed + startRow + '<>TRUE,$' + deadline + startRow + '<TODAY())')
      .setBackground(PRE_RES_COLOR_RULES.colors.red)
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + deadline + startRow + '<>"",$' + paymentConfirmed + startRow + '<>TRUE,$' + deadline + startRow + '=TODAY())')
      .setBackground(PRE_RES_COLOR_RULES.colors.orange)
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + deadline + startRow + '<>"",$' + paymentConfirmed + startRow + '<>TRUE,$' + deadline + startRow + '>TODAY())')
      .setBackground(PRE_RES_COLOR_RULES.colors.green)
      .setRanges([target])
      .build()
  );

  sheet.setConditionalFormatRules(existing.concat(rules));

  SpreadsheetApp.getUi().alert(
    '色分けルールを適用しました。\n\n' +
    'headerRow: ' + map.headerRow +
    '\n決済確認列: ' + preResColorColLetter_(map.paymentConfirmedCol) +
    '\nキャンセルメール列: ' + preResColorColLetter_(map.cancelMailSentCol) +
    '\n支払期限列: ' + preResColorColLetter_(map.paymentDeadlineCol) +
    (map.manualActionCol ? '\n手動指示列: ' + preResColorColLetter_(map.manualActionCol) : '\n手動指示列: 未使用')
  );
}

function preResColorFindColumnMap_(sheet) {
  const maxRows = Math.min(sheet.getLastRow(), PRE_RES_COLOR_RULES.headerSearchRows);
  if (maxRows < 1) throw new Error('表にデータがありません。');

  const values = sheet.getRange(1, 1, maxRows, sheet.getLastColumn()).getDisplayValues();
  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const headers = values[rowIndex].map(preResColorText_);
    const paymentConfirmedCol = preResColorFindHeaderIndex_(headers, PRE_RES_COLOR_RULES.requiredHeaders.paymentConfirmed);
    const cancelMailSentCol = preResColorFindHeaderIndex_(headers, PRE_RES_COLOR_RULES.requiredHeaders.cancelMailSent);
    const paymentDeadlineCol = preResColorFindHeaderIndex_(headers, PRE_RES_COLOR_RULES.requiredHeaders.paymentDeadline);
    if (paymentConfirmedCol && cancelMailSentCol && paymentDeadlineCol) {
      return {
        headerRow: rowIndex + 1,
        paymentConfirmedCol,
        cancelMailSentCol,
        paymentDeadlineCol,
        manualActionCol: preResColorFindHeaderIndex_(headers, PRE_RES_COLOR_RULES.optionalHeaders.manualAction)
      };
    }
  }

  throw new Error('必要なヘッダー（決済確認 / キャンセルメール / 支払期限）が見つかりませんでした。');
}

function preResColorFindHeaderIndex_(headers, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const idx = headers.indexOf(preResColorText_(candidates[i]));
    if (idx >= 0) return idx + 1;
  }
  return 0;
}

function preResColorText_(value) {
  return String(value == null ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function preResColorColLetter_(column) {
  let result = '';
  let value = column;
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
