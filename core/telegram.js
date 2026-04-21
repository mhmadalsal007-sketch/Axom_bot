const TelegramBot = require('node-telegram-bot-api');

let bot = null;

function init() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  return bot;
}
function getBot() { return bot; }
function cid() { return process.env.TELEGRAM_CHAT_ID; }

// ─── SEND ─────────────────────────────────────────────────────
async function send(text, opts = {}) {
  if (!bot || !cid()) return;
  try { await bot.sendMessage(cid(), text, { parse_mode: 'HTML', ...opts }); }
  catch (e) { console.error('TG send error:', e.message); }
}

// ─── TRADE MESSAGES ──────────────────────────────────────────
function msgTradeOpen(t) {
  const dir = t.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const modeIcon = t.mode === 'PAPER' ? '📝' : '💰';
  const rrRaw = t.tp2 && t.stop_loss && t.entry_price
    ? (Math.abs(t.tp2 - t.entry_price) / Math.abs(t.entry_price - t.stop_loss)).toFixed(1)
    : '2.0';
  return `╔═══════════════════════╗
║  🎯 AXOM — صفقة جديدة  ║
╚═══════════════════════╝

${dir} ${t.symbol}  ${modeIcon} ${t.mode}
🌊 Wave: ${t.wave_type}  •  📊 Score: <b>${t.score}/100</b>
⚡ Leverage: <b>x${t.leverage}</b>  •  🕐 ${t.kill_zone || 'OFF-ZONE'}

📍 Entry:  <b>$${(+t.entry_price).toFixed(4)}</b>
🛑 SL:     <b>$${(+t.stop_loss).toFixed(4)}</b>
🎯 TP1:    <b>$${(+t.tp1).toFixed(4)}</b>
🎯 TP2:    <b>$${(+t.tp2).toFixed(4)}</b>
🎯 TP3:    <b>Trailing 0.3%</b>

💰 Risk:   <b>$${(+t.risk_amount).toFixed(2)}</b>
📐 RR:     <b>1:${rrRaw}</b>
💸 Fee:    <b>$${(+(t.fee_open||0)).toFixed(4)}</b>

⏰ ${new Date().toLocaleTimeString('ar-SA')}`;
}

function msgTP1(t, pnl, fee) {
  return `✅ <b>TP1 محقق!</b>  ${t.symbol}

💰 ربح جزئي: <b>+$${pnl.toFixed(4)}</b>
💸 رسوم: $${fee.toFixed(4)}
📈 صافي: <b>+$${(pnl - fee).toFixed(4)}</b>
🔒 SL → Entry (Breakeven)
⏳ ننتظر TP2...`;
}

function msgTP2(t, pnl, fee) {
  return `✅✅ <b>TP2 محقق!</b>  ${t.symbol}

💰 ربح جزئي: <b>+$${pnl.toFixed(4)}</b>
💸 رسوم: $${fee.toFixed(4)}
📈 صافي: <b>+$${(pnl - fee).toFixed(4)}</b>
🔒 SL → TP1 (مضمون الربح)
🚀 Trailing Stop نشط...`;
}

function msgClose(t) {
  const win = (t.pnl_after_fees || 0) > 0;
  const icon = win ? '🏆' : '❌';
  const tps = `${t.tp1_hit?'✅':'⬜'}TP1  ${t.tp2_hit?'✅':'⬜'}TP2  ${t.tp3_hit?'✅':'⬜'}TP3`;
  return `${icon} <b>صفقة مغلقة</b>  ${t.symbol}

📊 PnL:    <b>${win?'+':''}$${(+(t.pnl||0)).toFixed(4)}</b>
💸 رسوم:  <b>$${(+(t.total_fees||0)).toFixed(4)}</b>
📈 صافي:  <b>${win?'+':''}$${(+(t.pnl_after_fees||0)).toFixed(4)}</b>
${tps}
📝 السبب: ${t.close_reason}`;
}

function msgDailyReport(s, stats) {
  const wr = stats?.total_trades > 0 ? ((stats.winning_trades/stats.total_trades)*100).toFixed(1) : 0;
  return `╔═══════════════════════╗
║  📊 تقرير AXOM اليومي  ║
╚═══════════════════════╝

📅 ${new Date().toLocaleDateString('ar-SA')}
${s?.mode==='PAPER'?'📝 تجريبي':'💰 حقيقي'}

💰 PnL:     <b>${(stats?.total_pnl||0)>=0?'+':''}$${(+(stats?.total_pnl||0)).toFixed(4)}</b>
💸 رسوم:   <b>$${(+(stats?.total_fees||0)).toFixed(4)}</b>
📈 صافي:   <b>${(stats?.net_pnl||0)>=0?'+':''}$${(+(stats?.net_pnl||0)).toFixed(4)}</b>

📊 صفقات: ${stats?.total_trades||0}
✅ ناجحة: ${stats?.winning_trades||0} (${wr}%)
❌ خاسرة: ${stats?.losing_trades||0}
🏆 أفضل:  +$${(+(stats?.best_trade_pnl||0)).toFixed(4)}
📉 أسوأ:   $${(+(stats?.worst_trade_pnl||0)).toFixed(4)}

/start_day لبدء يوم جديد 🚀`;
}

function msgStatus(session, openTrades, stats) {
  const running = session?.status === 'ACTIVE';
  const wr = stats?.total_trades > 0 ? ((stats.winning_trades/stats.total_trades)*100).toFixed(1) : '0';
  const pnl = +(session?.net_pnl||0);
  return `╔═══════════════════════╗
║     📡 AXOM Status     ║
╚═══════════════════════╝

${running?'🟢 نشط':'🔴 موقوف'}  •  ${process.env.BOT_MODE==='PAPER'?'📝 تجريبي':'💰 حقيقي'}

💰 رأس المال: <b>$${(+(session?.start_capital||0)).toFixed(2)}</b>
📊 الرصيد:   <b>$${(+(session?.current_balance||0)).toFixed(2)}</b>
📈 أعلى:     <b>$${(+(session?.daily_high||0)).toFixed(2)}</b>
🛑 Daily Stop: <b>$${(+(session?.daily_stop_amount||0)).toFixed(2)}</b>
📈 PnL اليوم: <b>${pnl>=0?'+':''}$${pnl.toFixed(4)}</b>

🔄 صفقات مفتوحة: <b>${openTrades?.length||0}</b>
📊 صفقات اليوم:  <b>${stats?.total_trades||0}</b>
✅ Win Rate:     <b>${wr}%</b>`;
}

function msgError(source, msg, detail='') {
  return `🚨 <b>تنبيه خطأ — AXOM</b>

🔴 المصدر: <b>${source}</b>
📝 الخطأ: ${msg}
${detail?`🔍 ${detail}`:''}
⏰ ${new Date().toLocaleTimeString('ar-SA')}

/status للتحقق  •  /errors للتفاصيل`;
}

function msgProfitLock(bal, high, lockLevel) {
  return `⚠️ <b>Profit Protection!</b>

📈 أعلى نقطة: <b>$${high.toFixed(2)}</b>
💰 الرصيد الحالي: <b>$${bal.toFixed(2)}</b>
🔒 مستوى الإيقاف: <b>$${lockLevel.toFixed(2)}</b>

وصلت لـ 50% من أعلى ربح اليوم!

/continue_trading — استمر
/stop_trading — أوقف وحافظ على الربح`;
}

function msgDailyStop(loss, limit) {
  return `🛑 <b>Daily Stop محقق!</b>

💸 الخسارة: <b>$${loss.toFixed(2)}</b>
🚫 الحد اليومي: <b>$${limit.toFixed(2)}</b>

البوت توقف تلقائياً لحماية رأس مالك.
/start_day غداً لبدء من جديد.`;
}

function msgScanUpdate(symbol, score, direction, ls) {
  return `🔍 <b>فحص السوق</b>

${score >= 75 ? '🔥' : '⏳'} ${symbol}
📊 Score: <b>${score}/100</b>
${direction ? `📍 اتجاه: ${direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}` : '❌ لا يوجد إشارة'}
💧 Liquidity Score: <b>${ls}/100</b>
⏰ ${new Date().toLocaleTimeString('ar-SA')}`;
}

// ─── EXPORT SEND HELPERS ─────────────────────────────────────
async function sendTradeOpen(t) { await send(msgTradeOpen(t)); }
async function sendTP1(t, pnl, fee) { await send(msgTP1(t, pnl, fee)); }
async function sendTP2(t, pnl, fee) { await send(msgTP2(t, pnl, fee)); }
async function sendClose(t) { await send(msgClose(t)); }
async function sendDailyReport(s, stats) { await send(msgDailyReport(s, stats)); }
async function sendStatus(session, open, stats) { await send(msgStatus(session, open, stats)); }
async function sendError(source, msg, detail='') { await send(msgError(source, msg, detail)); }
async function sendProfitLock(bal, high, lock) { await send(msgProfitLock(bal, high, lock)); }
async function sendDailyStop(loss, limit) { await send(msgDailyStop(loss, limit)); }
async function sendScanUpdate(sym, score, dir, ls) { await send(msgScanUpdate(sym, score, dir, ls)); }
async function sendText(text) { await send(text); }

module.exports = {
  init, getBot, send,
  sendTradeOpen, sendTP1, sendTP2, sendClose,
  sendDailyReport, sendStatus, sendError,
  sendProfitLock, sendDailyStop, sendScanUpdate, sendText
};
