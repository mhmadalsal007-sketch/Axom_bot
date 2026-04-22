// ============================================================
// AXOM — Logger
// Structured logging: console + DB + Telegram on errors
// ============================================================
const LEVELS = { DEBUG:0, INFO:1, WARN:2, ERROR:3 };
const ICONS  = { DEBUG:'🔵', INFO:'✅', WARN:'⚠️', ERROR:'🔴' };

let _db   = null;
let _send = null; // telegram send fn

function init(db, sendFn) { _db = db; _send = sendFn; }

function _log(level, source, message, meta = null) {
  const ts  = new Date().toISOString();
  const icon = ICONS[level] || '◻️';
  console.log(`[${ts}] ${icon} [${source}] ${message}${meta ? ' | ' + JSON.stringify(meta) : ''}`);

  // Save to DB (non-blocking)
  if (_db) {
    _db.saveLog(level, source, message, meta).catch(() => {});
  }

  // Send critical errors to Telegram
  if (level === 'ERROR' && _send) {
    _send(`🚨 <b>خطأ — ${source}</b>\n${message}${meta ? `\n<code>${JSON.stringify(meta)}</code>` : ''}`).catch(() => {});
  }
}

module.exports = {
  init,
  debug: (src, msg, meta) => _log('DEBUG', src, msg, meta),
  info:  (src, msg, meta) => _log('INFO',  src, msg, meta),
  warn:  (src, msg, meta) => _log('WARN',  src, msg, meta),
  error: (src, msg, meta) => _log('ERROR', src, msg, meta),
};
