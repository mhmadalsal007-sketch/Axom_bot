// ============================================================
// AXOM v3 — Telegram Commands & Handlers
// Professional grid keyboard, full command set
// ============================================================
const db    = require('../core/database');
const dash  = require('../core/dashboard');
const G     = require('../core/gemini');
const KB    = require('./keyboards');
const MT    = require('../core/marketTracker');
const bingx = require('../core/bingx');
const { closeAll } = require('../trading/executor');

const SEP  = '━━━━━━━━━━━━━━━━━━━━━━';
const SEP2 = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

// ─── USER STATE (multi-step flows) ────────────────────────────
const userState = {};
const setState  = (id, s) => { userState[id] = { ...userState[id], ...s }; };
const getState  = id => userState[id] || {};
const clearState= id => { delete userState[id]; };

let _start, _stop;

// ─── MODE HELPERS ─────────────────────────────────────────────
function _modeLabel() {
  const m = process.env.BOT_MODE || 'PAPER';
  return m === 'REAL' ? '💰 حقيقي' : m === 'DEMO' ? '🎮 ديمو BingX' : '📝 تجريبي';
}
function _modeFlag() {
  const m = process.env.BOT_MODE || 'PAPER';
  return m === 'REAL' ? '🔴' : m === 'DEMO' ? '🟡' : '🔵';
}

// ─── CONFIRM TEXT ─────────────────────────────────────────────
function _confirmText(cap, stp) {
  const stopAmt = (cap * stp / 100).toFixed(2);
  return `${SEP2}
✅ <b>تأكيد بدء التداول</b>
${SEP2}
💵 رأس المال:   <b>$${cap}</b>
🛑 حد الخسارة: <b>${stp}%</b>  =  <b>$${stopAmt}</b>
${_modeFlag()} الوضع: <b>${_modeLabel()}</b>

<i>هل تريد البدء؟</i>`;
}

// ─── MAIN REGISTER ────────────────────────────────────────────
function register(bot, startFn, stopFn) {
  _start = startFn;
  _stop  = stopFn;

  // /start — welcome screen
  bot.onText(/\/start$/, async msg => {
    process.env.TELEGRAM_CHAT_ID = msg.chat.id.toString();
    clearState(msg.chat.id);
    await dash.send(
`╔══════════════════════╗
║  🤖 <b>AXOM Trading Bot</b>    ║
║  Elite ICT/SMC v3.0  ║
╚══════════════════════╝

مرحباً بك في <b>AXOM</b>! 👋
نظام تداول ذكي يعتمد على ICT/SMC
مدعوم بالذكاء الاصطناعي Gemini

${_modeFlag()} الوضع الحالي: <b>${_modeLabel()}</b>

اختر من القائمة أدناه 👇`, KB.mainMenu);
  });

  // /start_day
  bot.onText(/\/start_day/, async msg => _startDayFlow(bot, msg.chat.id));

  // /status
  bot.onText(/\/status/, async msg => _showStatus(bot, msg.chat.id));

  // /trades
  bot.onText(/\/trades/, async msg => _showTrades(bot, msg.chat.id));

  // /stats
  bot.onText(/\/stats/, async msg => _showStats(bot, msg.chat.id));

  // /suggestions
  bot.onText(/\/suggestions/, async msg => _showSuggestions(bot, msg.chat.id));

  // /market
  bot.onText(/\/market/, async msg => _showMarket(bot, msg.chat.id));

  // /mode
  bot.onText(/\/mode/, async msg =>
    bot.sendMessage(msg.chat.id, '⚙️ اختر وضع التشغيل:', KB.modeKB));

  // /scanmode
  bot.onText(/\/scanmode/, async msg =>
    bot.sendMessage(msg.chat.id, '🔍 اختر وضع الفحص:', KB.scanModeKB));

  // /scan — manual scan trigger
  bot.onText(/\/scan/, async msg => {
    await bot.sendMessage(msg.chat.id, '🔍 <b>بدء فحص يدوي...</b>\nسيستغرق 30-60 ثانية.', { parse_mode:'HTML' });
    const topSymbols = await bingx.getTopSymbols(20).catch(() => []);
    if (!topSymbols.length) return bot.sendMessage(msg.chat.id, '❌ فشل جلب الرموز.');
    const scorer = require('../brain/scorer');
    const { top3, best } = await scorer.rankCandidates(topSymbols.slice(0, 10));
    if (!top3.length) return bot.sendMessage(msg.chat.id, '⚠️ لا توجد فرص الآن.');
    let txt = `${SEP2}\n🔍 <b>نتائج الفحص اليدوي</b>\n${SEP2}\n`;
    top3.forEach((t, i) => {
      const rank = ['🥇','🥈','🥉'][i];
      const dir  = t.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
      txt += `${rank} <b>${t.symbol}</b>  ${dir}  Score: <b>${t.score}</b>\n`;
      txt += `   ${t.decision === 'APPROVE' ? '✅' : '❌'} ${t.summary || t.reject_reason || ''}\n\n`;
    });
    await bot.sendMessage(msg.chat.id, txt, { parse_mode:'HTML' });
  });

  // /stop
  bot.onText(/\/stop$/, async msg =>
    bot.sendMessage(msg.chat.id, '🛑 إيقاف البوت؟', KB.confirmStopKB));

  // /close_all
  bot.onText(/\/close_all/, async msg =>
    bot.sendMessage(msg.chat.id, '⚠️ <b>إغلاق طارئ لكل الصفقات؟</b>', { parse_mode:'HTML', ...KB.emergencyKB }));

  // /help
  bot.onText(/\/help/, async msg => _showHelp(bot, msg.chat.id));

  // /settings
  bot.onText(/\/settings/, async msg => _showSettings(bot, msg.chat.id));

  // /ai
  bot.onText(/\/ai/, async msg =>
    bot.sendMessage(msg.chat.id, '🧠 <b>وضع الذكاء الصناعي</b>\nاختر:', { parse_mode:'HTML', ...KB.aiModeKB }));

  // /cache — RAM cache stats
  bot.onText(/\/cache/, async msg => {
    try {
      const cache = require('../core/ramCache');
      const s = cache.getStats();
      await bot.sendMessage(msg.chat.id,
`📊 <b>RAM Cache Stats</b>
${SEP}
🗂️ رموز مُتتبَّعة: <b>${s.symbols}</b>
📦 مدخلات الكاش: <b>${s.entries}</b>
✅ Cache Hits:    <b>${s.hits}</b>
❌ Cache Misses:  <b>${s.misses}</b>
🎯 Hit Rate:      <b>${s.hitRate}</b>
🔄 تحديثات:      <b>${s.refreshes}</b>
💾 RAM مُستخدم:  <b>${s.memKB} KB</b>`, { parse_mode:'HTML' });
    } catch { await bot.sendMessage(msg.chat.id, '❌ Cache غير متاح'); }
  });

  // ─── REPLY KEYBOARD BUTTONS ────────────────────────────────
  bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const cid   = msg.chat.id;
    const txt   = msg.text.trim();
    const state = getState(cid);

    // Main grid buttons
    if (txt === '📊 الحالة')         return _showStatus(bot, cid);
    if (txt === '🚀 بدء يوم')        return _startDayFlow(bot, cid);
    if (txt === '🔄 صفقاتي')         return _showTrades(bot, cid);
    if (txt === '💡 اقتراحات')       return _showSuggestions(bot, cid);
    if (txt === '📈 تحليل السوق')    return _showMarket(bot, cid);
    if (txt === '📉 إحصائياتي')     return _showStats(bot, cid);
    if (txt === '⚙️ الإعدادات')     return _showSettings(bot, cid);
    if (txt === '🧠 وضع الذكاء')    return bot.sendMessage(cid, '🧠 <b>وضع الذكاء الصناعي</b>', { parse_mode:'HTML', ...KB.aiModeKB });
    if (txt === '🆘 الدعم')          return _showHelp(bot, cid);

    // Multi-step: capital input
    if (state.step === 'custom_cap') {
      const n = parseFloat(txt);
      if (isNaN(n) || n < 5)
        return bot.sendMessage(cid, '❌ الحد الأدنى $5. أرسل مبلغاً صحيحاً:');
      setState(cid, { step:'pick_stop', capital:n });
      return bot.sendMessage(cid, `💰 رأس المال: <b>$${n}</b>\nاختر نسبة Stop Loss اليومية:`, { parse_mode:'HTML', ...KB.stopKB() });
    }

    // Multi-step: stop % input
    if (state.step === 'custom_stop') {
      const n = parseFloat(txt);
      if (isNaN(n) || n < 5 || n > 95)
        return bot.sendMessage(cid, '❌ النسبة بين 5 و95. أرسل من جديد:');
      setState(cid, { step:'confirm', stop:n });
      return bot.sendMessage(cid, _confirmText(state.capital, n), KB.confirmKB(state.capital, n));
    }

    // AI Chat (free text)
    await _chatAI(bot, cid, txt);
  });

  // ─── CALLBACK QUERIES ──────────────────────────────────────
  bot.on('callback_query', async q => {
    const cid  = q.message.chat.id;
    const mid  = q.message.message_id;
    const data = q.data;
    await bot.answerCallbackQuery(q.id).catch(() => {});

    // Capital selection
    if (data.startsWith('cap_')) {
      const val = data.slice(4);
      if (val === 'custom') {
        setState(cid, { step:'custom_cap' });
        return bot.editMessageText('✏️ أرسل المبلغ بالدولار (الحد الأدنى $5):', { chat_id:cid, message_id:mid });
      }
      const cap = parseFloat(val);
      setState(cid, { step:'pick_stop', capital:cap });
      return bot.editMessageText(
        `💰 رأس المال: <b>$${cap}</b>\nاختر نسبة Stop Loss:`,
        { chat_id:cid, message_id:mid, parse_mode:'HTML', ...KB.stopKB() }
      );
    }

    // Stop % selection
    if (data.startsWith('stp_')) {
      const state = getState(cid);
      const cap   = state.capital || 10;
      const val   = data.slice(4);
      if (val === 'custom') {
        setState(cid, { step:'custom_stop' });
        return bot.editMessageText('✏️ أرسل نسبة Stop Loss (5–95):', { chat_id:cid, message_id:mid });
      }
      const stp = parseFloat(val);
      setState(cid, { step:'confirm', stop:stp });
      await bot.deleteMessage(cid, mid).catch(() => {});
      return bot.sendMessage(cid, _confirmText(cap, stp), KB.confirmKB(cap, stp));
    }

    // Confirm start
    if (data.startsWith('confirm_')) {
      const parts = data.split('_');
      if (parts[1] === 'real') {
        process.env.BOT_MODE = 'REAL';
        await db.updateSettings({ mode:'REAL' });
        return bot.editMessageText('✅ <b>الوضع الحقيقي مُفعَّل</b> 💰', { chat_id:cid, message_id:mid, parse_mode:'HTML' });
      }
      const cap = parseFloat(parts[1]);
      const stp = parseFloat(parts[2]);
      clearState(cid);
      await bot.editMessageText('⏳ <b>جارٍ تشغيل AXOM...</b>', { chat_id:cid, message_id:mid, parse_mode:'HTML' }).catch(() => {});
      return _start(cap, stp);
    }

    // Mode selection
    if (data.startsWith('mode_')) {
      const m = data.slice(5);
      if (m === 'REAL') {
        return bot.editMessageText(
          '⚠️ <b>تحذير!</b>\nالوضع الحقيقي يستخدم أموالك الفعلية!\nهل أنت متأكد؟',
          { chat_id:cid, message_id:mid, parse_mode:'HTML', ...KB.confirmRealKB }
        );
      }
      process.env.BOT_MODE = m;
      await db.updateSettings({ mode:m });
      return bot.editMessageText(`✅ الوضع: <b>${m === 'DEMO' ? '🎮 ديمو BingX' : '📝 تجريبي'}</b>`, { chat_id:cid, message_id:mid, parse_mode:'HTML' });
    }

    // Scan mode
    if (data.startsWith('scanmode_')) {
      const m = data.slice(9);
      global.setScanMode && global.setScanMode(m);
      const labels = { AUTO:'🤖 تلقائي', SUGGEST:'💡 اقتراح فقط', OFF:'⏸️ مغلق' };
      return bot.editMessageText(`✅ وضع الفحص: <b>${labels[m] || m}</b>`, { chat_id:cid, message_id:mid, parse_mode:'HTML' });
    }

    // Suggestions
    if (data.startsWith('sug_approve_')) return _approveSuggestion(bot, cid, mid, data.slice(12));
    if (data.startsWith('sug_reject_')) {
      await db.updateSuggestion(data.slice(11), { status:'REJECTED', resolved_at:new Date().toISOString() });
      return bot.editMessageText('❌ تم رفض الاقتراح.', { chat_id:cid, message_id:mid });
    }

    // Stats period
    if (data.startsWith('stats_')) return _showStatsPeriod(bot, cid, mid, data.slice(6));

    // AI callbacks
    if (data === 'ai_scan')   return bot.sendMessage(cid, '🔍 استخدم /scan لبدء فحص يدوي.');
    if (data === 'ai_report') return _showStats(bot, cid);
    if (data === 'ai_chat')   return bot.sendMessage(cid, '💬 <b>اكتب سؤالك مباشرة</b> وسيجيبك الذكاء الصناعي:', { parse_mode:'HTML' });

    // Controls
    if (data === 'continue_trading') { await _start(null, null, true); return bot.editMessageText('▶️ استمر في التداول!', { chat_id:cid, message_id:mid }); }
    if (data === 'stop_trading')     { await _stop(); return bot.editMessageText('🔒 موقوف. ربحك محمي.', { chat_id:cid, message_id:mid }); }
    if (data === 'emergency_close')  { await bot.editMessageText('⏳ إغلاق كل الصفقات...', { chat_id:cid, message_id:mid }); return closeAll('EMERGENCY'); }
    if (data === 'confirm_stop')     { await _stop(); return bot.editMessageText('🛑 موقوف. /start_day لاحقاً.', { chat_id:cid, message_id:mid }); }
    if (data === 'cancel')           { clearState(cid); return bot.editMessageText('❌ تم الإلغاء.', { chat_id:cid, message_id:mid }); }
    if (data === 'change_settings')  return bot.editMessageText('💰 اختر رأس المال:', { chat_id:cid, message_id:mid, ...KB.capitalKB });
    if (data === 'refresh_dash')     { /* auto-refreshes */ }
  });
}

// ─── FLOWS ────────────────────────────────────────────────────

async function _startDayFlow(bot, cid) {
  clearState(cid);
  setState(cid, { step:'pick_cap' });
  await bot.sendMessage(cid,
`${SEP2}
🚀 <b>بدء يوم تداول جديد</b>
${SEP2}
${_modeFlag()} الوضع: <b>${_modeLabel()}</b>

💵 كم رأس المال لهذا اليوم؟`,
    { parse_mode:'HTML', ...KB.capitalKB });
}

async function _showStatus(bot, cid) {
  try {
    const session = await db.getActiveSession();
    const open    = await db.getOpenTrades();
    const settings= await db.getSettings();
    const balInfo = await bingx.getBalance().catch(() => null);

    if (!session) {
      return bot.sendMessage(cid,
`📊 <b>الحالة الحالية</b>
${SEP}
💤 لا توجد جلسة نشطة.
${_modeFlag()} الوضع: <b>${_modeLabel()}</b>
👉 اضغط <b>🚀 بدء يوم</b> للبدء.`, { parse_mode:'HTML', ...KB.mainMenu });
    }

    const pnl = +(session.net_pnl || 0);
    let txt =
`${SEP2}
📊 <b>الحالة الحالية</b>
${SEP2}
${_modeFlag()} <b>${_modeLabel()}</b>

💵 رأس المال:   <b>$${(+session.start_capital).toFixed(2)}</b>
💰 الرصيد:      <b>$${(+session.current_balance).toFixed(4)}</b>
📈 أعلى اليوم:  <b>$${(+session.daily_high).toFixed(4)}</b>
🛑 حد الخسارة:  <b>$${(+session.daily_stop_amount).toFixed(2)}</b>
${pnl >= 0 ? '📈 +' : '📉 '}PnL: <b>$${Math.abs(pnl).toFixed(4)}</b>

📊 صفقات اليوم: <b>${session.total_trades || 0}</b>
🔄 مفتوحة الآن: <b>${open.length}</b>
🔍 وضع الفحص:   <b>${global.getCurrentScanMode ? global.getCurrentScanMode() : 'AUTO'}</b>
`;
    if (balInfo) {
      txt += `\n💳 رصيد BingX: <b>$${(+balInfo.available).toFixed(4)}</b>`;
    }

    await bot.sendMessage(cid, txt, { parse_mode:'HTML' });
  } catch (e) {
    await dash.sendError('Status', e.message);
  }
}

async function _showTrades(bot, cid) {
  try {
    const open   = await db.getOpenTrades();
    const recent = await db.getRecentTrades(5);

    let txt = `${SEP2}\n🔄 <b>الصفقات</b>\n${SEP2}\n`;

    if (open.length) {
      txt += `\n🟢 <b>مفتوحة (${open.length})</b>\n${SEP}\n`;
      open.forEach(t => {
        const cur  = MT.getPrice(t.symbol) || +t.current_price;
        const long = t.direction === 'LONG';
        const uPnl = cur ? (long ? cur - t.entry_price : t.entry_price - cur) * (t.position_size || 1) : 0;
        txt += `${long ? '🟢' : '🔴'} <b>${t.symbol}</b> ×${t.leverage}  ${t.tp1_hit ? '✅TP1 ' : ''}${t.tp2_hit ? '✅TP2' : ''}\n`;
        txt += `   📍$${(+t.entry_price).toFixed(4)}  uPnL: <b>${uPnl >= 0 ? '+' : ''}$${uPnl.toFixed(4)}</b>\n`;
      });
    } else {
      txt += '\n💤 لا توجد صفقات مفتوحة.\n';
    }

    if (recent.length) {
      txt += `\n📋 <b>آخر 5 صفقات مغلقة</b>\n${SEP}\n`;
      recent.forEach(t => {
        const pnl = +(t.pnl_after_fees || 0);
        txt += `${pnl >= 0 ? '✅' : '❌'} <b>${t.symbol}</b>  ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}  (${t.close_reason || '-'})\n`;
      });
    }

    await bot.sendMessage(cid, txt, { parse_mode:'HTML' });
  } catch (e) { await dash.sendError('Trades', e.message); }
}

async function _showStats(bot, cid) {
  await bot.sendMessage(cid, '📉 <b>اختر الفترة:</b>', { parse_mode:'HTML', ...KB.statsKB });
}

async function _showStatsPeriod(bot, cid, mid, period) {
  try {
    const n = period === 'today' ? 1 : period === 'week' ? 7 : 30;
    const stats = await db.getDailyStats(n);
    if (!stats.length) return bot.editMessageText('⚠️ لا توجد بيانات بعد.', { chat_id:cid, message_id:mid });

    const tot = stats.reduce((s, d) => ({
      trades: s.trades + (d.total_trades || 0),
      wins:   s.wins   + (d.winning_trades || 0),
      pnl:    s.pnl    + (d.net_pnl || 0),
      fees:   s.fees   + (d.total_fees || 0),
    }), { trades:0, wins:0, pnl:0, fees:0 });

    const wr  = tot.trades > 0 ? ((tot.wins / tot.trades) * 100).toFixed(1) : '0.0';
    const title = period === 'today' ? 'اليوم' : period === 'week' ? 'الأسبوع' : 'كل الوقت';

    await bot.editMessageText(
`${SEP2}
📉 <b>إحصائيات ${title}</b>
${SEP2}
📊 صفقات:      <b>${tot.trades}</b>
✅ فائزة:      <b>${tot.wins}</b>
❌ خاسرة:     <b>${tot.trades - tot.wins}</b>
🎯 معدل الفوز: <b>${wr}%</b>
${tot.pnl >= 0 ? '📈 +' : '📉 '}<b>$${Math.abs(tot.pnl).toFixed(4)}</b>  PnL
💳 الرسوم:    <b>$${tot.fees.toFixed(4)}</b>`,
      { chat_id:cid, message_id:mid, parse_mode:'HTML' }
    );
  } catch (e) { await dash.sendError('Stats', e.message); }
}

async function _showSuggestions(bot, cid) {
  try {
    const sugs = await db.getPendingSuggestions();
    if (!sugs.length) return bot.sendMessage(cid, '💤 <b>لا توجد اقتراحات معلقة الآن.</b>', { parse_mode:'HTML' });

    for (const s of sugs.slice(0, 3)) {
      const dir = s.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
      await bot.sendMessage(cid,
`${SEP2}
💡 <b>اقتراح تداول</b>
${SEP2}
${dir}  <b>${s.symbol}</b>
📊 Score: <b>${s.score}</b>  ${s.confidence === 'HIGH' ? '🔥 عالي' : '⚠️ متوسط'}

📍 الدخول:   <b>$${(+s.entry_price).toFixed(4)}</b>
🛑 Stop:     <b>$${(+s.stop_loss).toFixed(4)}</b>
🎯 TP1:      <b>$${(+s.tp1).toFixed(4)}</b>

📝 ${s.summary || 'تحليل ICT/SMC'}`,
        KB.suggestionKB(s.id)
      );
      await bingx.sleep(300);
    }
  } catch (e) { await dash.sendError('Suggestions', e.message); }
}

async function _approveSuggestion(bot, cid, mid, id) {
  try {
    const sugs = await db.getPendingSuggestions();
    const sug  = sugs.find(s => s.id == id);
    if (!sug) return bot.editMessageText('⚠️ الاقتراح لم يعد متاحاً.', { chat_id:cid, message_id:mid });

    await db.updateSuggestion(id, { status:'APPROVED', resolved_at:new Date().toISOString() });

    const { openTrade, CompoundState } = require('../trading/executor');
    const session = await db.getActiveSession();
    if (!session) return bot.editMessageText('❌ لا توجد جلسة نشطة. ابدأ اليوم أولاً.', { chat_id:cid, message_id:mid });

    await bot.editMessageText('⏳ جارٍ فتح الصفقة...', { chat_id:cid, message_id:mid });
    const compound = new CompoundState(+session.start_capital, +session.daily_stop_amount);
    await openTrade(sug, session, compound);
  } catch (e) {
    await dash.sendError('Approve Suggestion', e.message);
  }
}

async function _showMarket(bot, cid) {
  try {
    const symbols  = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'];
    const summary  = MT.getSummary();
    const topMovers= summary.topMovers || [];
    const highLiq  = summary.highLiq   || [];

    let txt = `${SEP2}\n📈 <b>نبض السوق</b>\n${SEP2}\n\n`;

    txt += `<b>أسعار حية:</b>\n`;
    for (const sym of symbols) {
      const price = MT.getPrice(sym);
      const chg   = MT.getPriceChange(sym);
      const icon  = chg > 0 ? '📈' : chg < 0 ? '📉' : '➡️';
      if (price) txt += `${icon} <b>${sym}:</b> $${price.toFixed(2)}  (${chg >= 0 ? '+' : ''}${chg.toFixed(3)}%)\n`;
    }

    if (topMovers.length) {
      txt += `\n<b>🏃 أكثر تحركاً:</b>\n`;
      topMovers.forEach(m => txt += `• <b>${m.symbol}</b>  ${m.chg >= 0 ? '+' : ''}${m.chg.toFixed(3)}%\n`);
    }
    if (highLiq.length) {
      txt += `\n<b>💧 أعلى تصفيات:</b>\n`;
      highLiq.forEach(m => txt += `• <b>${m.symbol}</b>  $${(m.liq/1e6).toFixed(2)}M\n`);
    }

    await bot.sendMessage(cid, txt, { parse_mode:'HTML' });
  } catch (e) { await dash.sendError('Market', e.message); }
}

async function _showSettings(bot, cid) {
  try {
    const settings = await db.getSettings();
    await bot.sendMessage(cid,
`${SEP2}
⚙️ <b>الإعدادات</b>
${SEP2}
${_modeFlag()} الوضع: <b>${_modeLabel()}</b>
🔍 الفحص: <b>${global.getCurrentScanMode ? global.getCurrentScanMode() : 'AUTO'}</b>

📊 أقصى صفقات متزامنة: <b>${settings.max_concurrent_trades || 3}</b>
📅 أقصى صفقات يومياً:   <b>${settings.max_daily_trades || 15}</b>
🎯 أدنى نقاط للدخول:     <b>${settings.min_score_entry || 75}</b>

<b>تعديل:</b>`,
      {
        parse_mode:'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text:'🔄 تغيير الوضع',        callback_data:'mode_menu'    },
              { text:'🔍 وضع الفحص',          callback_data:'scanmode_menu'},
            ],
            [{ text:'💰 تغيير رأس المال',     callback_data:'change_settings' }],
          ]
        }
      }
    );
  } catch (e) { await dash.sendError('Settings', e.message); }
}

async function _showHelp(bot, cid) {
  await bot.sendMessage(cid,
`${SEP2}
🆘 <b>مساعدة AXOM</b>
${SEP2}

<b>الأوامر الرئيسية:</b>
/start       — الشاشة الرئيسية
/start_day   — بدء يوم تداول جديد
/status      — الحالة الحالية
/trades      — صفقاتي
/stats       — الإحصائيات
/scan        — فحص يدوي للسوق
/suggestions — الاقتراحات المعلقة
/market      — نبض السوق
/ai          — وضع الذكاء الصناعي
/settings    — الإعدادات
/mode        — تغيير وضع التشغيل
/scanmode    — وضع الفحص
/close_all   — إغلاق طارئ
/stop        — إيقاف البوت
/cache       — إحصائيات RAM

<b>الأوضاع:</b>
📝 PAPER  — تجريبي (محاكاة)
🎮 DEMO   — ديمو BingX (VST حقيقي)
💰 REAL   — تداول حقيقي

<b>وضع الفحص:</b>
🤖 AUTO    — يفتح تلقائياً
💡 SUGGEST — يقترح فقط
⏸️ OFF    — متوقف

<i>للتواصل أو الاستفسار اكتب مباشرة.</i>`,
    { parse_mode:'HTML' }
  );
}

async function _chatAI(bot, cid, text) {
  try {
    const session = await db.getActiveSession().catch(() => null);
    const open    = await db.getOpenTrades().catch(() => []);
    const ctx     = {
      mode:    process.env.BOT_MODE || 'PAPER',
      running: !!session,
      balance: session?.current_balance || 0,
      trades:  open.length,
      scan:    global.getCurrentScanMode ? global.getCurrentScanMode() : 'AUTO',
    };
    const reply = await G.chatReply(text, ctx);
    await bot.sendMessage(cid, `🧠 <b>AXOM AI:</b>\n${reply}`, { parse_mode:'HTML' });
    await db.saveChat('user', text, ctx).catch(() => {});
    await db.saveChat('assistant', reply).catch(() => {});
  } catch (e) {
    await bot.sendMessage(cid, '⚠️ خطأ مؤقت في الذكاء الصناعي.');
  }
}

// Export suggestionKB for use in index.js
function suggestionKB(id) { return KB.suggestionKB(id); }

module.exports = { register, suggestionKB };
