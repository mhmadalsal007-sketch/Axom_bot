// ============================================================
// AXOM v3 — Professional Dashboard & Messaging System
// Elite formatting, unified design language
// One live message, throttled 1.5s
// ============================================================
const MT     = require('./marketTracker');
const logger = require('../utils/logger');
const KB     = require('../handlers/keyboards');

let bot       = null;
let dashMsgId = null;
let chatId    = null;
let lastEdit  = 0;
const THROTTLE = 1500;
let dashTimer  = null;
let stateRef   = null;

// ─── SEPARATORS & DESIGN LANGUAGE ─────────────────────────────
const SEP  = '━━━━━━━━━━━━━━━━━━━━━━';
const SEP2 = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
const LINE = '─────────────────────';

function init(botInstance, cid) {
  bot    = botInstance;
  chatId = cid || process.env.TELEGRAM_CHAT_ID;
}
function setStateRef(ref) { stateRef = ref; }

// ─── MODE BADGE ───────────────────────────────────────────────
function modeBadge(mode) {
  if (mode === 'REAL')  return '💰 حقيقي';
  if (mode === 'DEMO')  return '🎮 ديمو';
  return '📝 تجريبي';
}

function modeFlag(mode) {
  if (mode === 'REAL')  return '🔴';
  if (mode === 'DEMO')  return '🟡';
  return '🔵';
}

// ─── PNL FORMAT ───────────────────────────────────────────────
function pnlFmt(val) {
  const n = +(val || 0);
  return (n >= 0 ? '📈 +' : '📉 ') + '$' + Math.abs(n).toFixed(4);
}

// ─── BUILD LIVE DASHBOARD ─────────────────────────────────────
function buildDashboard() {
  if (!stateRef) return '⏳ <i>جارٍ التهيئة...</i>';

  const { session, openTrades, top3, running, compound, wss, scanMode } = stateRef;
  const mode   = process.env.BOT_MODE || 'PAPER';
  const now    = new Date().toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const wsM    = wss?.isMarketConnected()  ? '🟢' : '🔴';
  const wsA    = wss?.isAccountConnected() ? '🟢' : '🔴';
  const status = running ? '🟢 <b>نشط</b>' : '🔴 <b>موقوف</b>';
  const scan   = scanMode === 'AUTO' ? '🤖 تلقائي' : scanMode === 'SUGGEST' ? '💡 اقتراح' : '⏸️ مغلق';

  let txt = `╔══════════════════════╗
║  🤖 <b>AXOM Trading Bot</b>    ║
╚══════════════════════╝

${status}  ${modeFlag(mode)} <b>${modeBadge(mode)}</b>
⏰ ${now}   🔍 ${scan}
📡 Market: ${wsM}  Account: ${wsA}

`;

  // ── Balance Block ──
  if (session) {
    const pnl    = +(session.net_pnl || 0);
    const bal    = +(session.current_balance || session.start_capital);
    const cap    = +(session.start_capital);
    const high   = +(session.daily_high || bal);
    const stop   = +(session.daily_stop_amount);
    const pnlPct = cap > 0 ? ((pnl / cap) * 100).toFixed(2) : '0.00';

    txt += `${SEP}
💼 <b>جلسة اليوم</b>
${SEP}
💵 رأس المال:  <b>$${cap.toFixed(2)}</b>
💰 الرصيد:     <b>$${bal.toFixed(4)}</b>
📈 أعلى اليوم: <b>$${high.toFixed(4)}</b>
🛑 حد الخسارة: <b>$${stop.toFixed(2)}</b>
${pnlFmt(pnl)}  <b>(${pnlPct}%)</b>
`;

    if (compound) {
      txt += `🪜 Ladder: <b>×${compound.ladderMultiplier.toFixed(1)}</b>  🎯 Streak: <b>${compound.consecutiveWins}</b>  WR: <b>${compound.winRate()}%</b>\n`;
    }

    const wins  = session.winning_trades || 0;
    const total = session.total_trades   || 0;
    txt += `📊 صفقات اليوم: <b>${total}</b>  ✅ <b>${wins}</b>  ❌ <b>${total - wins}</b>\n`;

  } else {
    txt += `${SEP}
💤 <i>لا توجد جلسة نشطة</i>
👉 اضغط <b>🚀 بدء يوم</b> للبدء
`;
  }

  // ── Top 3 Candidates ──
  if (top3?.length) {
    txt += `\n${SEP}
🔍 <b>أفضل المرشحين</b>
${SEP}
`;
    top3.forEach((t, i) => {
      const rank  = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      const dir   = t.direction === 'LONG' ? '🟢 LONG' : t.direction === 'SHORT' ? '🔴 SHORT' : '⬜';
      const price = MT.getPrice(t.symbol);
      const dec   = t.decision === 'APPROVE' ? '✅' : '❌';
      txt += `${rank} <b>${t.symbol}</b>  ${dec} ${dir}  Score: <b>${t.score}</b>`;
      if (price) txt += `  $${price.toFixed(2)}`;
      txt += '\n';
      if (t.summary) txt += `    <i>${t.summary}</i>\n`;
    });
  }

  // ── Open Trades ──
  if (openTrades?.length) {
    txt += `\n${SEP}
🔄 <b>صفقات مفتوحة (${openTrades.length})</b>
${SEP}
`;
    openTrades.forEach(t => {
      const cur  = MT.getPrice(t.symbol) || +t.current_price || +t.entry_price;
      const long = t.direction === 'LONG';
      const uPnl = long
        ? (cur - t.entry_price) * (t.position_size || 1)
        : (t.entry_price - cur) * (t.position_size || 1);
      const pnlIcon = uPnl >= 0 ? '📈' : '📉';
      const tp1 = t.tp1_hit ? '✅' : '⬜';
      const tp2 = t.tp2_hit ? '✅' : '⬜';

      txt += `${long ? '🟢' : '🔴'} <b>${t.symbol}</b> ×${t.leverage}  Score: ${t.score}  ${t.kill_zone || ''}\n`;
      txt += `   📍 Entry: $${(+t.entry_price).toFixed(4)}  🎯 SL: $${(+t.stop_loss).toFixed(4)}\n`;
      txt += `   ${pnlIcon} uPnL: <b>${uPnl >= 0 ? '+' : ''}$${uPnl.toFixed(4)}</b>  ${tp1}TP1  ${tp2}TP2\n`;
    });
  } else if (running) {
    txt += `\n<i>لا توجد صفقات مفتوحة — يبحث عن فرص...</i>\n`;
  }

  txt += `\n${LINE}`;
  return txt;
}

// ─── UPDATE DASHBOARD (throttled) ─────────────────────────────
async function update() {
  if (!bot || !chatId) return;
  if (Date.now() - lastEdit < THROTTLE) return;
  lastEdit = Date.now();

  const text = buildDashboard();
  try {
    if (!dashMsgId) {
      const msg = await bot.sendMessage(chatId, text, {
        parse_mode:   'HTML',
        ...KB.dashboardKB,
      });
      dashMsgId = msg.message_id;
    } else {
      await bot.editMessageText(text, {
        chat_id:    chatId,
        message_id: dashMsgId,
        parse_mode: 'HTML',
        ...KB.dashboardKB,
      });
    }
  } catch (e) {
    if (e.message?.includes('message is not modified'))      return;
    if (e.message?.includes('message to edit not found'))   { dashMsgId = null; return; }
    if (e.message?.includes('Too Many Requests'))           { await new Promise(r=>setTimeout(r,3000)); return; }
    logger.warn('DASHBOARD', e.message);
  }
}

function startLiveDashboard() {
  if (dashTimer) clearInterval(dashTimer);
  dashTimer = setInterval(update, THROTTLE);
  logger.info('DASHBOARD', 'Live dashboard started (1.5s)');
}
function stopLiveDashboard() {
  if (dashTimer) { clearInterval(dashTimer); dashTimer = null; }
}
function resetDashMsg() { dashMsgId = null; }

// ─── SEND HELPERS ─────────────────────────────────────────────
async function send(text, opts = {}) {
  if (!bot || !chatId) return null;
  try { return await bot.sendMessage(chatId, text, { parse_mode:'HTML', ...opts }); }
  catch (e) { logger.warn('TG', `send: ${e.message}`); return null; }
}

async function sendError(title, msg) {
  return send(`🚨 <b>خطأ — ${title}</b>\n<code>${msg}</code>`);
}

// ─── TRADE NOTIFICATIONS ─────────────────────────────────────

async function sendTradeOpen(trade) {
  const dir    = trade.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const mode   = trade.mode || 'PAPER';
  const modeIc = mode === 'REAL' ? '💰' : mode === 'DEMO' ? '🎮' : '📝';

  return send(
`${SEP2}
${dir}  <b>${trade.symbol}</b>  ×${trade.leverage}
${SEP2}
📍 الدخول:   <b>$${(+trade.entry_price).toFixed(4)}</b>
🛑 Stop Loss: <b>$${(+trade.stop_loss).toFixed(4)}</b>
🎯 TP1:       <b>$${(+trade.tp1).toFixed(4)}</b>
🎯 TP2:       <b>$${(+trade.tp2).toFixed(4)}</b>
🎯 TP3:       <b>$${(+trade.tp3).toFixed(4)}</b>

💼 حجم المركز: <b>$${(+trade.position_value).toFixed(2)}</b>
💳 الهامش:     <b>$${(+trade.margin_used).toFixed(4)}</b>
⚡ الرافعة:    <b>×${trade.leverage}</b>
📊 النقاط:    <b>${trade.score}</b>  🕐 ${trade.kill_zone || 'OFF_ZONE'}
${modeIc} الوضع: <b>${modeBadge(mode)}</b>
${trade.smt_detected  ? '🔗 SMT Divergence مكتشف\n' : ''}${trade.slippage_hunt ? '🎯 Slippage Hunt مكتشف\n' : ''}
${SEP2}`
  );
}

async function sendTP(trade, n, pnl, fee) {
  const icons = ['', '🥇', '🥈', '🥉'];
  return send(
`${icons[n]} <b>TP${n} محقق!</b>  <b>${trade.symbol}</b>
💰 الربح: <b>+$${pnl.toFixed(4)}</b>  (رسوم: $${fee.toFixed(4)})
🔒 SL انتقل إلى: <b>${n === 1 ? 'نقطة الدخول' : 'TP1'}</b>
📊 33% من المركز خرج بأمان ✅`
  );
}

async function sendClose(trade) {
  const pnl    = +(trade.pnl_after_fees || 0);
  const won    = pnl >= 0;
  const icon   = won ? '✅' : '❌';
  const reason = trade.close_reason || 'CLOSED';
  const reasons = {
    SL_HIT:       '🛑 Stop Loss',
    BREAKEVEN:    '🔒 Breakeven',
    TRAILING_STOP:'📌 Trailing Stop',
    EMERGENCY:    '🚨 طارئ',
    FLASH_CRASH:  '⚡ Flash Crash',
  };

  return send(
`${icon} <b>صفقة مغلقة</b>  ${trade.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT'} <b>${trade.symbol}</b>
${SEP}
📍 الدخول:  <b>$${(+trade.entry_price).toFixed(4)}</b>
📤 الخروج:  <b>$${(+trade.close_price).toFixed(4)}</b>
${won ? '💰' : '💸'} الربح/الخسارة: <b>${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}</b>  (<b>${trade.pnl_percent || 0}%</b>)
💳 الرسوم:  <b>$${(+trade.total_fees || 0).toFixed(4)}</b>
📌 السبب:   <b>${reasons[reason] || reason}</b>
${SEP}`
  );
}

async function sendDailyStop(lost, limit) {
  return send(
`🛑 <b>توقف اليوم</b>
${SEP}
تم الوصول إلى حد الخسارة اليومية.

💸 الخسارة: <b>$${(+lost).toFixed(2)}</b>
🚧 الحد:     <b>$${(+limit).toFixed(2)}</b>

🌙 <i>الرجاء الراحة ومراجعة الاستراتيجية.</i>
استخدم /start_day غداً للبدء من جديد.`
  );
}

async function sendProfitLock(balance, high) {
  return send(
`⚠️ <b>تنبيه حماية الأرباح</b>
${SEP}
الرصيد الحالي انخفض بشكل ملحوظ.

💰 أعلى رصيد: <b>$${(+high).toFixed(4)}</b>
📊 الرصيد الآن: <b>$${(+balance).toFixed(4)}</b>

هل تريد حماية أرباحك أم الاستمرار؟`,
    require('../handlers/keyboards').profitLockKB
  );
}

async function sendDailyReport(session, stats) {
  const pnl   = +(session.net_pnl || 0);
  const total = session.total_trades || 0;
  const wins  = session.winning_trades || 0;
  const wr    = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

  return send(
`📋 <b>تقرير نهاية اليوم</b>
${SEP2}
📅 <b>${new Date().toLocaleDateString('ar-SA')}</b>

💰 رأس المال: <b>$${(+session.start_capital).toFixed(2)}</b>
📊 الرصيد النهائي: <b>$${(+session.current_balance).toFixed(4)}</b>
${pnlFmt(pnl)}  (<b>${+(session.start_capital) > 0 ? ((pnl / +session.start_capital)*100).toFixed(2) : 0}%</b>)

📈 صفقات: <b>${total}</b>  ✅ <b>${wins}</b>  ❌ <b>${total - wins}</b>
🎯 معدل الفوز: <b>${wr}%</b>
💳 الرسوم: <b>$${(+(session.total_fees || 0)).toFixed(4)}</b>

🌙 <i>شكراً — نراك غداً!</i>
${SEP2}`
  );
}

async function sendBalanceAlert(available, mode) {
  return send(
`⚠️ <b>تنبيه رصيد</b>
الرصيد المتاح منخفض جداً.

💵 المتاح: <b>$${(+available).toFixed(4)}</b>
${modeFlag(mode)} الوضع: <b>${modeBadge(mode)}</b>

<i>لا يمكن فتح صفقات جديدة حتى يرتفع الرصيد.</i>`
  );
}

module.exports = {
  init, setStateRef, update,
  startLiveDashboard, stopLiveDashboard, resetDashMsg,
  send, sendError,
  sendTradeOpen, sendTP, sendClose,
  sendDailyStop, sendProfitLock, sendDailyReport, sendBalanceAlert,
};
