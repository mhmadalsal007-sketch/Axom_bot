require('dotenv').config();
const express = require('express');
const cron = require('node-cron');

const tg = require('./core/telegram');
const db = require('./core/database');
const B = require('./core/bingx');
const G = require('./core/gemini');
const scanner = require('./hunters/scanner');
const executor = require('./trading/executor');
const { DailyRisk, checkBreakers } = require('./trading/risk');
const { CompoundingSystem } = require('./trading/compounding');
const { register } = require('./handlers/commands');
const marketTracker = require('./core/marketTracker');

// ─── STATE ────────────────────────────────────────────────────
let running = false;
let session = null;
let riskMgr = null;
let compound = null;
let scanLoop = null;
let monitorLoop = null;
let oiLoop = null;
let statusLoop = null;
let ws = null;
let pausedUntil = null;

// ─── EXPRESS HEALTH CHECK (port 3000) ────────────────────────
const app = express();
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    bot: 'AXOM Trading Bot v2.0',
    running,
    mode: process.env.BOT_MODE || 'PAPER',
    wsConnected: ws?.isConnected() || false,
    session: session ? {
      balance: session.current_balance,
      status: session.status,
      date: session.date
    } : null,
    compound: compound ? compound.getState() : null,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Health check running on port ${PORT}`));

// ─── START BOT ────────────────────────────────────────────────
async function startBot(capital, stopPct) {
  try {
    // Clear old loops
    await stopBot(true);

    session = await db.createDailySession(capital, stopPct);
    riskMgr = new DailyRisk(capital, stopPct);
    compound = new CompoundingSystem(capital, (capital * stopPct) / 100);
    running = true;
    pausedUntil = null;

    await db.saveLog('INFO', 'SYSTEM', `Bot started. Capital:$${capital} Stop:${stopPct}%`);

    // Initial market data fetch
    await refreshMarketData();

    // Loops
    scanLoop    = setInterval(mainLoop, 30000);
    monitorLoop = setInterval(monitorTrades, 10000);
    oiLoop      = setInterval(refreshMarketData, 120000);
    statusLoop  = setInterval(periodicStatus, 300000);

    // Run scan immediately after 3s
    setTimeout(mainLoop, 3000);

    await tg.sendText(`✅ <b>AXOM يعمل الآن!</b>

💰 رأس المال: <b>$${capital}</b>
🛑 Daily Stop: <b>${stopPct}% = $${(capital * stopPct / 100).toFixed(2)}</b>
📝 الوضع: <b>${process.env.BOT_MODE === 'REAL' ? 'حقيقي 💰' : 'تجريبي 📝'}</b>
🔍 يصطاد الفرص الآن...

أوامر التحكم:
/status — حالة البوت
/trades — الصفقات المفتوحة
/stop — إيقاف`);

  } catch (e) {
    running = false;
    await db.saveError('START', 'SYSTEM', e.message);
    await tg.sendError('Bot Start', e.message);
    throw e;
  }
}

// ─── STOP BOT ─────────────────────────────────────────────────
async function stopBot(silent = false) {
  running = false;
  if (scanLoop)    { clearInterval(scanLoop);    scanLoop = null; }
  if (monitorLoop) { clearInterval(monitorLoop); monitorLoop = null; }
  if (oiLoop)      { clearInterval(oiLoop);      oiLoop = null; }
  if (statusLoop)  { clearInterval(statusLoop);  statusLoop = null; }

  if (session && !silent) {
    await db.updateSession(session.id, {
      status: 'STOPPED',
      stopped_at: new Date().toISOString()
    });
    session = null;
  }
  if (!silent) {
    await db.saveLog('INFO', 'SYSTEM', 'Bot stopped');
  }
}

// ─── REFRESH MARKET DATA (OI, Funding) ───────────────────────
async function refreshMarketData() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
  for (const sym of symbols) {
    try {
      const [oi, fund] = await Promise.all([B.getOI(sym), B.getFunding(sym)]);
      marketTracker.updateOI(sym, oi);
      marketTracker.updateFunding(sym, fund.fundingRate);
    } catch (e) {
      // Non-critical — continue
    }
  }
}

// ─── MONITOR OPEN TRADES ─────────────────────────────────────
async function monitorTrades() {
  if (!running) return;
  try {
    await executor.monitorAll(marketTracker.getAllPrices());
  } catch (e) {
    console.error('Monitor error:', e.message);
  }
}

// ─── MAIN SCAN LOOP ──────────────────────────────────────────
async function mainLoop() {
  if (!running || !session || !riskMgr) return;

  // Pause check
  if (pausedUntil && Date.now() < pausedUntil) return;
  if (pausedUntil && Date.now() >= pausedUntil) {
    pausedUntil = null;
    await tg.sendText('▶️ <b>انتهت الاستراحة</b> — AXOM يعمل من جديد!');
  }

  try {
    // 1. Refresh session
    session = await db.getActiveSession();
    if (!session) { running = false; return; }

    // 2. Compound stop checks
    if (compound) {
      const check = compound.checkStops();
      if (check.action === 'STOP') {
        await stopBot();
        if (check.reason === 'DAILY_STOP') {
          await tg.sendDailyStop(riskMgr.start - riskMgr.balance, riskMgr.stopAmount);
        } else {
          await tg.sendText(`🔒 <b>Profit Lock</b>\n${check.message}`);
        }
        return;
      }
      if (check.action === 'ASK') {
        await stopBot();
        await tg.sendProfitLock(compound.currentBalance, compound.dailyHigh, compound.dailyHigh * 0.5);
        return;
      }
      if (check.action === 'PAUSE' && !pausedUntil) {
        pausedUntil = Date.now() + check.duration * 60000;
        await tg.sendText(`⏸️ <b>استراحة مؤقتة</b>\n${check.message}`);
        await db.saveLog('WARN', 'RISK', `Paused: ${check.reason}`);
        return;
      }
    }

    // 3. Check open trades limit & daily limit
    const openTrades = await db.getOpenTrades();
    const settings = await db.getSettings();
    if (openTrades.length >= (settings.max_concurrent_trades || 3)) return;

    const todayTrades = await db.getTodayTrades();
    if (todayTrades.length >= (settings.max_daily_trades || 15)) return;

    // 4. Flash crash check
    const btcPrice = marketTracker.getPrice('BTCUSDT');
    if (btcPrice && marketTracker.isFlashCrash('BTCUSDT')) {
      await executor.closeAll('FLASH_CRASH');
      await tg.sendError('CIRCUIT BREAKER', 'Flash crash detected on BTC!');
      pausedUntil = Date.now() + 30 * 60000; // pause 30 min
      return;
    }

    // 5. Scan for opportunity
    const opp = await scanner.scan(openTrades);

    if (opp && opp.decision === 'APPROVE' && opp.score >= 75) {
      // Use compound risk
      const currentRisk = compound ? compound.getCurrentRisk() : session.start_capital;
      opp.risk_override = currentRisk;

      // Add leverage bonus from streak
      if (compound) opp.leverage = Math.min(50, opp.leverage + compound.getLeverageBonus());

      const trade = await executor.openTrade(opp, session, riskMgr);

      // Send scan update
      await tg.sendScanUpdate(opp.symbol, opp.score, opp.direction, opp.liquidity_score || 0);
    }

    // 6. Update stats
    await updateStats();

  } catch (e) {
    console.error('Main loop error:', e.message);
    await db.saveError('MAIN_LOOP', 'SYSTEM', e.message);
  }
}

// ─── PERIODIC STATUS (every 5 min) ───────────────────────────
async function periodicStatus() {
  if (!running || !session) return;
  try {
    const [open, statsArr] = await Promise.all([
      db.getOpenTrades(),
      db.getDailyStats(1)
    ]);
    const stats = statsArr[0] || {};
    const cs = compound?.getState() || {};
    const wsOk = ws?.isConnected();

    await tg.sendText(`📡 <b>AXOM — تحديث دوري</b>

${running ? '🟢 نشط' : '🔴 موقوف'}  ${wsOk ? '🟢' : '🔴'} WS  ${process.env.BOT_MODE === 'REAL' ? '💰' : '📝'}

💰 رأس المال: $${(+session.start_capital).toFixed(2)}
📊 الرصيد: <b>$${(cs.balance || session.current_balance || 0).toFixed(4)}</b>
📈 أعلى: $${(cs.dailyHigh || 0).toFixed(4)}
🪜 Ladder: x${cs.ladderMultiplier || 1}  🎯 Streak: ${cs.consecutiveWins || 0}

🔄 مفتوحة: ${open.length}  📊 اليوم: ${stats.total_trades || 0}
✅ Win Rate: ${stats.win_rate?.toFixed(1) || 0}%
💸 رسوم اليوم: $${(stats.total_fees || 0).toFixed(4)}
📋 آخر 5: ${cs.last5 || '—'}`);
  } catch (e) {
    console.error('Status error:', e.message);
  }
}

// ─── UPDATE DAILY STATS ───────────────────────────────────────
async function updateStats() {
  try {
    const today = await db.getTodayTrades();
    const closed = today.filter(t => t.status === 'CLOSED');
    const wins = closed.filter(t => (t.pnl_after_fees || 0) > 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalFees = closed.reduce((s, t) => s + (t.total_fees || 0), 0);
    const pnls = closed.map(t => t.pnl_after_fees || 0);

    await db.upsertDailyStats({
      mode: process.env.BOT_MODE || 'PAPER',
      total_trades: closed.length,
      winning_trades: wins.length,
      losing_trades: closed.length - wins.length,
      win_rate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
      total_pnl: totalPnl,
      total_fees: totalFees,
      net_pnl: totalPnl - totalFees,
      best_trade_pnl: pnls.length ? Math.max(...pnls) : 0,
      worst_trade_pnl: pnls.length ? Math.min(...pnls) : 0,
      avg_score: closed.length > 0 ? closed.reduce((s, t) => s + (t.score || 0), 0) / closed.length : 0,
      avg_leverage: closed.length > 0 ? closed.reduce((s, t) => s + (t.leverage || 0), 0) / closed.length : 0
    });

    // Update session
    if (session) {
      const newBal = compound?.currentBalance || session.start_capital;
      session = await db.updateSession(session.id, {
        total_pnl: totalPnl,
        total_fees: totalFees,
        net_pnl: totalPnl - totalFees,
        total_trades: closed.length,
        winning_trades: wins.length,
        current_balance: parseFloat(newBal.toFixed(4)),
        daily_high: parseFloat((compound?.dailyHigh || newBal).toFixed(4))
      });
    }

    // Update compound with latest closed trade if any
    if (closed.length > 0 && compound) {
      const lastTrade = closed[closed.length - 1];
      if (lastTrade.closed_at) {
        const closedAt = new Date(lastTrade.closed_at).getTime();
        const fiveSecsAgo = Date.now() - 5000;
        if (closedAt > fiveSecsAgo) {
          // Just closed — update compound
          compound.recordTrade(lastTrade.pnl || 0, lastTrade.total_fees || 0);
        }
      }
    }
  } catch (e) {
    console.error('updateStats error:', e.message);
  }
}

// ─── WEBSOCKET ────────────────────────────────────────────────
function startWS() {
  ws = new B.AxomWebSocket();

  ws.onPrice(tick => {
    marketTracker.updatePrice(tick.symbol, tick.price);
  });

  ws.onLiquidation(liq => {
    if (liq.symbol && liq.value) {
      marketTracker.addLiquidation(liq.symbol, liq.value);
      scanner.trackLiquidation(liq);
    }
  });

  const symbols = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'xrpusdt'];
  ws.connect(symbols);
  console.log(`✅ WebSocket started (${symbols.length} pairs)`);
}

// ─── MIDNIGHT RESET ───────────────────────────────────────────
cron.schedule('0 0 * * *', async () => {
  console.log('🌙 Midnight reset...');
  const prevSession = await db.getTodaySession();
  await stopBot();

  if (prevSession) {
    const statsArr = await db.getDailyStats(1);
    const stats = statsArr[0] || {};
    await tg.sendDailyReport(prevSession, stats);
  }

  await tg.sendText('🌙 <b>انتهى اليوم</b>\nأرسل /start_day لبدء يوم جديد.');
  await db.saveLog('INFO', 'SYSTEM', 'Daily reset completed');
}, { timezone: 'UTC' });

// ─── GLOBAL ERROR HANDLERS ────────────────────────────────────
process.on('uncaughtException', async e => {
  console.error('CRASH:', e.message);
  await db.saveError('CRASH', 'SYSTEM', e.message, { stack: e.stack }).catch(() => {});
  await tg.sendError('CRASH', e.message).catch(() => {});
});

process.on('unhandledRejection', async reason => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('REJECTION:', msg);
  await db.saveError('REJECTION', 'SYSTEM', msg).catch(() => {});
});

// ─── MAIN ENTRY ───────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════╗');
  console.log('║    AXOM Trading Bot v2.0     ║');
  console.log('║    ICT/SMC Elite System      ║');
  console.log('╚══════════════════════════════╝');
  console.log('');

  try {
    // Init AI
    G.init();
    console.log('✅ Gemini AI initialized');

    // Init Telegram
    const bot = tg.init();
    console.log('✅ Telegram bot initialized');

    // Register command handlers
    register(bot, startBot, stopBot);
    console.log('✅ Commands registered');

    // Test DB connection
    await db.getSettings();
    console.log('✅ Database connected');

    // Start WebSocket
    startWS();

    // Initial market data
    await refreshMarketData();
    console.log('✅ Market data loaded');

    console.log('');
    console.log('✅ AXOM is READY! Send /start in Telegram.');
    console.log('');

    await tg.sendText(`🟢 <b>AXOM Bot Online!</b>

النظام جاهز للتداول.
أرسل /start_day للبدء.

⏰ ${new Date().toLocaleString('ar-SA')}`);

  } catch (e) {
    console.error('❌ Startup failed:', e.message);
    process.exit(1);
  }
}

main();
