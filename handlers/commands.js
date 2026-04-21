// ============================================================
// AXOM — Complete Command Handlers with Button System
// ============================================================
const db = require('../core/database');
const tg = require('../core/telegram');
const G = require('../core/gemini');
const { closeAll } = require('../trading/executor');
const KB = require('./keyboards');

const userState = {};
function setState(id, s) { userState[id] = s; }
function getState(id)    { return userState[id] || {}; }
function clearState(id)  { delete userState[id]; }

let _startBot, _stopBot;

function register(bot, startFn, stopFn) {
  _startBot = startFn;
  _stopBot  = stopFn;

  // /start
  bot.onText(/\/start$/, async msg => {
    const chatId = msg.chat.id;
    process.env.TELEGRAM_CHAT_ID = chatId.toString();
    clearState(chatId);
    await bot.sendMessage(chatId,
`╔═══════════════════════╗
║    🤖 AXOM Trading Bot  ║
║    Elite ICT/SMC System ║
╚═══════════════════════╝

مرحباً! أنا <b>AXOM</b> — نظام تداول ذكي 24/7
يحلل السوق بمنهج ICT/SMC ويصطاد الفرص

الوضع: ${process.env.BOT_MODE === 'REAL' ? '💰 حقيقي' : '📝 تجريبي'}

اختر من القائمة 👇`,
      { parse_mode: 'HTML', ...KB.mainMenu });
  });

  // Text buttons
  bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const text   = msg.text;

    if (text === '🚀 بدء يوم جديد') return startDayFlow(bot, chatId);
    if (text === '📡 الحالة')        return showStatus(bot, chatId);
    if (text === '🔄 الصفقات')       return showTrades(bot, chatId);
    if (text === '📊 الإحصائيات')    return bot.sendMessage(chatId, '📊 اختر الفترة:', KB.statsPeriodMenu);
    if (text === '🔍 فرص السوق')     return showMarket(bot, chatId);
    if (text === '📈 الأداء')        return showPerformance(bot, chatId);
    if (text === '⚙️ الإعدادات')     return showSettings(bot, chatId);
    if (text === '🆘 مساعدة')        return showHelp(bot, chatId);

    // Multi-step: custom capital
    const state = getState(chatId);
    if (state.step === 'custom_capital') {
      const n = parseFloat(text);
      if (isNaN(n) || n < 5) return bot.sendMessage(chatId, '❌ أدخل مبلغاً صحيحاً (الحد الأدنى $5):');
      setState(chatId, { step: 'pick_stop', capital: n });
      return bot.sendMessage(chatId,
        `💰 رأس المال: <b>$${n}</b>\n\nاختر نسبة الـ Daily Stop:`,
        { parse_mode: 'HTML', ...KB.stopMenu(n) });
    }
    if (state.step === 'custom_stop') {
      const n = parseFloat(text);
      if (isNaN(n) || n < 5 || n > 95) return bot.sendMessage(chatId, '❌ النسبة بين 5 و 95:');
      setState(chatId, { step: 'confirm', capital: state.capital, stop: n });
      return showConfirm(bot, chatId, state.capital, n);
    }

    // AI chat
    await chatAI(bot, chatId, text);
  });

  // Callback queries
  bot.on('callback_query', async query => {
    const chatId = query.message.chat.id;
    const msgId  = query.message.message_id;
    const data   = query.data;
    await bot.answerCallbackQuery(query.id);

    // Capital pick
    if (data.startsWith('capital_')) {
      const val = data.slice(8);
      if (val === 'custom') {
        setState(chatId, { step: 'custom_capital' });
        return bot.editMessageText('✏️ أرسل المبلغ بالدولار (مثال: 15):', { chat_id: chatId, message_id: msgId });
      }
      const capital = parseFloat(val);
      setState(chatId, { step: 'pick_stop', capital });
      return bot.editMessageText(
        `💰 رأس المال: <b>$${capital}</b>\n\nاختر نسبة الـ Daily Stop:`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...KB.stopMenu(capital) });
    }

    // Stop pick
    if (data.startsWith('stop_')) {
      const state   = getState(chatId);
      const capital = state.capital || 10;
      const val     = data.slice(5);
      if (val === 'custom') {
        setState(chatId, { ...state, step: 'custom_stop' });
        return bot.editMessageText('✏️ أرسل نسبة الـ Stop (مثال: 65):', { chat_id: chatId, message_id: msgId });
      }
      const stop = parseFloat(val);
      setState(chatId, { step: 'confirm', capital, stop });
      await bot.deleteMessage(chatId, msgId).catch(() => {});
      return showConfirm(bot, chatId, capital, stop);
    }

    // Confirm start
    if (data.startsWith('confirm_start_')) {
      const [,,cap, stp] = data.split('_');
      clearState(chatId);
      await bot.editMessageText('⏳ جارٍ تشغيل AXOM...', { chat_id: chatId, message_id: msgId }).catch(() => {});
      return _startBot(parseFloat(cap), parseFloat(stp));
    }

    if (data === 'change_settings') {
      return bot.editMessageText('💰 اختر رأس المال:', { chat_id: chatId, message_id: msgId, ...KB.startDayMenu });
    }

    // Mode
    if (data === 'change_mode') {
      return bot.editMessageText('⚙️ وضع التداول:', { chat_id: chatId, message_id: msgId, ...KB.modeMenu });
    }
    if (data === 'set_mode_PAPER') {
      process.env.BOT_MODE = 'PAPER';
      await db.updateSettings({ mode: 'PAPER' });
      return bot.editMessageText('✅ الوضع التجريبي 📝', { chat_id: chatId, message_id: msgId });
    }
    if (data === 'set_mode_REAL') {
      return bot.editMessageText('⚠️ <b>تحذير!</b> الوضع الحقيقي يستخدم أموالك!\nمتأكد؟',
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...KB.confirmRealMode });
    }
    if (data === 'confirm_real_mode') {
      process.env.BOT_MODE = 'REAL';
      await db.updateSettings({ mode: 'REAL' });
      return bot.editMessageText('✅ الوضع الحقيقي 💰 — ستُنفّذ الصفقات بأموال حقيقية!', { chat_id: chatId, message_id: msgId });
    }

    // Profit protection
    if (data === 'continue_trading') {
      await _startBot(null, null, true);
      return bot.editMessageText('▶️ استمر بحذر!', { chat_id: chatId, message_id: msgId });
    }
    if (data === 'stop_trading') {
      await _stopBot();
      return bot.editMessageText('🔒 ربحك محمي ✅', { chat_id: chatId, message_id: msgId });
    }

    // Emergency
    if (data === 'emergency_close') {
      await bot.editMessageText('⏳ إغلاق الكل...', { chat_id: chatId, message_id: msgId });
      return closeAll('EMERGENCY');
    }
    if (data === 'pause_bot') {
      await _stopBot();
      return bot.editMessageText('⏸️ متوقف مؤقتاً.', { chat_id: chatId, message_id: msgId });
    }
    if (data === 'confirm_stop') {
      await _stopBot();
      return bot.editMessageText('🛑 البوت توقف.', { chat_id: chatId, message_id: msgId });
    }

    // Stats
    if (data.startsWith('stats_')) {
      return showStatsPeriod(bot, chatId, msgId, data.slice(6));
    }

    // Cancel
    if (data === 'cancel') {
      clearState(chatId);
      return bot.editMessageText('❌ تم الإلغاء.', { chat_id: chatId, message_id: msgId });
    }
  });

  // Commands
  bot.onText(/\/stop$/,      async msg => bot.sendMessage(msg.chat.id, 'إيقاف البوت؟', KB.confirmStop));
  bot.onText(/\/status/,     async msg => showStatus(bot, msg.chat.id));
  bot.onText(/\/trades/,     async msg => showTrades(bot, msg.chat.id));
  bot.onText(/\/stats/,      async msg => bot.sendMessage(msg.chat.id, '📊 الفترة:', KB.statsPeriodMenu));
  bot.onText(/\/market/,     async msg => showMarket(bot, msg.chat.id));
  bot.onText(/\/mode/,       async msg => showSettings(bot, msg.chat.id));
  bot.onText(/\/close_all/,  async msg => bot.sendMessage(msg.chat.id, '⚠️ إغلاق طارئ:', KB.emergencyMenu));
  bot.onText(/\/help/,       async msg => showHelp(bot, msg.chat.id));
  bot.onText(/\/errors/,     async msg => showErrors(bot, msg.chat.id));
  bot.onText(/\/performance/,async msg => showPerformance(bot, msg.chat.id));
}

// ─── FLOWS ────────────────────────────────────────────────────
async function startDayFlow(bot, chatId) {
  await bot.sendMessage(chatId,
    '🌅 <b>بدء يوم تداول جديد</b>\n\nاختر رأس المال 👇',
    { parse_mode: 'HTML', ...KB.startDayMenu });
}

async function showConfirm(bot, chatId, capital, stop) {
  const stopAmt = (capital * stop / 100).toFixed(2);
  await bot.sendMessage(chatId,
`📋 <b>تأكيد الإعدادات</b>

💰 رأس المال:  <b>$${capital}</b>
🛑 Daily Stop: <b>${stop}%</b> = <b>$${stopAmt}</b>
📝 الوضع:      <b>${process.env.BOT_MODE === 'REAL' ? 'حقيقي 💰' : 'تجريبي 📝'}</b>

✅ هل تؤكد البدء؟`,
    { parse_mode: 'HTML', ...KB.confirmStart(capital, stop) });
}

// ─── DISPLAY FUNCTIONS ────────────────────────────────────────
async function showStatus(bot, chatId) {
  const [session, open, sa] = await Promise.all([
    db.getActiveSession(), db.getOpenTrades(), db.getDailyStats(1)
  ]);
  const stats = sa[0] || {};
  const pnl = +(session?.net_pnl || 0);
  await bot.sendMessage(chatId,
`╔═══════════════════════╗
║     📡 AXOM Status     ║
╚═══════════════════════╝

${session ? '🟢 نشط' : '🔴 موقوف'}  •  ${process.env.BOT_MODE === 'REAL' ? '💰 حقيقي' : '📝 تجريبي'}

💰 رأس المال: <b>$${(+(session?.start_capital||0)).toFixed(2)}</b>
📊 الرصيد:    <b>$${(+(session?.current_balance||0)).toFixed(4)}</b>
📈 أعلى:      <b>$${(+(session?.daily_high||0)).toFixed(4)}</b>
🛑 Stop:      <b>$${(+(session?.daily_stop_amount||0)).toFixed(2)}</b>
📈 PnL اليوم: <b>${pnl>=0?'+':''}$${pnl.toFixed(4)}</b>

🔄 مفتوحة: <b>${open.length}</b>  📊 اليوم: <b>${stats.total_trades||0}</b>
✅ Win Rate: <b>${stats.win_rate?.toFixed(1)||0}%</b>  💸 رسوم: <b>$${(+(stats.total_fees||0)).toFixed(4)}</b>`,
    { parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[
        { text: '🔄 تحديث', callback_data: 'refresh_status' },
        { text: '🚨 طارئ', callback_data: 'emergency_close' }
      ]]}
    });
}

async function showTrades(bot, chatId) {
  const open = await db.getOpenTrades();
  if (!open.length) return bot.sendMessage(chatId, '📭 لا توجد صفقات مفتوحة.', KB.mainMenu);
  let text = `🔄 <b>الصفقات المفتوحة (${open.length})</b>\n\n`;
  for (const t of open) {
    const ago = Math.round((Date.now() - new Date(t.opened_at).getTime()) / 60000);
    text += `${t.direction==='LONG'?'🟢':'🔴'} <b>${t.symbol}</b> x${t.leverage} Score:${t.score}\n`;
    text += `📍 $${(+t.entry_price).toFixed(2)}  🛑 $${(+t.stop_loss).toFixed(2)}\n`;
    text += `${t.tp1_hit?'✅':'⬜'}TP1 ${t.tp2_hit?'✅':'⬜'}TP2 ⬜TP3  ${ago}د\n\n`;
  }
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '🚨 إغلاق الكل', callback_data: 'emergency_close' }]]}
  });
}

async function showMarket(bot, chatId) {
  const sigs = await db.getRecentSignals(8);
  if (!sigs.length) return bot.sendMessage(chatId, '🔍 لا توجد إشارات حديثة.', KB.mainMenu);
  let text = '📡 <b>آخر الإشارات</b>\n\n';
  for (const s of sigs) {
    const ago = Math.round((Date.now() - new Date(s.created_at).getTime()) / 60000);
    text += `${s.decision==='APPROVE'?'🟢':'🔴'} <b>${s.symbol}</b> Score:${s.total_score} ${ago}د\n`;
    text += s.decision==='APPROVE'
      ? `   ${s.direction} TP1:$${s.tp1?.toFixed(2)||'?'} x${s.leverage}\n\n`
      : `   ❌ ${(s.reject_reason||'').substring(0,35)}\n\n`;
  }
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

async function showPerformance(bot, chatId) {
  const week = await db.getWeeklyStats();
  if (!week.length) return bot.sendMessage(chatId, '📈 لا توجد بيانات كافية.', KB.mainMenu);
  const tot = week.reduce((a,s)=>({ pnl:a.pnl+(s.net_pnl||0), fees:a.fees+(s.total_fees||0), t:a.t+(s.total_trades||0), w:a.w+(s.winning_trades||0) }), {pnl:0,fees:0,t:0,w:0});
  const wr = tot.t > 0 ? ((tot.w/tot.t)*100).toFixed(1) : 0;
  await bot.sendMessage(chatId,
`📈 <b>تقرير الأسبوع</b>

💰 صافي: <b>${tot.pnl>=0?'+':''}$${tot.pnl.toFixed(4)}</b>
💸 رسوم: <b>$${tot.fees.toFixed(4)}</b>
📊 صفقات: <b>${tot.t}</b>  ✅ WR: <b>${wr}%</b>
📅 أيام: <b>${week.length}</b>
💹 متوسط/يوم: <b>$${week.length>0?(tot.pnl/week.length).toFixed(4):0}</b>`,
    { parse_mode: 'HTML' });
}

async function showSettings(bot, chatId) {
  await bot.sendMessage(chatId,
    `⚙️ <b>الإعدادات</b>\nالوضع: ${process.env.BOT_MODE==='REAL'?'💰 حقيقي':'📝 تجريبي'}`,
    { parse_mode: 'HTML', ...KB.settingsMenu });
}

async function showHelp(bot, chatId) {
  await bot.sendMessage(chatId,
`📖 <b>دليل AXOM</b>

<b>القائمة:</b>
🚀 بدء يوم جديد
📡 الحالة  •  🔄 الصفقات
📊 الإحصائيات  •  🔍 فرص السوق
📈 الأداء  •  ⚙️ الإعدادات

<b>أوامر:</b>
/stop — إيقاف  •  /close_all — طارئ
/errors — الأخطاء  •  /performance — تقرير

💬 اكتب أي سؤال وسأجيبك!`,
    { parse_mode: 'HTML', ...KB.mainMenu });
}

async function showErrors(bot, chatId) {
  const errs = await db.getUnresolvedErrors();
  if (!errs.length) return bot.sendMessage(chatId, '✅ لا توجد أخطاء نشطة.', KB.mainMenu);
  let text = `🚨 <b>أخطاء (${errs.length})</b>\n\n`;
  for (const e of errs.slice(0,5)) {
    text += `🔴 <b>${e.source}</b>: ${e.message}\n⏰ ${new Date(e.timestamp).toLocaleTimeString('ar-SA')}\n\n`;
  }
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

async function showStatsPeriod(bot, chatId, msgId, period) {
  const daysMap = { today:1, week:7, month:30, all:365 };
  const labelMap = { today:'اليوم', week:'أسبوع', month:'شهر', all:'كل الوقت' };
  const days  = daysMap[period]  || 7;
  const label = labelMap[period] || 'أسبوع';
  const stats = await db.getDailyStats(days);
  if (!stats.length) return bot.editMessageText('📊 لا توجد بيانات.', { chat_id: chatId, message_id: msgId });

  let totalPnl=0, totalT=0, totalW=0, totalF=0;
  let text = `📊 <b>الإحصائيات — ${label}</b>\n\n`;
  for (const s of stats.slice(0,7)) {
    totalPnl+=s.net_pnl||0; totalT+=s.total_trades||0; totalW+=s.winning_trades||0; totalF+=s.total_fees||0;
    text += `${(s.net_pnl||0)>=0?'✅':'❌'} ${s.date}: ${(s.net_pnl||0)>=0?'+':''}$${(s.net_pnl||0).toFixed(2)} WR:${s.win_rate||0}% ${s.total_trades||0}ص\n`;
  }
  const wr = totalT>0?((totalW/totalT)*100).toFixed(1):0;
  text += `\n━━━━━━━━━━━━\n💰 صافي: <b>${totalPnl>=0?'+':''}$${totalPnl.toFixed(4)}</b>\n💸 رسوم: <b>$${totalF.toFixed(4)}</b>\n📊 ${totalT} صفقة  ✅ WR: <b>${wr}%</b>`;
  await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' });
}

async function chatAI(bot, chatId, text) {
  try {
    const [session, open, sa] = await Promise.all([db.getActiveSession(), db.getOpenTrades(), db.getDailyStats(1)]);
    const ctx = { running:!!session, mode:process.env.BOT_MODE, balance:session?.current_balance, openTrades:open.length, todayPnL:sa[0]?.net_pnl||0, winRate:sa[0]?.win_rate||0 };
    await db.saveChatMessage('USER', text);
    const reply = await G.chatReply(text, ctx);
    await db.saveChatMessage('BOT', reply);
    await bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
  } catch { await bot.sendMessage(chatId, 'عذراً، خطأ مؤقت.'); }
}

module.exports = { register };
