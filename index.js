// ============================================================
// AXOM v3 — Main Orchestrator
// Bank-grade architecture: WSS-first, live dashboard,
// AI scoring pipeline, suggestion system
// ============================================================
require('dotenv').config();
const express  = require('express');
const cron     = require('node-cron');
const TgBot    = require('node-telegram-bot-api');

const db       = require('./core/database');
const bingx    = require('./core/bingx');
const wss      = require('./core/wssEngine');
const MT       = require('./core/marketTracker');
const dash     = require('./core/dashboard');
const logger   = require('./utils/logger');
const scorer   = require('./brain/scorer');
const { register } = require('./handlers/commands');
const { openTrade, monitorAll, closeAll, CompoundState } = require('./trading/executor');

// ─── APP STATE ────────────────────────────────────────────────
const appState = {
  running:    false,
  session:    null,
  compound:   null,
  openTrades: [],
  top3:       [],
  wss:        null,
  pausedUntil:null,
  scanMode:   'AUTO', // AUTO | SUGGEST | OFF
};

// ─── EXPRESS HEALTH CHECK ────────────────────────────────────
const app = express();
app.get('/', (_, res) => res.json({
  status:'ok', bot:'AXOM v3', running:appState.running,
  mode: process.env.BOT_MODE||'PAPER',
  wss:  { market: wss.isMarketConnected(), account: wss.isAccountConnected() },
  uptime: process.uptime(), ts: Date.now()
}));
app.get('/health', (_, res) => res.json({ status:'ok', ts:Date.now() }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info('SERVER', `Health check on :${PORT}`));

// ─── START BOT ────────────────────────────────────────────────
async function startBot(capital, stopPct, resume = false) {
  try {
    if (!capital && resume && appState.session) {
      appState.running = true;
      dash.startLiveDashboard();
      return;
    }

    // Stop any existing loops
    await stopBot(true);

    appState.session  = await db.createSession(capital, stopPct);
    appState.compound = new CompoundState(capital, (capital * stopPct) / 100);
    appState.running  = true;
    appState.pausedUntil = null;

    dash.setStateRef(appState);
    dash.startLiveDashboard();

    await db.saveLog('INFO','SYSTEM',`Started. Capital:$${capital} Stop:${stopPct}% Mode:${process.env.BOT_MODE}`);
    await dash.send(`✅ <b>AXOM يعمل!</b>

💰 $${capital}  🛑 ${stopPct}%=$${(capital*stopPct/100).toFixed(2)}
${process.env.BOT_MODE==='REAL'?'💰 حقيقي':process.env.BOT_MODE==='DEMO'?'🎮 ديمو':'📝 تجريبي'}
📡 WSS: ${wss.isMarketConnected()?'🟢':'🔴'}

🔍 يصطاد الفرص الآن...`);

  } catch (e) {
    logger.error('START', e.message);
    await dash.sendError('Bot Start', e.message);
    throw e;
  }
}

// ─── STOP BOT ────────────────────────────────────────────────
async function stopBot(silent = false) {
  appState.running = false;
  dash.stopLiveDashboard();
  if (appState.session && !silent) {
    await db.updateSession(appState.session.id, { status:'STOPPED', stopped_at:new Date().toISOString() });
    appState.session = null;
  }
  if (!silent) await db.saveLog('INFO','SYSTEM','Bot stopped');
}

// ─── MAIN SCAN LOOP (every 30s) ──────────────────────────────
async function mainLoop() {
  if (!appState.running || !appState.session) return;
  if (appState.pausedUntil && Date.now() < appState.pausedUntil) return;
  if (appState.pausedUntil && Date.now() >= appState.pausedUntil) {
    appState.pausedUntil = null;
    await dash.send('▶️ <b>انتهت الاستراحة</b> — AXOM يعمل!');
  }

  try {
    // Refresh session
    appState.session = await db.getActiveSession();
    if (!appState.session) { appState.running = false; return; }

    // Compound stop checks
    const cs = appState.compound;
    if (cs) {
      const chk = cs.shouldStop();
      if (chk.stop) {
        if (chk.ask) {
          await stopBot();
          await dash.sendProfitLock(cs.balance, cs.high);
          return;
        }
        await stopBot();
        if (chk.reason==='DAILY_STOP') {
          await dash.sendDailyStop(cs.baseRisk-cs.balance, cs.stopAmount);
        }
        return;
      }
      const pause = cs.shouldPause();
      if (pause.pause && !appState.pausedUntil) {
        appState.pausedUntil = Date.now() + pause.mins * 60000;
        await dash.send(`⏸️ <b>استراحة</b> ${pause.reason}`);
        return;
      }
    }

    // Flash crash check
    if (MT.isFlashCrash('BTCUSDT')) {
      await closeAll('FLASH_CRASH');
      await dash.sendError('CIRCUIT BREAKER','Flash crash on BTC');
      appState.pausedUntil = Date.now() + 30*60000;
      return;
    }

    // Trade limits
    appState.openTrades = await db.getOpenTrades();
    const settings      = await db.getSettings();
    if (appState.openTrades.length >= (settings.max_concurrent_trades||3)) return;

    const todayTrades = await db.getTodayTrades();
    if (todayTrades.length >= (settings.max_daily_trades||15)) return;

    // Balance check before scanning
    try {
      const balInfo = await bingx.getBalance();
      if (balInfo.available < 1) {
        logger.warn('LOOP','Balance too low to trade');
        await dash.sendBalanceAlert(balInfo.available, balInfo.mode);
        return;
      }
    } catch (e) {
      logger.error('LOOP',`Balance check: ${e.message}`);
    }

    // SCAN
    if (appState.scanMode === 'OFF') return;

    const topSymbols = await bingx.getTopSymbols(30);
    const { top3, best } = await scorer.rankCandidates(topSymbols.slice(0,20));
    appState.top3 = top3;

    // Save top signals
    for (const sig of top3) {
      await db.saveSignal({
        symbol: sig.symbol, total_score: sig.score,
        decision: sig.decision, direction: sig.direction,
        entry_price: sig.entry, stop_loss: sig.sl,
        tp1: sig.tp1, tp2: sig.tp2, leverage: sig.leverage,
        reject_reason: sig.reject_reason,
        gemini_summary: sig.summary,
        kill_zone: sig.kz?.zone
      }).catch(()=>{});
    }

    // SUGGEST mode: propose to user, don't auto-execute
    if (appState.scanMode === 'SUGGEST' && best) {
      const existing = await db.getPendingSuggestions();
      const alreadyExists = existing.some(s=>s.symbol===best.symbol);
      if (!alreadyExists) {
        const sug = await db.saveSuggestion({
          symbol: best.symbol, score: best.score,
          direction: best.direction, entry_price: best.entry,
          stop_loss: best.sl, tp1: best.tp1, tp2: best.tp2,
          leverage: best.leverage, summary: best.summary,
          confidence: best.confidence, status:'PENDING'
        });
        const { suggestionKB } = require('./handlers/commands');
        await dash.send(
`💡 <b>اقتراح جديد</b>

${best.direction==='LONG'?'🟢 LONG':'🔴 SHORT'} <b>${best.symbol}</b>
📊 Score: <b>${best.score}</b>  ⚡ x${best.leverage}
${best.confidence==='HIGH'?'🔥':'⚠️'} ${best.confidence}

📍 $${best.entry?.toFixed(4)||'?'}  🛑 $${best.sl?.toFixed(4)||'?'}
🎯 TP1: $${best.tp1?.toFixed(4)||'?'}

📝 ${best.summary}`,
          suggestionKB(sug.id));
      }
      return;
    }

    // AUTO mode: execute best opportunity
    if (appState.scanMode === 'AUTO' && best) {
      const trade = await openTrade(best, appState.session, appState.compound);
      appState.openTrades.push(trade);
    }

    // Update stats
    await updateStats();

  } catch (e) {
    logger.error('MAIN_LOOP', e.message);
    await db.saveError('MAIN_LOOP','SYSTEM',e.message);
  }
}

// ─── MONITOR LOOP (every 10s) ────────────────────────────────
async function monitorLoop() {
  if (!appState.running) return;
  try {
    await monitorAll(MT.getAllPrices());
    appState.openTrades = await db.getOpenTrades();
  } catch (e) {
    logger.error('MONITOR', e.message);
  }
}

// ─── OI + FUNDING REFRESH (every 2min) ───────────────────────
async function refreshMarketData() {
  const symbols = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'];
  for (const s of symbols) {
    try {
      const [oi, fund] = await Promise.all([bingx.getOI(s), bingx.getFunding(s)]);
      MT.setOI(s, oi);
      MT.setFunding(s, fund.fundingRate);
    } catch {}
  }
}

// ─── UPDATE STATS ────────────────────────────────────────────
async function updateStats() {
  try {
    const today  = await db.getTodayTrades();
    const closed = today.filter(t=>t.status==='CLOSED');
    const wins   = closed.filter(t=>(t.pnl_after_fees||0)>0);
    const pnl    = closed.reduce((s,t)=>s+(t.pnl||0),0);
    const fees   = closed.reduce((s,t)=>s+(t.total_fees||0),0);
    await db.upsertStats({
      mode: process.env.BOT_MODE||'PAPER',
      total_trades: closed.length,
      winning_trades: wins.length,
      losing_trades: closed.length-wins.length,
      win_rate: closed.length>0?(wins.length/closed.length)*100:0,
      total_pnl: pnl, total_fees: fees, net_pnl: pnl-fees,
      best_trade_pnl:  closed.length?Math.max(...closed.map(t=>t.pnl_after_fees||0)):0,
      worst_trade_pnl: closed.length?Math.min(...closed.map(t=>t.pnl_after_fees||0)):0
    });
    if (appState.session) {
      const bal = appState.compound?.balance || +appState.session.start_capital;
      appState.session = await db.updateSession(appState.session.id,{
        total_pnl:pnl, total_fees:fees, net_pnl:pnl-fees,
        total_trades:closed.length, winning_trades:wins.length,
        current_balance:parseFloat(bal.toFixed(4)),
        daily_high:parseFloat((appState.compound?.high||bal).toFixed(4))
      });
    }
    if (appState.compound && closed.length>0) {
      const last = closed.at(-1);
      const lastTs = new Date(last.closed_at||0).getTime();
      if (Date.now()-lastTs<35000) {
        appState.compound.update(last.pnl_after_fees||0);
      }
    }
  } catch (e) { logger.warn('STATS',e.message); }
}

// ─── DAILY SUGGESTION SCAN (every hour) ─────────────────────
async function dailySuggestionScan() {
  logger.info('SUGGEST','Running hourly suggestion scan...');
  try {
    const topSymbols = await bingx.getTopSymbols(20);
    const { top3 }   = await scorer.rankCandidates(topSymbols.slice(0,15));
    for (const sig of top3.filter(s=>s.decision==='APPROVE'&&s.score>=75)) {
      await db.saveSuggestion({
        symbol:sig.symbol, score:sig.score,
        direction:sig.direction, entry_price:sig.entry,
        stop_loss:sig.sl, tp1:sig.tp1, tp2:sig.tp2,
        leverage:sig.leverage, summary:sig.summary,
        confidence:sig.confidence, status:'PENDING'
      });
    }
    if (top3.some(s=>s.decision==='APPROVE')) {
      logger.info('SUGGEST',`Found ${top3.filter(s=>s.decision==='APPROVE').length} suggestion(s)`);
    }
  } catch (e) { logger.error('SUGGEST',e.message); }
}

// ─── WEBSOCKET SETUP ─────────────────────────────────────────
function startWSS() {
  appState.wss = wss;

  // Price feed → MarketTracker
  wss.onPrice(tick => { MT.setPrice(tick.symbol, tick.price); });

  // Liquidations
  wss.onLiquidation(liq => { if(liq.symbol && liq.value) MT.addLiquidation(liq.symbol, liq.value); });

  // Account order updates (real/demo mode)
  wss.onOrderUpdate(async data => {
    logger.info('ACCOUNT', `Order update: ${JSON.stringify(data).substring(0,100)}`);
  });

  const symbols = ['btcusdt','ethusdt','solusdt','bnbusdt','xrpusdt'];
  wss.connectMarket(symbols);

  // Account channel (only if API keys set)
  if (process.env.BINGX_API_KEY && process.env.BINGX_API_KEY !== 'your_bingx_api_key_here') {
    wss.connectAccount();
  } else {
    logger.warn('WSS','No BingX API keys — account channel skipped');
  }

  logger.info('WSS',`Market channel connecting (${symbols.length} pairs)`);
}

// ─── CRON JOBS ───────────────────────────────────────────────
function setupCrons() {
  // Midnight reset
  cron.schedule('0 0 * * *', async () => {
    logger.info('CRON','Midnight reset');
    const prevSession = await db.getTodaySession();
    await stopBot();
    if (prevSession) {
      const stats = (await db.getDailyStats(1))[0]||{};
      await dash.sendDailyReport(prevSession, stats);
    }
    await dash.send('🌙 <b>انتهى اليوم</b>\n/start_day لبدء يوم جديد.');
  }, { timezone:'UTC' });

  // Hourly suggestions
  cron.schedule('0 * * * *', dailySuggestionScan);

  // Expire old suggestions (> 4 hours)
  cron.schedule('*/30 * * * *', async () => {
    const cutoff = new Date(Date.now() - 4*3600000).toISOString();
    await db.updateSuggestion('expired_cleanup',{status:'EXPIRED'});
  });
}

// ─── GLOBAL ERROR HANDLERS ───────────────────────────────────
process.on('uncaughtException', async e => {
  logger.error('CRASH', e.message, { stack:e.stack?.substring(0,300) });
  await dash.sendError('CRASH', e.message).catch(()=>{});
});
process.on('unhandledRejection', async r => {
  const msg = r instanceof Error ? r.message : String(r);
  logger.error('REJECTION', msg);
  await db.saveError('REJECTION','SYSTEM',msg).catch(()=>{});
});

// ─── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔════════════════════════════════╗');
  console.log('║    AXOM Trading Bot v3.0        ║');
  console.log('║    ICT/SMC Elite System         ║');
  console.log('║    WSS-First Architecture       ║');
  console.log('╚════════════════════════════════╝');
  console.log('');

  try {
    // Init logger (without DB initially)
    logger.init(null, null);

    // Test DB
    await db.getSettings();
    logger.info('DB','Connected ✅');

    // Init AI
    scorer.initGemini();
    logger.info('AI','Gemini initialized ✅');

    // Init Telegram
    const bot = new TgBot(process.env.TELEGRAM_BOT_TOKEN, { polling:true });
    const cid = process.env.TELEGRAM_CHAT_ID;
    dash.init(bot, cid);
    dash.setStateRef(appState);
    dash.resetDashMsg();

    // Init logger with telegram
    logger.init({ saveLog: db.saveLog, saveError: db.saveError }, dash.send);

    // Register commands
    register(bot, startBot, stopBot);
    logger.info('TG','Bot commands registered ✅');

    // Start WSS
    startWSS();

    // Initial market data
    await refreshMarketData();
    logger.info('MARKET','Initial data loaded ✅');

    // Setup crons
    setupCrons();
    logger.info('CRON','Scheduled tasks active ✅');

    // Start loops
    setInterval(mainLoop,    30000);  // scan every 30s
    setInterval(monitorLoop, 10000);  // monitor every 10s
    setInterval(refreshMarketData, 120000); // OI/funding every 2min
    setInterval(() => dash.update(), 1500); // dashboard every 1.5s

    console.log('');
    logger.info('AXOM','✅ Ready! Send /start in Telegram.');
    console.log('');

    await dash.send(`🟢 <b>AXOM v3 Online!</b>

النظام جاهز.
/start_day لبدء التداول.

⏰ ${new Date().toLocaleString('ar-SA')}`);

  } catch (e) {
    console.error('❌ Startup failed:', e.message);
    process.exit(1);
  }
}

// Expose scanMode control
global.setScanMode = m => { appState.scanMode = m; };

main();
