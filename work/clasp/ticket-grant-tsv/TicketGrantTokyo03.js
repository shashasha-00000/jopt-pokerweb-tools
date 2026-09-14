/**
 * Tokyo #03:
 * - I列「Millions1」が CHECK の場合、Millions を付与対象とする
 * - J列「PPC」が CHECK の場合、PPC を付与対象とする
 * - K列「付与」が CHECK 済みの場合、その行は付与済みとしてスキップする
 * - O列「付与対象外」が CHECK の場合、その行は対象外としてスキップする
 * - D列「対象プロモ」はチケット種別判定に使用しない
 */
const NTB_TOKYO_2026_03 = {
  SOURCE_SHEET_NAME: '2026 Tokyo #03',

  REQUIRED_COLUMN_HEADERS: {
    3: 'Game ID',
    9: 'Millions1',
    10: 'PPC',
    11: '付与',
    15: '付与対象外'
  },

  MILLIONS_TICKET:
    '【JOPT 2026 Tokyo #03】NLH Millions Voucher / -2026.10.31（海外対応分）',

  PPC_TICKET:
    '【JOPT 2026 Tokyo #03】NLH Poker Players Championship Voucher / -2026.10.31（海外対応分）'
};

function buildTokyo03NationalTicketTsv() {
  try {
    NTB_buildTokyo03NationalTicketTsv_();
  } catch (error) {
    NTB_stopWithAlert_(error);
  }
}

function NTB_buildTokyo03NationalTicketTsv_() {
  const { ss, source } = NTB_getActiveSourceSheet_();

  if (source.getName() !== NTB_TOKYO_2026_03.SOURCE_SHEET_NAME) {
    throw new Error(
      'この処理は「' +
        NTB_TOKYO_2026_03.SOURCE_SHEET_NAME +
        '」シートで実行してください。\n' +
        '現在のシート: 「' +
        source.getName() +
        '」'
    );
  }

  const values = NTB_readSourceValues_(source);
  const headers = values[NTB_CONFIG.HEADER_ROW - 1].map(NTB_text_);

  NTB_assertRequiredColumns_(
    headers,
    NTB_TOKYO_2026_03.REQUIRED_COLUMN_HEADERS
  );

  // 0-based index
  const gameIdColumn = 2;      // C列: Game ID
  const millionsColumn = 8;    // I列: Millions1
  const ppcColumn = 9;         // J列: PPC
  const grantedColumn = 10;    // K列: 付与
  const excludedColumn = 14;   // O列: 付与対象外

  const outputRows = [];
  const errors = [];

  let excludedSkippedCount = 0;
  let grantedSkippedCount = 0;

  values.slice(NTB_CONFIG.HEADER_ROW).forEach((row, offset) => {
    const sheetRow = NTB_CONFIG.HEADER_ROW + offset + 1;

    // O列「付与対象外」が CHECK の行は対象外としてスキップ
    if (NTB_isChecked_(row[excludedColumn])) {
      excludedSkippedCount += 1;
      return;
    }

    const millionsTarget = NTB_isChecked_(row[millionsColumn]);
    const ppcTarget = NTB_isChecked_(row[ppcColumn]);
    const granted = NTB_isChecked_(row[grantedColumn]);
    const rawGameId = NTB_text_(row[gameIdColumn]);

    const hasRelevantData =
      rawGameId ||
      millionsTarget ||
      ppcTarget ||
      granted;

    // 完全な空行は無視
    if (!hasRelevantData) {
      return;
    }

    // K列「付与」が CHECK 済みなら処理済みとしてスキップ
    if (granted) {
      grantedSkippedCount += 1;
      return;
    }

    // I/J どちらにも CHECK がない場合は付与対象なし
    if (!millionsTarget && !ppcTarget) {
      return;
    }

    const gameId = NTB_normalizeGameId_(row[gameIdColumn]);

    if (!gameId) {
      errors.push(
        sheetRow + '行目: Game ID が空白または不正です。'
      );
      return;
    }

    // Millions
    if (millionsTarget) {
      outputRows.push([
        gameId,
        NTB_TOKYO_2026_03.MILLIONS_TICKET
      ]);
    }

    // PPC
    if (ppcTarget) {
      outputRows.push([
        gameId,
        NTB_TOKYO_2026_03.PPC_TICKET
      ]);
    }
  });

  NTB_throwIfErrors_(errors);
  NTB_writeOutput_(ss, outputRows);

  NTB_alert_(
    'TSV出力を更新しました。\n\n' +
      '未付与タスク: ' + outputRows.length + ' 件\n' +
      'O列「付与対象外」CHECKによりスキップ: ' + excludedSkippedCount + ' 件\n' +
      'K列「付与」CHECK済みによりスキップ: ' + grantedSkippedCount + ' 件\n' +
      '出力シート: ' + NTB_CONFIG.OUTPUT_SHEET_NAME + '\n\n' +
      'A:B列を表頭ごとコピーして PokerWeb のツールへ貼り付けてください。\n' +
      '付与完了後、元表の K列「付与」を手動でCHECKしてください。'
  );
}
