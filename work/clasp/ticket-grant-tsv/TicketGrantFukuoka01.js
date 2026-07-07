/**
 * 2026 Fukuoka #01:
 * C列「Game ID」ごとに、固定の Main Ticket を1枚出力する。
 */

const NTB_FUKUOKA_2026_01 = {
  REQUIRED_COLUMN_HEADERS: {
    3: 'Game ID',
    9: 'Main Event'
  },
  // TODO: PokerWebの正式なナショナルチケット名が決まり次第、ここに貼り付ける。
  MAIN_TICKET: ''
};

function buildFukuoka01NationalTicketTsv() {
  try {
    NTB_buildFukuoka01NationalTicketTsv_();
  } catch (error) {
    NTB_stopWithAlert_(error);
  }
}

function NTB_buildFukuoka01NationalTicketTsv_() {
  const { ss, source } = NTB_getActiveSourceSheet_();

  if (!NTB_text_(NTB_FUKUOKA_2026_01.MAIN_TICKET)) {
    throw new Error('2026 Fukuoka #01 の MAIN_TICKET が未設定です。TicketGrantFukuoka01.gs の NTB_FUKUOKA_2026_01.MAIN_TICKET に正式なチケット名を貼り付けてください。');
  }

  const values = NTB_readSourceValues_(source);
  const headers = values[NTB_CONFIG.HEADER_ROW - 1].map(NTB_text_);
  NTB_assertRequiredColumns_(headers, NTB_FUKUOKA_2026_01.REQUIRED_COLUMN_HEADERS);

  const gameIdColumn = 2;
  const outputRows = [];
  const errors = [];

  values.slice(NTB_CONFIG.HEADER_ROW).forEach((row, offset) => {
    const sheetRow = NTB_CONFIG.HEADER_ROW + offset + 1;
    const rawGameId = NTB_text_(row[gameIdColumn]);
    if (!rawGameId) return;

    const gameId = NTB_normalizeGameId_(row[gameIdColumn]);
    if (!gameId) {
      errors.push(sheetRow + '行目: Game ID が空白または不正です。');
      return;
    }

    outputRows.push([gameId, NTB_FUKUOKA_2026_01.MAIN_TICKET]);
  });

  NTB_throwIfErrors_(errors);
  NTB_writeOutput_(ss, outputRows);

  NTB_alert_(
    '2026 Fukuoka #01 Main Ticket TSV出力を更新しました。\n\n' +
      '出力タスク: ' + outputRows.length + ' 件\n' +
      '出力シート: ' + NTB_CONFIG.OUTPUT_SHEET_NAME + '\n\n' +
      'A:B列を表頭ごとコピーして PokerWeb のツールへ貼り付けてください。'
  );
}
