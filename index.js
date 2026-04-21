require('dotenv').config();
const express = require('express');
const cron = require('node-cron');

const tg = require('./core/telegram');
const db = require('./core/database');
const B = require('./core/binance');
const G = require('./core/gemini');
const scanner = require('./hunters/scanner');
const executor = require('./trading/executor');
const { DailyRisk, checkBreakers } = require('./trading/risk');
const { register } = require('./handlers/commands');

// ─── STATE ────────────────────────────────────────────────────
let running = false;
let session = null;
let riskMgr = null;
let prices = {};
let prevBtcPrice = null;
let scanLoop = null;
let monitorLoop = null;
let ws = null;
let pausedUntil = null;

// ─── EXPRESS HEALTH CHECK (port 3000) ────────────────────────
const app = express();
app.get('/', (req, res) => {
  res.json({
    status: 'ok', bot: 'AXOM Trading Bot v2.0',
    running, mode: process.env.BOT_MODE || 'PAPER',
    session: session ? { balance: session.current_balance, status: session.status } : null,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Health check on port ${PORT}`));

// ─── START BOT ────────────────────────────────────────────────
async function startBot(capital, stopPct) {
  try {
    session = await db.createDailySession(capital, stopPct);
    riskMgr = new DailyRisk(capital, stopPct);
    running = true;
    pausedUntil = null;

    await db.saveLog('INFO','SYSTEM',`Bot started. Capital:$${capital} Stop:${stopPct}%`);

    // Scan loop — every 30 seconds
    scanLoop = setInterval(mainLoop, 30000);
    // Monitor loop — every 10 seconds
    monitorLoop = setInterval(() => executor.monitorAll(prices), 10000);
    // Status update — every 5 minutes
    setInterval(periodicStatus, 300000);

    // Run immediately
    setTimeout(mainLoop, 2000);
    await tg.sendText(`✅ <b>AXOM يعمل الآن!</b>

💰 رأس المال: <b>$${capital}</b>
🛑 Daily Stop: <b>${stopPct}% = $${(capital*stopPct/100).toFixed(2)}</b>
📝 الوضع: <b>${process.env.BOT_MODE==='REAL'?'حقيقي 💰':'تجريبي 📝'}</b>
🔍 يصطاد الفرص الآن...`);
  } catch (e) {
    running = false;
    await db.saveError('START','SYSTEM', e.message);
    await tg.sendError('Bot Start', e.message);
    throw e;
  }
}

// ─── STOP BOT ─────────────────────────────────────────────────
async function stopBot() {
  running = false;
  if (scanLoop) { clearInterval(scanLoop); scanLoop = null; }
  if (monitorLoop) { clearInterval(monitorLoop); monitorLoop = null; }
  if (session) {
    await db.updateSession(session.id, { status: 'STOPPED', stopped_at: new Date().toISOString() });
    session = null;
  }
  await db.saveLog('INFO','SYSTEM','Bot stopped');
}

// ─── MAIN LOOP ────────────────────────────────────────────────
async function mainLoop() {
  if (!running || !session || !riskMgr) return;

  // Check pause
  if (pausedUntil && Date.now() < pausedUntil) return;
  if (pausedUntil && Date.now() >= pausedUntil) pausedUntil = null;

  try {
    // 1. Refresh session
    session = await db.getActiveSession();
    if (!session) { running = false; return; }

    // 2. Daily stop checks
    const shouldStop = riskMgr.shouldStop();
    if (shouldStop.stop) {
      if (shouldStop.ask) {
        await stopBot();
        await tg.sendProfitLock(riskMgr.balance, riskMgr.high, riskMgr.high * 0.5);
        return;
      }
      if (shouldStop.reason === 'DAILY_STOP') {
        await stopBot();
        const lost = riskMgr.start - riskMgr.balance;
        await tg.sendDailyStop(lost, riskMgr.stopAmount);
        return;
      }
    }

    // 3. Pause check
    const shouldPause = riskMgr.shouldPause();
    if (shouldPause.pause) {
      pausedUntil = Date.now() + shouldPause.mins * 60000;
      await tg.sendText(`⏸️ <b>استراحة مؤقتة</b>\n${shouldPause.reason}\nيعود بعد ${shouldPause.mins} دقيقة`);
      await db.saveLog('WARN','RISK', `Paused: ${shouldPause.reason}`);
      return;
    }

    // 4. Check open trades limit
    const openTrades = await db.getOpenTrades();
    const settings = await db.getSettings();
    if (openTrades.length >= (settings.max_concurrent_trades || 3)) return;

    // 5. Check daily trade limit
    const todayTrades = await db.getTodayTrades();
    if (todayTrades.length >= (settings.max_daily_trades || 15)) return;

    // 6. Circuit breakers
    const btc = prices['BTCUSDT'];
    if (btc && prevBtcPrice) {
      const chg = ((btc - prevBtcPrice) / prevBtcPrice) * 100;
      const alerts = checkBreakers({ priceChangePct: chg, funding: 0 });
      for (const a of alerts) {
        if (a.action === 'CLOSE_ALL') {
          await executor.closeAll('FLASH_CRASH');
          await tg.sendError('CIRCUIT BREAKER', `Flash crash detected: ${chg.toFixed(2)}%`);
          return;
        }
      }
    }
    if (btc) prevBtcPrice = btc;

    // 7. Scan
    const opp = await scanner.scan(openTrades);
    if (opp && opp.decision === 'APPROVE' && opp.score >= 75) {
      // Open trade
      const trade = await executor.openTrade(opp, session, riskMgr);
      // Update session balance
      const updatedSession = await db.getActiveSession();
      if (updatedSession) session = updatedSession;
    }

    // 8. Update stats
    await updateStats();

  } catch (e) {
    console.error('Main loop error:', e.message);
    await db.saveError('MAIN_LOOP','SYSTEM', e.message);
    // Don't stop — just log
  }
}

// ─── PERIODIC STATUS (every 5 min) ───────────────────────────
async function periodicStatus() {
  if (!running || !session) return;
  try {
    const open = await db.getOpenTrades();
    const stats = (await db.getDailyStats(1))[0] || {};
    const rm = riskMgr?.status() || {};
    const wsStatus = ws?.isConnected() ? '🟢' : '🔴';

    await tg.sendText(`📡 <b>AXOM — تحديث دوري</b>

${running?'🟢 نشط':'🔴 موقوف'}  ${wsStatus} WS  ${process.env.BOT_MODE==='REAL'?'💰':'📝'}

💰 رأس المال: $${(+session.start_capital).toFixed(2)}
📊 الرصيد: <b>$${(+session.current_balance).toFixed(4)}</b>
📈 أعلى: $${rm.high?.toFixed(4)||'0'}
🪜 Ladder: x${rm.ladder||1}
🎯 Streak: ${rm.streak||0} wins

🔄 مفتوحة: ${open.length} | 📊 اليوم: ${stats.total_trades||0}
✅ Win Rate: ${stats.win_rate?.toFixed(1)||0}%
💸 رسوم اليوم: $${stats.total_fees?.toFixed(4)||'0'}`);
  } catch (e) { console.error('Status error:', e.message); }
}

// ─── UPDATE STATS ─────────────────────────────────────────────
async function updateStats() {
  try {
    const today = await db.getTodayTrades();
    const closed = today.filter(t => t.status === 'CLOSED');
    const wins = closed.filter(t => (t.pnl_after_fees||0) > 0);
    const totalPnl = closed.reduce((s,t) => s+(t.pnl||0), 0);
    const totalFees = closed.reduce((s,t) => s+(t.total_fees||0), 0);
    const pnls = closed.map(t => t.pnl_after_fees||0);
    await db.upsertDailyStats({
      mode: process.env.BOT_MODE||'PAPER',
      total_trades: closed.length,
      winning_trades: wins.length,
      losing_trades: closed.length - wins.length,
      win_rate: closed.length > 0 ? (wins.length/closed.length)*100 : 0,
      total_pnl: totalPnl,
      total_fees: totalFees,
      net_pnl: totalPnl - totalFees,
      best_trade_pnl: pnls.length ? Math.max(...pnls) : 0,
      worst_trade_pnl: pnls.length ? Math.min(...pnls) : 0,
      avg_score: closed.length > 0 ? closed.reduce((s,t)=>s+(t.score||0),0)/closed.length : 0,
      avg_leverage: closed.length > 0 ? closed.reduce((s,t)=>s+(t.leverage||0),0)/closed.length : 0
    });
    // Update session PnL
    if (session) {
      session = await db.updateSession(session.id, {
        total_pnl: totalPnl,
        total_fees: totalFees,
        net_pnl: totalPnl - totalFees,
        total_trades: closed.length,
        winning_trades: wins.length,
        current_balance: (riskMgr?.balance || session.start_capital)
      });
    }
  } catch (e) { console.error('updateStats error:', e.message); }
}

// ─── WEBSOCKET ────────────────────────────────────────────────
function startWS() {
  ws = new B.AxomWebSocket();
  ws.onPrice(tick => { prices[tick.symbol] = tick.price; });
  ws.onLiquidation(liq => { scanner.trackLiquidation(liq); });
  const syms = ['btcusdt','ethusdt','solusdt','bnbusdt','xrpusdt'];
  ws.connect(syms);
  console.log('✅ WebSocket started');
}

// ─── MIDNIGHT RESET ───────────────────────────────────────────
cron.schedule('0 0 * * *', async () => {
  console.log('🌙 Midnight reset...');
  const prevSession = await db.getTodaySession();
  await stopBot();
  if (prevSession) {
    const stats = (await db.getDailyStats(1))[0] || {};
    await tg.sendDailyReport(prevSession, stats);
  }
  await tg.sendText('🌙 <b>انتهى اليوم</b>\nأرسل /start_day لبدء يوم جديد.');
}, { timezone: 'UTC' });

// ─── ERROR HANDLERS ───────────────────────────────────────────
process.on('uncaughtException', async e => {
  console.error('CRASH:', e.message);
  await db.saveError('CRASH','SYSTEM', e.message, { stack: e.stack }).catch(()=>{});
  await tg.sendError('CRASH', e.message).catch(()=>{});
});
process.on('unhandledRejection', async reason => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('REJECTION:', msg);
  await db.saveError('REJECTION','SYSTEM', msg).catch(()=>{});
});

// ─── MAIN ─────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════╗');
  console.log('║   AXOM Trading Bot v2.0  ║');
  console.log('║   ICT/SMC Elite System   ║');
  console.log('╚══════════════════════════╝');
  console.log('');

  try {
    // Init Gemini
    G.init();
    console.log('✅ Gemini AI initialized');

    // Init Telegram
    const bot = tg.init();
    console.log('✅ Telegram bot initialized');

    // Register commands
    register(bot, startBot, stopBot);
    console.log('✅ Commands registered');

    // Test DB
    await db.getSettings();
    console.log('✅ Database connected');

    // Start WebSocket
    startWS();

    console.log('');
    console.log('✅ AXOM is ready! Send /start in Telegram.');
    console.log('');

    await tg.sendText(`🟢 <b>AXOM Bot Online!</b>

النظام جاهز للتداول.
أرسل /start للبدء.

⏰ ${new Date().toLocaleString('ar-SA')}`);

  } catch (e) {
    console.error('❌ Startup failed:', e.message);
    process.exit(1);
  }
}

main();
