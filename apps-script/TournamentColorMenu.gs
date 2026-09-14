/**
 * Google Sheets を開いたとき、対象シートだけを着色するメニューを追加します。
 *
 * 使い方:
 * 1. 着色したいシートを開く
 * 2. 「トナメカラー」→「現在のシートを更新」を選ぶ
 * 3. 表示されたシート名を確認して実行する
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('トナメカラー')
    .addItem('現在のシートを更新', 'runTournamentColoringForActiveSheet')
    .addToUi();
}

/** 現在選択中のシートだけを確認後に更新します。 */
function runTournamentColoringForActiveSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'トナメカラー',
    'シート「' + sheet.getName() + '」の J 列をコードに合わせて着色します。実行しますか？',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  const result = colorTournamentCodes_(sheet);
  spreadsheet.toast(
    'シート「' + sheet.getName() + '」を着色しました（背景色: ' +
      result.colorCount + '件）',
    'トナメカラー',
    5
  );
}

/**
 * J 列に入力済みの固定コードを読み取り、背景色だけを更新します。
 * 対応表にない値の背景色は変更しません。
 */
function colorTournamentCodes_(sheet) {
  const startRow = 5;
  const targetColumn = 10; // J列
  const lastRow = sheet.getLastRow();

  if (lastRow < startRow) {
    return { colorCount: 0 };
  }

  const rowCount = lastRow - startRow + 1;
  const targetRange = sheet.getRange(startRow, targetColumn, rowCount, 1);
  const targetValues = targetRange.getDisplayValues();
  const targetBackgrounds = targetRange.getBackgrounds();

  const colorMap = {
    'H230': '#0000ff',
    'H345': '#ff00ff',
    'H75': '#c3c300',
    'H20': '#ff9900',
    'H250': '#9900ff',
    'H150': '#00c7c7',
    'H345 S70': '#cf76cd',
    'S0': '#979797',
    'H265': '#000000',
    'H0': '#ff0000',
    'H120': '#00c900'
  };

  let colorCount = 0;

  const newBackgrounds = targetValues.map(function(row, index) {
    const code = normalizeAscii_(row[0]).toUpperCase();

    if (!Object.prototype.hasOwnProperty.call(colorMap, code)) {
      return [targetBackgrounds[index][0]];
    }

    colorCount++;
    return [colorMap[code]];
  });

  targetRange.setBackgrounds(newBackgrounds);

  return { colorCount: colorCount };
}

/** 全角英数記号を半角へ、全角スペースを半角へ変換します。 */
function normalizeAscii_(value) {
  const source = value == null ? '' : String(value);
  let result = '';

  for (let index = 0; index < source.length; index++) {
    const charCode = source.charCodeAt(index);
    if (charCode === 0x3000) {
      result += ' ';
    } else if (charCode >= 0xFF01 && charCode <= 0xFF5E) {
      result += String.fromCharCode(charCode - 0xFEE0);
    } else {
      result += source.charAt(index);
    }
  }

  return result.replace(/\s+/g, ' ').trim();
}
