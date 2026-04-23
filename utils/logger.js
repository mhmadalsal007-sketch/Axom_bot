// ============================================================
// AXOM — Structured Logger
// Maps any source to valid DB categories
// ============================================================
const LEVELS = { DEBUG:0, INFO:1, WARN:2, ERROR:3 };
const ICONS  = { DEBUG:'🔵', INFO:'✅', WARN:'⚠️', ERROR:'🔴' };

// Map free-form sources to valid DB categories
const CATEGORY_MAP = {
  SYSTEM:'SYSTEM', SERVER:'SYSTEM', AXOM:'SYSTEM', CRON:'SYSTEM',
  START:'SYSTEM', STOP:'SYSTEM', DB:'SYSTEM',
  TRADE:'TRADE', EXECUTOR:'TRADE', MONITOR:'TRADE', PAPER:'TRADE',
  RISK:'RISK', COMPOUND:'RISK',
  API:'API', BINGX:'API', WSS:'API', WS:'API', ACCOUNT:'API', MARKET:'API',
  SCORER:'ANALYSIS', ANALYZER:'ANALYSIS', AI:'ANALYSIS',
  SCAN:'SCAN', SUGGEST:'SCAN', SCANNER:'SCAN',
};

function mapCategory(source) {
  const upper = (source || '').toUpperCase();
  return CATEGORY_MAP[upper] || 'SYSTEM';
}

let _db   = null;
let _send = null;

function init(db, sendFn) {
  _db   = db;
  _send = sendFn;
}

function _log(level, source, message, meta = null) {
  const ts   = new Date().toISOString();
  const icon = ICONS[level] || '◻️';
  console.log(`[${ts}] ${icon} [${source}] ${message}${meta ? ' | ' + JSON.stringify(meta) : ''}`);

  const category = mapCategory(source);

  if (_db) {
    _db.saveLog(level, category, `[${source}] ${message}`, meta).catch(() => {});
  }

  if (level === 'ERROR' && _send) {
    _send(`🚨 <b>خطأ — ${source}</b>\n${message}`).catch(() => {});
  }
}

module.exports = {
  init,
  debug: (s,m,x) => _log('DEBUG', s, m, x),
  info:  (s,m,x) => _log('INFO',  s, m, x),
  warn:  (s,m,x) => _log('WARN',  s, m, x),
  error: (s,m,x) => _log('ERROR', s, m, x),
};
