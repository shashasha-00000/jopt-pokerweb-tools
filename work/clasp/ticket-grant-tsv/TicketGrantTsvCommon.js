const NTB_CONFIG = {
  OUTPUT_SHEET_NAME: 'ナショナルチケット付与TSV',
  HEADER_ROW: 1,
  OUTPUT_HEADERS: ['GameID', 'チケット名']
};

function NTB_getActiveSourceSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Spreadsheetを取得できません。対象Spreadsheetに紐づいた Apps Script から実行してください。');
  }

  const source = ss.getActiveSheet();
  if (!source) {
    throw new Error('現在開いているシートを取得できません。');
  }

  if (source.getName() === NTB_CONFIG.OUTPUT_SHEET_NAME) {
    throw new Error('出力シートでは実行できません。元の運用表を開いてから実行してください。');
  }

  return { ss, source };
}

function NTB_readSourceValues_(source) {
  const values = source.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error('データ行がありません。');
  }
  return values;
}

function NTB_writeOutput_(ss, outputRows) {
  const output = NTB_getOrCreateOutputSheet_(ss);
  output.clearContents();
  output.getRange(1, 1, 1, NTB_CONFIG.OUTPUT_HEADERS.length)
    .setValues([NTB_CONFIG.OUTPUT_HEADERS])
    .setFontWeight('bold')
    .setBackground('#d9ead3');

  if (outputRows.length) {
    output.getRange(2, 1, outputRows.length, NTB_CONFIG.OUTPUT_HEADERS.length)
      .setNumberFormat('@')
      .setValues(outputRows);
  }

  output.setFrozenRows(1);
  output.autoResizeColumns(1, NTB_CONFIG.OUTPUT_HEADERS.length);
  ss.setActiveSheet(output);
}

function NTB_getOrCreateOutputSheet_(ss) {
  return ss.getSheetByName(NTB_CONFIG.OUTPUT_SHEET_NAME) ||
    ss.insertSheet(NTB_CONFIG.OUTPUT_SHEET_NAME);
}

function NTB_assertRequiredColumns_(headers, requiredColumnHeaders) {
  const differences = [];

  Object.keys(requiredColumnHeaders).forEach(columnText => {
    const column = Number(columnText);
    const expected = requiredColumnHeaders[column];
    const actual = headers[column - 1] || '';
    if (actual !== expected) {
      differences.push(column + '列目: 期待=[' + expected + '] 実際=[' + actual + ']');
    }
  });

  if (differences.length) {
    throw new Error(
      '運用表の列構造が想定と異なるため、安全のため停止しました。\n' +
      differences.join('\n')
    );
  }
}

function NTB_throwIfErrors_(errors) {
  if (!errors.length) return;
  throw new Error(
    '安全のため出力を更新しませんでした。\n\n' +
    errors.slice(0, 20).join('\n') +
    (errors.length > 20 ? '\n...ほか ' + (errors.length - 20) + ' 件' : '')
  );
}

function NTB_normalizeGameId_(value) {
  const digits = String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
  return digits.length === 8 ? digits : '';
}

function NTB_isChecked_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function NTB_text_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function NTB_alert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (_) {
    console.log(message);
  }
}

function NTB_stopWithAlert_(error) {
  const message = error && error.message ? error.message : String(error);
  console.error(error && error.stack ? error.stack : error);
  NTB_alert_('TSV生成を停止しました。\n\n' + message);
  throw error;
}
