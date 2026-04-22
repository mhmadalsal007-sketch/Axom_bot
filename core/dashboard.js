// ============================================================
// AXOM — Live Dashboard
// Edits ONE Telegram message every 1.5s (throttled)
// Shows: price, top3 candidates, open trades, balance
// ============================================================
const TelegramBot = require('node-telegram-bot-api');
const MT  = require('../core/marketTracker');
const logger = require('../utils/logger');

let bot          = null;
let dashMsgId    = null;  // the single dashboard message id
let chatId       = null;
let lastEdit     = 0;
const THROTTLE   = 1500;  // 1.5 seconds
let dashTimer    = null;
let stateRef     = null;  // reference to app state

function init(botInstance, cid) {
  bot    = botInstance;
  chatId = cid || process.env.TELEGRAM_CHAT_ID;
}

function setStateRef(ref) { stateRef = ref; }

// ─── BUILD DASHBOARD TEXT ─────────────────────────────────────
function buildDashboard() {
  if (!stateRef) return '⏳ جارٍ التهيئة...';

  const { session, openTrades, top3, running, compound, wss } = stateRef;
  const mode  = process.env.BOT_MODE || 'PAPER';
  const now   = new Date().toLocaleTimeString('ar-SA');
  const wsStat = wss?.isMarketConnected() ? '🟢' : '🔴';
  const accStat = wss?.isAccountConnected() ? '🟢' : '🔴';

  let txt = `╔══════════════════════════╗
║  🤖 <b>AXOM Live Dashboard</b>   ║
╚══════════════════════════╝
⏰ ${now}  ${running?'🟢 نشط':'🔴 موقوف'}  ${mode==='PAPER'?'📝':(mode==='DEMO'?'🎮':'💰')}
📡 Market:${wsStat}  Account:${accStat}

`;

  // Balance
  if (session) {
    const pnl = +(session.net_pnl||0);
    const pnlIcon = pnl>0?'📈':pnl<0?'📉':'➡️';
    txt += `💰 <b>رأس المال:</b> $${(+session.start_capital).toFixed(2)}
📊 <b>الرصيد:</b>    $${(+session.current_balance).toFixed(4)}
📈 <b>أعلى:</b>     $${(+session.daily_high).toFixed(4)}
🛑 <b>Stop:</b>     $${(+session.daily_stop_amount).toFixed(2)}
${pnlIcon} <b>PnL:</b>      ${pnl>=0?'+':''}$${pnl.toFixed(4)}\n`;

    if (compound) {
      txt += `🪜 Ladder: x${compound.ladderMultiplier}  🎯 Streak: ${compound.consecutiveWins}\n`;
    }
  } else {
    txt += `💤 <i>انتظر /start_day لبدء اليوم</i>\n`;
  }

  txt += '\n';

  // Top 3 candidates
  if (top3?.length) {
    txt += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    txt += `🔍 <b>أفضل 3 مرشحين:</b>\n`;
    top3.forEach((t,i) => {
      const rankIcon = i===0?'🥇':i===1?'🥈':'🥉';
      const dirIcon  = t.direction==='LONG'?'🟢':'🔴';
      const price    = MT.getPrice(t.symbol);
      txt += `${rankIcon} <b>${t.symbol}</b> ${dirIcon}${t.direction||'?'} Score:<b>${t.score}</b>`;
      if (price) txt += ` $${price.toFixed(2)}`;
      txt += `\n   ${t.summary||t.reject_reason||''}\n`;
    });
    txt += '\n';
  }

  // Open trades
  if (openTrades?.length) {
    txt += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    txt += `🔄 <b>صفقات مفتوحة (${openTrades.length}):</b>\n`;
    openTrades.forEach(t => {
      const curPrice = MT.getPrice(t.symbol) || t.entry_price;
      const isLong   = t.direction === 'LONG';
      const uPnl     = isLong
        ? (curPrice - t.entry_price) * (t.position_size||1)
        : (t.entry_price - curPrice) * (t.position_size||1);
      const uIcon    = uPnl>=0?'📈':'📉';
      txt += `${t.direction==='LONG'?'🟢':'🔴'} <b>${t.symbol}</b> x${t.leverage} Score:${t.score}\n`;
      txt += `   📍$${t.entry_price}  ${uIcon}${uPnl>=0?'+':''}$${uPnl.toFixed(4)}\n`;
      txt += `   ${t.tp1_hit?'✅':'⬜'}TP1 ${t.tp2_hit?'✅':'⬜'}TP2 ⬜TP3\n`;
    });
  }

  return txt;
}

// ─── UPDATE DASHBOARD (throttled) ─────────────────────────────
async function update() {
  if (!bot || !chatId) return;
  const now = Date.now();
  if (now - lastEdit < THROTTLE) return;
  lastEdit = now;

  const text = buildDashboard();
  try {
    if (!dashMsgId) {
      const msg = await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[
          { text:'🔄 تحديث', callback_data:'refresh_dash' },
          { text:'🚨 طارئ',  callback_data:'emergency_close' }
        ]]}
      });
      dashMsgId = msg.message_id;
    } else {
      await bot.editMessageText(text, {
        chat_id: chatId, message_id: dashMsgId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[
          { text:'🔄 تحديث', callback_data:'refresh_dash' },
          { text:'🚨 طارئ',  callback_data:'emergency_close' }
        ]]}
      });
    }
  } catch (e) {
    if (e.message?.includes('message is not modified')) return;
    if (e.message?.includes('message to edit not found')) { dashMsgId = null; return; }
    logger.warn('DASHBOARD', e.message);
  }
}

function startLiveDashboard() {
  if (dashTimer) clearInterval(dashTimer);
  dashTimer = setInterval(update, THROTTLE);
  logger.info('DASHBOARD', 'Live dashboard started (1.5s interval)');
}

function stopLiveDashboard() {
  if (dashTimer) { clearInterval(dashTimer); dashTimer = null; }
}

function resetDashMsg() { dashMsgId = null; }

// ─── ONE-OFF MESSAGES ─────────────────────────────────────────
async function send(text, opts = {}) {
  if (!bot || !chatId) return null;
  try { return await bot.sendMessage(chatId, text, { parse_mode:'HTML', ...opts }); }
  catch (e) { logger.warn('TG', `send: ${e.message}`); return null; }
}

async function sendTradeOpen(t) {
  await send(`╔══════════════════╗
║  🎯 صفقة جديدة   ║
╚══════════════════╝

${t.direction==='LONG'?'🟢 LONG':'🔴 SHORT'} <b>${t.symbol}</b>
📊 Score: <b>${t.score}</b>  ⚡ x${t.leverage}
🕐 ${t.kill_zone||'OFF'}

📍 Entry:  <b>$${(+t.entry_price).toFixed(4)}</b>
🛑 SL:     <b>$${(+t.stop_loss).toFixed(4)}</b>
🎯 TP1:    <b>$${(+t.tp1).toFixed(4)}</b>
🎯 TP2:    <b>$${(+t.tp2).toFixed(4)}</b>
🎯 TP3:    Trailing 0.3%

💰 Risk: <b>$${(+t.risk_amount).toFixed(2)}</b>
💸 Fee:  <b>$${(+(t.fee_open||0)).toFixed(4)}</b>`);
}

async function sendTP(t, num, pnl, fee) {
  await send(`✅ <b>TP${num} محقق!</b>  ${t.symbol}
💰 +$${pnl.toFixed(4)}  💸 fee:$${fee.toFixed(4)}
📈 صافي: +$${(pnl-fee).toFixed(4)}
🔒 SL → ${num===1?'Entry':'TP'+( num-1)}`);
}

async function sendClose(t) {
  const win = (t.pnl_after_fees||0) > 0;
  await send(`${win?'🏆':'❌'} <b>صفقة مغلقة</b>  ${t.symbol}
💰 PnL: ${win?'+':''}$${(+(t.pnl||0)).toFixed(4)}
💸 رسوم: $${(+(t.total_fees||0)).toFixed(4)}
📈 صافي: ${win?'+':''}$${(+(t.pnl_after_fees||0)).toFixed(4)}
${t.tp1_hit?'✅':'⬜'}TP1 ${t.tp2_hit?'✅':'⬜'}TP2 ${t.tp3_hit?'✅':'⬜'}TP3
📝 ${t.close_reason}`);
}

async function sendDailyReport(session, stats) {
  const wr = stats?.total_trades>0 ? ((stats.winning_trades/stats.total_trades)*100).toFixed(1):0;
  await send(`╔══════════════════════╗
║  📊 تقرير AXOM اليومي  ║
╚══════════════════════╝

💰 PnL:   ${(stats?.net_pnl||0)>=0?'+':''}$${(+(stats?.net_pnl||0)).toFixed(4)}
💸 رسوم: $${(+(stats?.total_fees||0)).toFixed(4)}
📊 صفقات: ${stats?.total_trades||0}
✅ WR:    ${wr}%

/start_day لبدء يوم جديد 🚀`);
}

async function sendError(source, msg) {
  await send(`🚨 <b>خطأ — ${source}</b>\n${msg}`);
}

async function sendProfitLock(bal, high) {
  await send(`⚠️ <b>Profit Protection!</b>
📈 أعلى: $${high.toFixed(4)}
💰 الآن: $${bal.toFixed(4)}
تراجع 50% من الذروة!`,
    { reply_markup:{ inline_keyboard:[[
      { text:'▶️ استمر', callback_data:'continue_trading' },
      { text:'🔒 أوقف',  callback_data:'stop_trading'     }
    ]]}});
}

async function sendDailyStop(loss, limit) {
  await send(`🛑 <b>Daily Stop محقق</b>
💸 خسارة: $${loss.toFixed(2)}  حد: $${limit.toFixed(2)}
البوت توقف. /start_day غداً.`);
}

async function sendBalanceAlert(balance, mode) {
  await send(`⚠️ <b>تنبيه رصيد</b>
وضع: ${mode}
رصيد: $${balance.toFixed(4)}
لا يكفي لفتح صفقة جديدة.`);
}

module.exports = {
  init, setStateRef, update,
  startLiveDashboard, stopLiveDashboard, resetDashMsg,
  send, sendTradeOpen, sendTP, sendClose,
  sendDailyReport, sendError, sendProfitLock,
  sendDailyStop, sendBalanceAlert
};
