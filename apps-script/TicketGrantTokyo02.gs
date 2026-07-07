/**
 * Tokyo #02:
 * - D列「対象プロモ」が A: Millions + PPC
 * - D列「対象プロモ」が B / C: Millions
 * - I列「Millons1」と J列「PPC」は付与済み CHECK。未チェック分だけ出力する
 * - K列「WeChat送信」はチケット付与判定に使用しない
 * - H列に何か入力がある行はスキップする（対象外として無視）
 */

const NTB_TOKYO_2026_02 = {
  REQUIRED_COLUMN_HEADERS: {
    3: 'Game ID',
    4: '対象プロモ',
    9: 'Millons1',
    10: 'PPC',
    11: 'WeChat送信'
  },
  MILLIONS_TICKET: '【JOPT 2026 Tokyo #02】NLH Millions Voucher / -2026.07.31 (海外対応分)',
  PPC_TICKET: '【JOPT 2026 Tokyo #02】NLH Poker Players Championship Voucher / -2026.07.31 (海外対応分)'
};

function buildTokyo02NationalTicketTsv() {
  try {
    NTB_buildTokyo02NationalTicketTsv_();
  } catch (error) {
    NTB_stopWithAlert_(error);
  }
}

function NTB_buildTokyo02NationalTicketTsv_() {
  const { ss, source } = NTB_getActiveSourceSheet_();
  const values = NTB_readSourceValues_(source);
  const headers = values[NTB_CONFIG.HEADER_ROW - 1].map(NTB_text_);
  NTB_assertRequiredColumns_(headers, NTB_TOKYO_2026_02.REQUIRED_COLUMN_HEADERS);

  const gameIdColumn = 2;
  const promoColumn = 3;
  const skipColumn = 7;
  const millionsCheckColumn = 8;
  const ppcCheckColumn = 9;

  const outputRows = [];
  const errors = [];
  let skippedCount = 0;

  values.slice(NTB_CONFIG.HEADER_ROW).forEach((row, offset) => {
    const sheetRow = NTB_CONFIG.HEADER_ROW + offset + 1;
    if (NTB_text_(row[skipColumn])) {
      skippedCount += 1;
      return;
    }

    const promo = NTB_text_(row[promoColumn]).toUpperCase();
    const millionsDone = NTB_isChecked_(row[millionsCheckColumn]);
    const ppcDone = NTB_isChecked_(row[ppcCheckColumn]);
    const hasRelevantData = promo || NTB_text_(row[gameIdColumn]) || millionsDone || ppcDone;

    if (!hasRelevantData) return;
    if (!['A', 'B', 'C'].includes(promo)) {
      errors.push(sheetRow + '行目: 対象プロモが A / B / C ではありません: [' + promo + ']');
      return;
    }

    const gameId = NTB_normalizeGameId_(row[gameIdColumn]);
    if (!gameId) {
      errors.push(sheetRow + '行目: Game ID が空白または不正です。');
      return;
    }

    if (!millionsDone) {
      outputRows.push([gameId, NTB_TOKYO_2026_02.MILLIONS_TICKET]);
    }

    if (promo === 'A' && !ppcDone) {
      outputRows.push([gameId, NTB_TOKYO_2026_02.PPC_TICKET]);
    }
  });

  NTB_throwIfErrors_(errors);
  NTB_writeOutput_(ss, outputRows);

  NTB_alert_(
    'TSV出力を更新しました。\n\n' +
      '未付与タスク: ' + outputRows.length + ' 件\n' +
      'H列入力によりスキップ: ' + skippedCount + ' 件\n' +
      '出力シート: ' + NTB_CONFIG.OUTPUT_SHEET_NAME + '\n\n' +
      'A:B列を表頭ごとコピーして PokerWeb のツールへ貼り付けてください。\n' +
      '付与完了後、元表の対応する Millons1 / PPC を手動でCHECKしてください。'
  );
}
