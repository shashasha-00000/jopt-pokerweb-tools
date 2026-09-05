// ==UserScript==
// @name         PW・シーズン プライズGameID照合
// @namespace    https://japanopt.bt.pokerweb.com.br/
// @version      0.1.1
// @description  読み取り専用：PWプライズ行のGameIDをシーズンDBと照合します。
// @match        https://japanopt.bt.pokerweb.com.br/*
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-gameid-check.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-gameid-check.user.js
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const APP = {
    name: 'PW・シーズン プライズGameID照合',
    panelId: 'pw-prize-gameid-test-panel'
  };

  let lastTsv = '';
  let lastGameIdTsv = '';
  let lastScan = null;
  let dbText = '';
  let dbInfo = null;
  let teamSize = 1;

  function norm(value) {
    return String(value ?? '')
      .replace(/\u3000/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function playerKey(value) {
    return norm(value).split(/\s+-\s+/)[0].trim();
  }

  function matchKey(value) {
    return playerKey(value).toLowerCase();
  }

  function moneyValue(value) {
    const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.abs(Math.round(n)) : 0;
  }

  function isRank(value) {
    const text = norm(value);
    return /^\d+位$/.test(text) && text !== '0位';
  }

  function isGameId(value) {
    return /^\d+\.\d+$/.test(norm(value));
  }

  function outputGameId(value) {
    return norm(value).replace(/\./g, '');
  }

  function normalizeGameId(value) {
    return norm(value).replace(/[^\d]/g, '');
  }

  function rankNumber(value) {
    const text = norm(value);
    const m = text.match(/^(\d+)\s*位?$/);
    return m ? String(Number(m[1])) : '';
  }

  function rankFromText(value) {
    const matches = [...norm(value).matchAll(/(\d+)\s*位/g)];
    if (matches.length) return String(Number(matches[matches.length - 1][1]));
    return rankNumber(value);
  }

  function checkRankForPrize(row, size = 1) {
    const descriptionRank = rankFromText(row.description);
    if (descriptionRank) return descriptionRank;
    const pwRank = Number(rankFromText(row.rank) || 0);
    const divisor = Math.max(1, Number(size) || 1);
    return pwRank ? String(Math.ceil(pwRank / divisor)) : '';
  }

  function isSpecialPrize(row) {
    return /Sprinter|チップリーダー|Chip\s*Leader|Chipleader/i.test(norm(row.description));
  }

  function isMoney(value) {
    const text = norm(value);
    if (!text || isRank(text) || isGameId(text)) return false;
    return /^[¥￥+-]?\s*\d{1,3}(,\d{3})+$/.test(text) || /^[¥￥+-]?\s*\d{4,}$/.test(text);
  }

  function isIgnoredPrizeText(value) {
    const text = norm(value);
    if (!text || isRank(text) || isGameId(text) || isMoney(text)) return true;
    if (/^(Off|On|入力|Excel|PDF|-|×|x)$/i.test(text)) return true;
    if (/^(位置|説明|金額|プレイヤー|ドキュメント|プレイヤー選択|スクリーン)$/.test(text)) return true;
    return false;
  }

  function looksLikePlayerName(value) {
    const text = playerKey(value);
    if (isIgnoredPrizeText(text)) return false;
    if (text.length > 80) return false;
    return /[A-Za-z0-9_\-@!]|[\u3040-\u30ff\u3400-\u9fff]/.test(text);
  }

  function cellText(cell) {
    const parts = [cell.innerText];
    cell.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'hidden' || el.type === 'button' || el.type === 'submit') return;
      if (el.value) parts.push(el.value);
    });
    return norm([...new Set(parts.map(norm).filter(Boolean))].join(' '));
  }

  function htmlText(value) {
    const raw = String(value ?? '');
    if (!/[<>]/.test(raw)) return norm(raw);
    const div = document.createElement('div');
    div.innerHTML = raw;
    return norm(div.innerText || div.textContent || raw);
  }

  function rowCells(row) {
    return [...row.querySelectorAll('td,th')].map(cellText);
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function getCurrentTournamentId() {
    const match = String(location.href || '').match(/\/torneio\/painel\/(\d+)/);
    return match ? match[1] : '';
  }

  async function postForm(url, dataObj) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams(dataObj),
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST失敗 ${url}: HTTP ${res.status}`);
    return text;
  }

  async function fetchRegistroInformacoes(tournamentId) {
    return postForm('/torneio/abas/registros/informacoes', {
      id_torneio: String(tournamentId)
    });
  }

  function dataTableRows(table) {
    const $ = window.jQuery || window.$;
    if (!$?.fn?.dataTable?.isDataTable || !$.fn.dataTable.isDataTable(table)) return [];
    try {
      const dt = $(table).DataTable();
      return dt.rows().data().toArray().map((data, index) => {
        const cells = Array.isArray(data)
          ? data.map(htmlText)
          : Object.values(data || {}).map(htmlText);
        return { cells, sourceRow: index + 1, source: 'DataTables' };
      }).filter(row => row.cells.length);
    } catch (error) {
      console.warn(`[${APP.name}] DataTables 読み取り失敗`, error);
      return [];
    }
  }

  function findColumn(headers, patterns) {
    return headers.findIndex(header => patterns.some(pattern => pattern.test(header)));
  }

  function tableInfo(table, tableIndex) {
    const rows = [...table.querySelectorAll('tr')];
    return {
      table,
      tableIndex,
      rows,
      preview: rows.slice(0, 8).map(rowCells)
    };
  }

  function pageTournamentName() {
    const selectors = [
      'h1',
      'h2',
      '.page-title',
      '.box-title',
      '.card-title',
      '.panel-title',
      '.breadcrumb li.active',
      '.breadcrumb .active'
    ];
    const candidates = selectors
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .map(el => norm(el.innerText))
      .filter(text =>
        text &&
        !/^(Premiação|Premiacao|賞金|プライズ|PokerWeb)$/i.test(text) &&
        !/^(Excel|PDF|検索)$/.test(text)
      );
    return candidates[0] || norm(document.title).replace(/\s*[-|].*$/, '');
  }

  function findAwardTable(tables) {
    return tables.find(info => {
      const text = info.preview.flat().join(' | ');
      return /GameID/i.test(text) && /名前/.test(text) && /アワード|プライズ/.test(text);
    });
  }

  function findAwardTableInDocument(doc) {
    const tables = [...doc.querySelectorAll('table')].map(tableInfo);
    return findAwardTable(tables);
  }

  function readAwardRows(awardTable) {
    const headerRow = awardTable.preview.find(row =>
      row.some(cell => /GameID/i.test(cell)) && row.some(cell => /名前/.test(cell))
    ) || [];

    const cols = {
      gameId: findColumn(headerRow, [/GameID/i]),
      name: findColumn(headerRow, [/名前/]),
      award: findColumn(headerRow, [/確定したアワード/, /アワード/])
    };

    const sourceRows = [
      ...awardTable.rows.map((row, index) => ({ cells: rowCells(row), sourceRow: index + 1, source: 'DOM' })),
      ...dataTableRows(awardTable.table)
    ];

    const seen = new Set();
    const rows = sourceRows.map(source => {
      const cells = source.cells;
      const gameId = cols.gameId >= 0 ? cells[cols.gameId] : cells.find(isGameId);
      const nameRaw = cols.name >= 0 ? cells[cols.name] : '';
      const awardRaw = cols.award >= 0 ? cells[cols.award] : '';
      return {
        sourceRow: source.sourceRow,
        source: source.source,
        gameId,
        nameRaw,
        player: playerKey(nameRaw),
        playerMatchKey: matchKey(nameRaw),
        award: moneyValue(awardRaw),
        awardRaw,
        cells
      };
    }).filter(row => {
      if (!isGameId(row.gameId) || !row.player) return false;
      const key = `${row.gameId}||${row.player}||${row.award}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { cols, rows };
  }

  function readPrizeRows(awardTable, awardRows, tournamentName) {
    const awardRowSet = new Set(awardTable?.rows || []);
    const awardPlayers = new Set(awardRows.map(row => row.playerMatchKey));

    const baseRows = [...document.querySelectorAll('tr')]
      .filter(row => !awardRowSet.has(row))
      .map((row, domIndex) => {
        const cells = rowCells(row);
        const rankIndex = cells.findIndex(isRank);
        if (rankIndex < 0) return null;

        const amountIndex = cells.findIndex((cell, index) =>
          index !== rankIndex && isMoney(cell) && moneyValue(cell) > 0
        );
        const amountRaw = amountIndex >= 0 ? cells[amountIndex] : '';
        const amount = moneyValue(amountRaw);
        const description = amountIndex > rankIndex
          ? cells.slice(rankIndex + 1, amountIndex).filter(cell => !isIgnoredPrizeText(cell)).join(' ')
          : '';

        let playerRaw = cells.find(cell => awardPlayers.has(matchKey(cell))) || '';
        if (!playerRaw && amountIndex >= 0) {
          playerRaw = cells.slice(amountIndex + 1).find(looksLikePlayerName) || '';
        }
        if (!playerRaw && amountIndex >= 0) {
          playerRaw = cells.slice(rankIndex + 1, amountIndex).find(looksLikePlayerName) || '';
        }

        const player = playerKey(playerRaw);
        const key = matchKey(playerRaw);

        return {
          order: 0,
          domRow: domIndex + 1,
          tournament: tournamentName,
          rank: cells[rankIndex],
          description,
          player,
          playerMatchKey: key,
          amount: amountRaw,
          rawGameId: '',
          amountNumber: amount,
          gameId: '',
          matchCount: 0,
          matchMode: '',
          recordName: '',
          recordAward: '',
          note: '',
          rowText: cells.join(' | ')
        };
      })
      .filter(Boolean)
      .map((row, index) => ({ ...row, order: index + 1 }));

    const sumByPlayer = new Map();
    baseRows.forEach(row => {
      if (!row.playerMatchKey || !row.amountNumber) return;
      sumByPlayer.set(row.playerMatchKey, (sumByPlayer.get(row.playerMatchKey) || 0) + row.amountNumber);
    });

    return baseRows.map(row => {
      const nameMatches = row.playerMatchKey
        ? awardRows.filter(award => award.playerMatchKey === row.playerMatchKey)
        : [];
      const exactMatches = row.amountNumber
        ? nameMatches.filter(award => award.award === row.amountNumber)
        : [];
      const sumAmount = sumByPlayer.get(row.playerMatchKey) || 0;
      const sumMatches = sumAmount
        ? nameMatches.filter(award => award.award === sumAmount)
        : [];
      const matches = nameMatches.length === 1
        ? nameMatches
        : sumMatches.length === 1
          ? sumMatches
          : exactMatches.length === 1
            ? exactMatches
            : [];
      const matchMode = nameMatches.length === 1
        ? (sumMatches.length === 1 ? '名前一致+合計一致' : exactMatches.length === 1 ? '名前一致+金額一致' : '名前一致')
        : sumMatches.length === 1
          ? '名前+合計'
          : exactMatches.length === 1
            ? '名前+金額'
            : '';
      const note = !row.player
        ? 'プレイヤー名なし'
        : nameMatches.length === 1
          ? ''
          : sumMatches.length === 1 || exactMatches.length === 1
            ? ''
            : nameMatches.length === 0
              ? '該当なし'
              : '同名複数';
      return {
        ...row,
        rawGameId: matches.map(match => match.gameId).join(', '),
        gameId: matches.map(match => outputGameId(match.gameId)).join(', '),
        matchCount: matches.length,
        matchMode,
        recordName: matches.map(match => match.nameRaw).join(' / '),
        recordAward: matches.map(match => match.awardRaw).join(' / '),
        recordAwardNumber: matches.length === 1 ? matches[0].award : 0,
        playerTotal: sumAmount,
        note
      };
    });
  }

  function cleanTsvCell(value) {
    return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  }

  function toReviewTsv(rows) {
    const header = ['大会', 'PW順位', '説明', 'Game_ID', '金額', '記録アワード', '記録名前', '備考'];
    const map = {
      '大会': 'tournament',
      'PW順位': 'rank',
      '説明': 'description',
      'Game_ID': 'gameId',
      '金額': 'amount',
      '記録アワード': 'recordAward',
      '記録名前': 'recordName',
      '備考': 'note'
    };
    const lines = rows.map(row => header.map(key => cleanTsvCell(row[map[key]])).join('\t'));
    return [header.join('\t'), ...lines].join('\n');
  }

  function toCheckTsv(rows) {
    const header = ['大会', 'PW順位', '換算順位', '説明', '判定', 'Game_ID', '金額', 'シーズン順位', 'シーズン名前', 'シーズンmemo', '備考'];
    const lines = rows.map(row => header.map(key => cleanTsvCell(row[key])).join('\t'));
    return [header.join('\t'), ...lines].join('\n');
  }

  function toGameIdTsv(rows) {
    return rows.map(row => String(row.gameId || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\n');
  }

  function summarize(rows) {
    const matched = rows.filter(row => row.gameId).length;
    const noPlayer = rows.filter(row => row.note === 'プレイヤー名なし').length;
    const notMatched = rows.filter(row => row.note === '該当なし').length;
    const multiple = rows.filter(row => row.note === '同名複数').length;
    return { rows: rows.length, matched, noPlayer, notMatched, multiple };
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      const next = source[i + 1];
      if (quoted) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some(value => value !== '') || rows.length) rows.push(row);
    return rows;
  }

  function detectDelimiter(text) {
    const sample = String(text || '').split(/\r?\n/).slice(0, 5).join('\n');
    const tabs = (sample.match(/\t/g) || []).length;
    const commas = (sample.match(/,/g) || []).length;
    return tabs > commas ? '\t' : ',';
  }

  function findDbHeader(rows) {
    for (let i = 0; i < rows.length; i += 1) {
      const cells = rows[i].map(norm);
      const joined = cells.join('\t');
      if (/ymf-rank/i.test(joined) && /game[-_ ]?id/i.test(joined)) {
        return { index: i, format: 'RankingList CSV' };
      }
      if (cells.includes('順位') && cells.some(cell => /^Game_?ID$/i.test(cell))) {
        return { index: i, format: '管理画面コピーTSV' };
      }
    }
    return null;
  }

  function indexByAliases(headers, aliases) {
    return headers.findIndex(header => aliases.some(alias => alias.test(header)));
  }

  function parseSeasonDatabase(text) {
    const delimiter = detectDelimiter(text);
    const rows = parseDelimited(text, delimiter).filter(row => row.some(cell => norm(cell)));
    const headerInfo = findDbHeader(rows);
    if (!headerInfo) {
      throw new Error('シーズンDBのヘッダーが見つかりません。CSVまたはコピー表に順位とGame_ID列が必要です。');
    }

    const headers = rows[headerInfo.index].map(norm);
    const cols = {
      rank: indexByAliases(headers, [/^ymf-rank$/i, /^順位$/]),
      gameId: indexByAliases(headers, [/^game[-_ ]?id$/i, /^Game_?ID$/i]),
      player: indexByAliases(headers, [/^playername$/i, /^プレイヤー名$/]),
      memo: indexByAliases(headers, [/^memo$/i])
    };
    if (cols.rank < 0 || cols.gameId < 0) {
      throw new Error('シーズンDBの順位列またはGame_ID列が見つかりません。');
    }

    const parsedRows = rows.slice(headerInfo.index + 1).map((row, offset) => ({
      sourceRow: headerInfo.index + offset + 2,
      rank: rankNumber(row[cols.rank]),
      gameId: normalizeGameId(row[cols.gameId]),
      player: cols.player >= 0 ? norm(row[cols.player]) : '',
      memo: cols.memo >= 0 ? norm(row[cols.memo]) : ''
    })).filter(row =>
      row.rank &&
      row.gameId &&
      !/^game[-_ ]?id$/i.test(row.gameId) &&
      row.gameId !== '00000000'
    );

    const byGameId = new Map();
    const byPair = new Map();
    parsedRows.forEach(row => {
      if (!byGameId.has(row.gameId)) byGameId.set(row.gameId, []);
      byGameId.get(row.gameId).push(row);
      const pairKey = `${row.gameId}||${row.rank}`;
      if (!byPair.has(pairKey)) byPair.set(pairKey, []);
      byPair.get(pairKey).push(row);
    });

    return {
      format: headerInfo.format,
      delimiter: delimiter === '\t' ? 'TSV' : 'CSV',
      rows: parsedRows,
      byGameId,
      byPair
    };
  }

  function uniqueJoined(values) {
    return [...new Set(values.filter(value => value !== ''))].join(', ');
  }

  function checkPrizeRows(prizeRows, seasonDb, size = 1) {
    return prizeRows.map(row => {
      const gameId = normalizeGameId(row.gameId);
      const checkRank = checkRankForPrize(row, size);
      const pairRows = gameId && checkRank ? (seasonDb.byPair.get(`${gameId}||${checkRank}`) || []) : [];
      const gidRows = gameId ? (seasonDb.byGameId.get(gameId) || []) : [];
      const special = isSpecialPrize(row);

      let check = '';
      let note = '';
      let seasonRows = pairRows;

      if (!gameId && row.player) {
        check = 'NG_抽出失敗';
        note = row.note || 'Game_IDを抽出できません';
        seasonRows = [];
      } else if (!gameId) {
        check = 'SKIP';
        note = row.note || 'Game_ID空欄';
        seasonRows = [];
      } else if (pairRows.length) {
        check = 'OK';
        note = special && rankFromText(row.description) ? `特殊賞順位 ${checkRank} で一致` : '';
      } else if (special && gidRows.length) {
        check = 'OK_特殊賞合算';
        note = `特殊賞はシーズン順位 ${uniqueJoined(gidRows.map(item => item.rank))} に合算`;
        seasonRows = gidRows;
      } else if (gidRows.length) {
        check = 'NG_順位';
        note = `シーズン順位=${uniqueJoined(gidRows.map(item => item.rank))} / 換算順位=${checkRank}`;
        seasonRows = gidRows;
      } else {
        check = 'NG_GameID';
        note = 'シーズンDBにGame_IDなし';
        seasonRows = [];
      }

      const moneyOk = row.recordAwardNumber && (
        row.recordAwardNumber === row.amountNumber ||
        row.recordAwardNumber === row.playerTotal
      );
      if (gameId && row.recordAwardNumber && !moneyOk) {
        note = [note, `金額確認NG: PW=${row.amount || 0}, PW合計=${row.playerTotal || 0}, 記録アワード=${row.recordAward || 0}`]
          .filter(Boolean)
          .join(' / ');
      }

      return {
        '大会': row.tournament,
        'PW順位': row.rank,
        '換算順位': checkRank,
        '説明': row.description,
        '判定': check,
        'Game_ID': gameId,
        '金額': row.amount,
        'シーズン順位': uniqueJoined(seasonRows.map(item => item.rank)),
        'シーズン名前': uniqueJoined(seasonRows.map(item => item.player)),
        'シーズンmemo': uniqueJoined(seasonRows.map(item => item.memo)),
        '備考': note
      };
    });
  }

  async function loadAwardRows() {
    const tournamentId = getCurrentTournamentId();
    if (tournamentId) {
      try {
        const html = await fetchRegistroInformacoes(tournamentId);
        const doc = parseHtml(html);
        const awardTable = findAwardTableInDocument(doc);
        if (awardTable) {
          const award = readAwardRows(awardTable);
          if (award.rows.length) {
            return {
              source: '記録タブ取得',
              tournamentId,
              awardTableIndex: awardTable.tableIndex,
              awardCols: award.cols,
              awardRows: award.rows
            };
          }
        }
      } catch (error) {
        console.warn(`[${APP.name}] 記録タブ取得失敗。現在のDOMにフォールバックします`, error);
      }
    }

    const tables = [...document.querySelectorAll('table')].map(tableInfo);
    const awardTable = findAwardTable(tables);
    if (!awardTable) {
      throw new Error('B表が見つかりません。GameID / 名前 / アワード表を取得できませんでした。');
    }

    const award = readAwardRows(awardTable);
    return {
      source: '現在のDOM',
      tournamentId,
      awardTableIndex: awardTable.tableIndex,
      awardCols: award.cols,
      awardRows: award.rows
    };
  }

  async function scanSinglePage() {
    const awardData = await loadAwardRows();
    const tournamentName = pageTournamentName();
    const prizeRows = readPrizeRows(null, awardData.awardRows, tournamentName);
    const tsv = toReviewTsv(prizeRows);
    const gameIdTsv = toGameIdTsv(prizeRows);

    return {
      mode: 'single',
      awardSource: awardData.source,
      tournamentId: awardData.tournamentId,
      awardTableIndex: awardData.awardTableIndex,
      awardCols: awardData.awardCols,
      awardRows: awardData.awardRows,
      prizeRows,
      summary: summarize(prizeRows),
      tsv,
      gameIdTsv
    };
  }

  function setStatus(text, kind = '') {
    const el = document.querySelector('#pwgidStatus');
    if (!el) return;
    el.textContent = text;
    el.className = kind;
  }

  function setOutput(text) {
    const el = document.querySelector('#pwgidOutput');
    if (el) el.value = text || '';
  }

  function setDbText(text, source = '手入力') {
    dbText = String(text || '');
    const el = document.querySelector('#pwgidDbInput');
    if (el && el.value !== dbText) el.value = dbText;
    if (dbText.trim()) {
      try {
        dbInfo = parseSeasonDatabase(dbText);
        setStatus(`シーズンDB読込完了：${dbInfo.rows.length}行 / ${dbInfo.format} / ${source}`, 'ok');
      } catch (error) {
        dbInfo = null;
        setStatus(error.message || String(error), 'err');
      }
    } else {
      dbInfo = null;
      setStatus('シーズンDBをクリアしました。', 'warn');
    }
  }

  function renderSummary(result) {
    const el = document.querySelector('#pwgidSummary');
    if (!el) return;
    const s = result.summary;
    el.innerHTML = `
      <div><b>PW行数</b> ${s.rows}</div>
      <div><b>GameID取得</b> ${s.matched}</div>
      <div><b>名前なし</b> ${s.noPlayer}</div>
      <div><b>該当なし</b> ${s.notMatched}</div>
      <div><b>同名複数</b> ${s.multiple}</div>
      <div><b>B表</b> #${result.awardTableIndex}</div>
      <div><b>B表取得元</b> ${result.awardSource || '-'}</div>
      <div><b>B表行数</b> ${result.awardRows.length}</div>
      <div><b>DT行数</b> ${result.awardRows.filter(row => row.source === 'DataTables').length}</div>
      <div><b>DB行数</b> ${dbInfo?.rows?.length || 0}</div>
    `;
  }

  async function runScan() {
    try {
      const result = await scanSinglePage();
      lastScan = result;
      lastTsv = result.tsv;
      lastGameIdTsv = result.gameIdTsv;
      setOutput(lastTsv);
      renderSummary(result);
      setStatus('スキャン完了。確認用TSVを出力しました。', 'ok');
      console.table(result.prizeRows.map(row => ({
        order: row.order,
        rank: row.rank,
        player: row.player,
        amount: row.amount,
        gameId: row.gameId,
        matchCount: row.matchCount,
        matchMode: row.matchMode,
        note: row.note
      })));
      console.log(`[${APP.name}]`, result);
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      console.error(`[${APP.name}]`, error);
    }
  }

  async function runCheck() {
    try {
      if (!dbText.trim()) {
        throw new Error('先にシーズンCSV/TSVを貼り付けるか、ファイルを選択してください。');
      }
      const seasonDb = parseSeasonDatabase(dbText);
      dbInfo = seasonDb;
      const scan = await scanSinglePage();
      const checkedRows = checkPrizeRows(scan.prizeRows, seasonDb, teamSize);
      const tsv = toCheckTsv(checkedRows);
      lastScan = { ...scan, checkedRows, seasonDb };
      lastTsv = tsv;
      lastGameIdTsv = scan.gameIdTsv;
      setOutput(tsv);
      renderSummary(scan);
      const counts = checkedRows.reduce((acc, row) => {
        acc[row['判定']] = (acc[row['判定']] || 0) + 1;
        return acc;
      }, {});
      setStatus(`チェック完了。チーム人数=${teamSize}, OK=${counts.OK || 0}, 特殊賞合算=${counts['OK_特殊賞合算'] || 0}, NG順位=${counts['NG_順位'] || 0}, NG_GameID=${counts['NG_GameID'] || 0}, 抽出失敗=${counts['NG_抽出失敗'] || 0}, SKIP=${counts.SKIP || 0}`, 'ok');
      console.table(checkedRows);
      console.log(`[${APP.name}] チェック結果`, { scan, seasonDb, checkedRows, counts });
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      console.error(`[${APP.name}] チェック失敗`, error);
    }
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDbText(reader.result || '', file.name || 'ファイル');
    reader.onerror = () => setStatus(`ファイル読込失敗：${file.name || ''}`, 'err');
    reader.readAsText(file, 'utf-8');
  }

  async function copyText(text) {
    if (!text) {
      setStatus('コピーする内容がありません。先にチェックしてください。', 'warn');
      return;
    }
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setStatus('TSVをコピーしました。', 'ok');
    } catch (error) {
      setStatus('コピーに失敗しました。TSVを手動で選択してください。', 'err');
      console.error(`[${APP.name}] コピー失敗`, error);
    }
  }

  function toggleMinimize() {
    const panel = document.getElementById(APP.panelId);
    if (panel) panel.classList.toggle('minimized');
  }

  function installPanel() {
    if (document.getElementById(APP.panelId)) return;

    const style = document.createElement('style');
    style.textContent = `
      #${APP.panelId}{position:fixed;right:18px;top:72px;width:520px;max-height:86vh;z-index:999999;background:#111827;color:#e5e7eb;border:1px solid #475569;border-radius:8px;font-family:Arial,"Yu Gothic","Meiryo",sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.35);overflow:auto}
      #${APP.panelId}.minimized{width:260px;max-height:none;overflow:hidden}
      #${APP.panelId}.minimized .pwgid-body{display:none}
      #${APP.panelId} .pwgid-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border-bottom:1px solid #334155}
      #${APP.panelId} .pwgid-title{font-weight:700;color:#fde68a}
      #${APP.panelId} .pwgid-body{padding:10px}
      #${APP.panelId} button{border:0;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer;background:#e5e7eb;color:#111827}
      #${APP.panelId} button.primary{background:#38bdf8;color:#082f49}
      #${APP.panelId} .pwgid-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
      #${APP.panelId} textarea{width:100%;height:300px;box-sizing:border-box;margin-top:8px;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:Consolas,"Courier New",monospace;white-space:pre;resize:vertical}
      #${APP.panelId} #pwgidDbInput{height:110px}
      #${APP.panelId} .pwgid-db-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
      #${APP.panelId} .pwgid-options{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;align-items:end}
      #${APP.panelId} label{font-size:12px;color:#cbd5e1;font-weight:700}
      #${APP.panelId} select{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:7px}
      #${APP.panelId} .pwgid-drop{border:1px dashed #64748b;border-radius:6px;padding:8px;margin-top:8px;text-align:center;color:#cbd5e1;background:#0f172a}
      #${APP.panelId} .pwgid-drop.drag{border-color:#38bdf8;color:#bae6fd}
      #${APP.panelId} input[type=file]{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:6px}
      #${APP.panelId} #pwgidSummary{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:8px;padding:8px;border:1px solid #334155;border-radius:6px;background:#0f172a;font-size:12px}
      #${APP.panelId} #pwgidStatus{margin-top:8px;font-size:12px;color:#cbd5e1}
      #${APP.panelId} #pwgidStatus.ok{color:#86efac}
      #${APP.panelId} #pwgidStatus.warn{color:#fde68a}
      #${APP.panelId} #pwgidStatus.err{color:#fca5a5}
      #${APP.panelId} .pwgid-note{margin-top:8px;font-size:12px;color:#cbd5e1;line-height:1.45}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = APP.panelId;
    panel.innerHTML = `
      <div class="pwgid-head">
        <div class="pwgid-title">プライズ GameID チェック</div>
        <button type="button" id="pwgidMini">_</button>
      </div>
      <div class="pwgid-body">
        <div class="pwgid-actions">
          <button type="button" class="primary" id="pwgidCheck">読込・チェック</button>
          <button type="button" id="pwgidCopy">結果コピー</button>
          <button type="button" id="pwgidClear">クリア</button>
        </div>
        <div class="pwgid-db-tools">
          <input type="file" id="pwgidFile" accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain">
          <button type="button" id="pwgidCopyGameId">GameIDのみコピー</button>
        </div>
        <div class="pwgid-options">
          <label>チーム人数
            <select id="pwgidTeamSize">
              <option value="1" selected>1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <div class="pwgid-note">普通順位のみ換算。説明に順位がある特殊賞は説明順位を使用。</div>
        </div>
        <div class="pwgid-drop" id="pwgidDrop">ここにシーズンCSV/TSVをドロップ</div>
        <textarea id="pwgidDbInput" spellcheck="false" placeholder="RankingList CSV、またはシーズン表をコピーして貼り付け"></textarea>
        <div id="pwgidSummary"></div>
        <textarea id="pwgidOutput" spellcheck="false" placeholder="チェック結果TSVがここに表示されます。"></textarea>
        <div id="pwgidStatus">準備完了。単一大会用・読み取り専用。</div>
        <div class="pwgid-note">シーズンCSV/TSVを読み込み、必要に応じてチーム人数を選択してからチェックしてください。</div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('pwgidCheck').addEventListener('click', runCheck);
    document.getElementById('pwgidCopy').addEventListener('click', () => copyText(lastTsv));
    document.getElementById('pwgidCopyGameId').addEventListener('click', () => copyText(lastGameIdTsv));
    document.getElementById('pwgidTeamSize').addEventListener('change', event => {
      teamSize = Math.max(1, Number(event.target.value) || 1);
      setStatus(`チーム人数=${teamSize}`);
    });
    document.getElementById('pwgidFile').addEventListener('change', event => {
      readFile(event.target.files?.[0]);
    });
    document.getElementById('pwgidDbInput').addEventListener('input', event => {
      dbText = event.target.value || '';
      dbInfo = null;
    });
    document.getElementById('pwgidDbInput').addEventListener('change', event => {
      setDbText(event.target.value || '', '貼り付け');
    });
    const drop = document.getElementById('pwgidDrop');
    drop.addEventListener('dragover', event => {
      event.preventDefault();
      drop.classList.add('drag');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', event => {
      event.preventDefault();
      drop.classList.remove('drag');
      readFile(event.dataTransfer?.files?.[0]);
    });
    document.getElementById('pwgidClear').addEventListener('click', () => {
      lastTsv = '';
      lastGameIdTsv = '';
      lastScan = null;
      dbText = '';
      dbInfo = null;
      setOutput('');
      const dbInput = document.getElementById('pwgidDbInput');
      if (dbInput) dbInput.value = '';
      renderSummary({ summary: { rows: 0, matched: 0, noPlayer: 0, notMatched: 0, multiple: 0 }, awardTableIndex: '-', awardRows: [] });
      setStatus('クリアしました。');
    });
    document.getElementById('pwgidMini').addEventListener('click', toggleMinimize);

    renderSummary({ summary: { rows: 0, matched: 0, noPlayer: 0, notMatched: 0, multiple: 0 }, awardTableIndex: '-', awardRows: [] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPanel);
  } else {
    installPanel();
  }
})();
