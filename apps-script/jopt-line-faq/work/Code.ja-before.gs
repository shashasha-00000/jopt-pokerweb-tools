/** JOPT LINE FAQ — Google Sheets backed web app */
const TABS = { nodes:'db_nodes', channels:'db_channels', handoffs:'db_handoffs', vars:'db_vars', messages:'db_messages', events:'db_events' };
const COLS = {
  nodes:    ['id','parent','order','label','type','body','channel','handoff','follow','links','status','review','evidence'],
  channels: ['id','name','url','scope','status','last_seen','uses','note'],
  handoffs: ['id','name','team','priority','slack','sla','fields','note'],
  vars:     ['key','value','valid_until','note'],
  messages: ['id','title','text'],
  events:   ['id','order','active','name','dates','venue','guide_url','receipt_form','receipt_deadline','age_note','photo_url','media_form','extra','note']
};
const META = ['updated_by','updated_at'];
const IDF = { vars:'key' };
const ARR = { links:1, fields:1, tags:1 };   // 1行に1つ（改行区切り）
const BOOL = { follow:1, active:1, per_event:1 };
const NUM = { order:1, uses:1 };

function doGet(e) {
  const admin = e && e.parameter && e.parameter.mode === 'admin';
  return HtmlService.createHtmlOutputFromFile(admin ? 'Index' : 'Simple')
    .setTitle('JOPT LINE FAQ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function sheet_(kind) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TABS[kind]);
  if (!sh) {
    sh = ss.insertSheet(TABS[kind]);
    const h = COLS[kind].concat(META);
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#e8efe9');
    sh.setFrozenRows(1);
  }
  return sh;
}

function toCell_(k, v) {
  if (v === null || v === undefined) return '';
  if (ARR[k]) return (v || []).join('\n');
  if (BOOL[k]) return v ? 'TRUE' : 'FALSE';
  return String(v);
}
function fromCell_(k, v) {
  v = v === undefined ? '' : String(v);
  if (ARR[k]) return v ? v.split(/\r?\n/).map(s => s.trim()).filter(String) : [];
  if (BOOL[k]) return v.toUpperCase() === 'TRUE';
  if (NUM[k]) return v === '' ? null : Number(v);
  if (k === 'channel' || k === 'handoff' || k === 'parent') return v === '' ? null : v;
  return v;
}

function readKind_(kind) {
  const sh = sheet_(kind);
  const vals = sh.getDataRange().getDisplayValues();
  const head = vals[0] || [];
  const idf = IDF[kind] || 'id';
  const out = {};
  for (let r = 1; r < vals.length; r++) {
    const o = {};
    head.forEach((k, i) => { if (k && META.indexOf(k) < 0) o[k] = fromCell_(k, vals[r][i]); });
    if (o[idf]) out[o[idf]] = o;
  }
  return out;
}

function getAll() {
  const out = {};
  Object.keys(TABS).forEach(k => out[k] = readKind_(k));
  out.user = Session.getActiveUser().getEmail() || '';
  return out;
}

function saveDoc(kind, obj) {
  const lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(kind), idf = IDF[kind] || 'id';
    let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    Object.keys(obj).concat(META).forEach(k => {
      if (head.indexOf(k) < 0) { head.push(k); sh.getRange(1, head.length).setValue(k).setFontWeight('bold'); }
    });
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, head.indexOf(idf) + 1, sh.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]) : [];
    const i = ids.indexOf(String(obj[idf]));
    const row = i < 0 ? sh.getLastRow() + 1 : i + 2;
    const rec = Object.assign({}, obj, { updated_by: Session.getActiveUser().getEmail() || '', updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') });
    const line = head.map(k => META.indexOf(k) >= 0 ? rec[k] : toCell_(k, rec[k]));
    const rg = sh.getRange(row, 1, 1, head.length);
    rg.setNumberFormat('@'); rg.setValues([line]);
  } finally { lock.releaseLock(); }
  return getAll();
}

function deleteDoc(kind, id) {
  const lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(kind), idf = IDF[kind] || 'id';
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    if (sh.getLastRow() > 1) {
      const ids = sh.getRange(2, head.indexOf(idf) + 1, sh.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]);
      const i = ids.indexOf(String(id));
      if (i >= 0) sh.deleteRow(i + 2);
    }
  } finally { lock.releaseLock(); }
  return getAll();
}

/** 最初に1回だけ実行：db_ タブを作って初期データを入れる */
function setup() {
  Object.keys(TABS).forEach(kind => {
    const sh = sheet_(kind);
    if (sh.getLastRow() > 1) return; // 既にデータがあれば何もしない
    const head = COLS[kind].concat(META);
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    const rows = Object.values(SEED[kind]).map(o => head.map(k => META.indexOf(k) >= 0 ? (k === 'updated_by' ? 'setup' : now) : toCell_(k, o[k])));
    if (rows.length) { const rg = sh.getRange(2, 1, rows.length, head.length); rg.setNumberFormat('@'); rg.setValues(rows); }
    sh.getRange(1, 1, sh.getLastRow(), head.length).setVerticalAlignment('top').setWrap(true);
  });
}

/** 誤って変更・削除したボタンを初期データから戻す（管理者用） */
function restore_(id) {
  const all = readKind_('nodes');
  const kids = id2 => Object.values(all).filter(n => n.parent === id2);
  const walk = id2 => { kids(id2).forEach(c => { walk(c.id); deleteDoc('nodes', c.id); }); };
  walk(id);
  if (SEED.nodes[id]) saveDoc('nodes', SEED.nodes[id]);
}
function restorePrizeType() { restore_('prize_type'); }

/** 開催回ごとの情報を「開催大会」に移す（1回だけ実行） */
function migrateEvents() {
  const V = readKind_('vars'), g = k => (V[k] && V[k].value) || '';
  const ev = readKind_('events');
  if (!Object.keys(ev).length) {
    saveDoc('events', { id:'ev_osaka02', order:1, active:true, name:g('event_name'), dates:g('event_dates'), venue:g('event_venue'),
      guide_url:g('players_guide_url'), receipt_form:g('receipt_form_event'), receipt_deadline:g('receipt_send_deadline'),
      age_note:g('age_note'), photo_url:g('photo_album_url'), media_form:g('media_form_url'), note:'変数から移行' });
  }
  const MAP = { event_name:'大会名', event_dates:'日程', event_venue:'会場', players_guide_url:'ガイドURL', receipt_form_event:'領収書フォーム',
    receipt_send_deadline:'領収書送付期限', age_note:'年齢制限', photo_album_url:'写真アルバム', media_form_url:'メディア申請' };
  const N = readKind_('nodes');
  Object.values(N).forEach(n => {
    let b = n.body || '', hit = false;
    Object.keys(MAP).forEach(k => { const re = new RegExp('\\{\\{\\s*' + k + '\\s*\\}\\}', 'g'); if (re.test(b)) { hit = true; b = b.replace(re, '【' + MAP[k] + '】'); } });
    if (hit) saveDoc('nodes', Object.assign({}, n, { body: b, per_event: true }));
  });
}

/** 問い合わせにカテゴリ（タグ）を付ける（1回だけ実行。既にタグがあるものは変更しない） */
function migrateTags() {
  const TAGS = ['プライズ','チケット','大会参加・エントリー','領収書','コイン・選手契約','JOPT Games','GameIDアプリ','店舗・お仕事','忘れ物・商品','その他'];
  const BY_ANC = { prize:'プライズ', ticket:'チケット', entry:'大会参加・エントリー', receipt:'領収書', coin:'コイン・選手契約', games:'JOPT Games', biz:'店舗・お仕事', goods:'忘れ物・商品', human:'その他' };
  const BY_ID = { lost:['忘れ物・商品'], app_gameid:['GameIDアプリ'], ticket_which:['チケット','JOPT Games'] };
  const EXTRA = { ticket_games:['JOPT Games'], games_live_voucher:['チケット'], games_merges:['チケット'], games_ticket_types:['チケット'],
    prize_contract_status:['コイン・選手契約'], receipt_coin:['コイン・選手契約'], app_link:['GameIDアプリ'], games_id_diff:['GameIDアプリ'],
    entry_pay:['コイン・選手契約'], coin_entry:['大会参加・エントリー'] };
  const N = readKind_('nodes');
  Object.values(N).forEach(n => {
    if (n.type === 'menu' || n.id === 'root' || (n.tags && n.tags.length)) return;
    let tags = (BY_ID[n.id] || []).slice();
    let p = n;
    while (!tags.length && p) { if (BY_ANC[p.id]) tags.push(BY_ANC[p.id]); p = N[p.parent]; }
    (EXTRA[n.id] || []).forEach(t => { if (tags.indexOf(t) < 0) tags.push(t); });
    if (!tags.length) tags = ['その他'];
    saveDoc('nodes', Object.assign({}, n, { tags: tags }));
  });
  const M = readKind_('messages');
  if (!M.msg_tags) saveDoc('messages', { id:'msg_tags', title:'カテゴリ一覧', text: JSON.stringify(TAGS) });
}
