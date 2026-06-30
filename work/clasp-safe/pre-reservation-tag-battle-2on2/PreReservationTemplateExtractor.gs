/**
 * Pre-reservation mail template extractor.
 *
 * Purpose:
 * - Read existing Gmail compose hyperlinks from the current control sheet.
 * - Extract subject/body/bcc without touching the colleague-maintained sheet.
 * - Build our own reusable template source sheet for later draft/send automation.
 */

const PRE_RES_TEMPLATE_EXTRACTOR = {
  menuName: '事前予約テンプレート',
  outputSheetName: 'PreReservationTemplateSource',
  scanRangeA1: 'A1:L20',
  outputHeaders: [
    '抽出日時',
    'source_sheet',
    'source_cell',
    'event_name',
    'template_label',
    'mail_type',
    'to',
    'bcc',
    'subject',
    'body',
    'link_url'
  ]
};

function openPreReservationTemplateExtractorMenu() {
  SpreadsheetApp.getUi()
    .createMenu(PRE_RES_TEMPLATE_EXTRACTOR.menuName)
    .addItem('現在の表からメールテンプレートを抽出', 'extractPreReservationTemplatesFromActiveSheet')
    .addToUi();
}

function extractPreReservationTemplatesFromActiveSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const eventName = preResTemplateEventName_(sheet);
  const range = sheet.getRange(PRE_RES_TEMPLATE_EXTRACTOR.scanRangeA1);
  const richTexts = range.getRichTextValues();
  const displayValues = range.getDisplayValues();

  const rows = [];
  for (let rowOffset = 0; rowOffset < richTexts.length; rowOffset++) {
    for (let colOffset = 0; colOffset < richTexts[rowOffset].length; colOffset++) {
      const richText = richTexts[rowOffset][colOffset];
      const url = richText ? richText.getLinkUrl() : '';
      if (!url || url.indexOf('https://mail.google.com/mail/?view=cm&fs=1') !== 0) continue;

      const label = displayValues[rowOffset][colOffset];
      const cellA1 = sheet.getRange(range.getRow() + rowOffset, range.getColumn() + colOffset).getA1Notation();
      const parsed = preResTemplateParseGmailComposeUrl_(url);
      rows.push([
        new Date(),
        sheet.getName(),
        cellA1,
        eventName,
        label,
        preResTemplateInferMailType_(label, parsed.subject),
        parsed.to,
        parsed.bcc,
        parsed.subject,
        parsed.body,
        url
      ]);
    }
  }

  if (!rows.length) {
    SpreadsheetApp.getUi().alert('現在の表の ' + PRE_RES_TEMPLATE_EXTRACTOR.scanRangeA1 + ' に Gmail hyperlink が見つかりませんでした。');
    return;
  }

  const outputSheet = preResTemplateGetOrCreateOutputSheet_(ss);
  preResTemplateAppendRows_(outputSheet, rows);
  outputSheet.activate();
  SpreadsheetApp.getUi().alert('テンプレートを ' + rows.length + ' 件抽出しました。');
}

function preResTemplateGetOrCreateOutputSheet_(ss) {
  let sheet = ss.getSheetByName(PRE_RES_TEMPLATE_EXTRACTOR.outputSheetName);
  if (!sheet) sheet = ss.insertSheet(PRE_RES_TEMPLATE_EXTRACTOR.outputSheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, PRE_RES_TEMPLATE_EXTRACTOR.outputHeaders.length)
      .setValues([PRE_RES_TEMPLATE_EXTRACTOR.outputHeaders])
      .setFontWeight('bold')
      .setBackground('#fff2cc');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function preResTemplateAppendRows_(sheet, rows) {
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, PRE_RES_TEMPLATE_EXTRACTOR.outputHeaders.length)
    .setValues(rows)
    .setWrap(true);
  sheet.autoResizeColumns(1, PRE_RES_TEMPLATE_EXTRACTOR.outputHeaders.length);
}

function preResTemplateEventName_(sheet) {
  const candidates = ['A1', 'A2', 'A3'];
  for (let index = 0; index < candidates.length; index++) {
    const text = preResTemplateText_(sheet.getRange(candidates[index]).getDisplayValue());
    if (text) return text.replace(/\s*予約確認\s*$/, '');
  }
  return sheet.getName();
}

function preResTemplateInferMailType_(label, subject) {
  const source = preResTemplateText_(label + ' ' + subject);
  if (/キャンセル/.test(source)) return 'cancel';
  if (/当日案内/.test(source) && /決済完了|選手契約履行/.test(source)) return 'contract_confirmed';
  if (/当日案内/.test(source)) return 'day_guide';
  if (/LivePocket/i.test(source)) return 'livepocket_payment';
  if (/コイン|coin/i.test(source)) return 'coin_payment';
  return 'unknown';
}

function preResTemplateParseGmailComposeUrl_(url) {
  const queryIndex = url.indexOf('?');
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1) : '';
  const pairs = query.split('&').filter(Boolean);
  const map = {};

  pairs.forEach(pair => {
    const eqIndex = pair.indexOf('=');
    const key = eqIndex >= 0 ? pair.slice(0, eqIndex) : pair;
    const value = eqIndex >= 0 ? pair.slice(eqIndex + 1) : '';
    map[key] = preResTemplateSafeDecode_(value);
  });

  return {
    to: map.to || '',
    bcc: map.bcc || '',
    subject: map.su || '',
    body: map.body || ''
  };
}

function preResTemplateSafeDecode_(value) {
  try {
    return decodeURIComponent(String(value || '').replace(/\+/g, '%20'));
  } catch (error) {
    return String(value || '');
  }
}

function preResTemplateText_(value) {
  return String(value == null ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}
