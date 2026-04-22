// ============================================================
// AXOM — Telegram Command Handlers + Keyboard System
// Includes: suggestion approval, live controls, AI chat
// ============================================================
const db    = require('../core/database');
const dash  = require('../core/dashboard');
const G     = require('../core/gemini');
const { closeAll } = require('../trading/executor');
const bingx = require('../core/bingx');
const MT    = require('../core/marketTracker');

const userState = {};
const setState  = (id,s) => { userState[id] = s; };
const getState  = id => userState[id] || {};
const clearState= id => { delete userState[id]; };

// ─── KEYBOARDS ────────────────────────────────────────────────
const mainMenu = { reply_markup:{ keyboard:[
  [{ text:'🚀 بدء يوم' }, { text:'📡 الحالة' }],
  [{ text:'🔄 صفقات'  }, { text:'📊 إحصائيات' }],
  [{ text:'💡 اقتراحات'}, { text:'🔍 فرص السوق' }],
  [{ text:'⚙️ إعدادات'}, { text:'🆘 مساعدة' }]
], resize_keyboard:true, persistent:true }};

const capitalKB = { reply_markup:{ inline_keyboard:[
  [{ text:'$5',  callback_data:'cap_5'  }, { text:'$10', callback_data:'cap_10' }],
  [{ text:'$20', callback_data:'cap_20' }, { text:'$50', callback_data:'cap_50' }],
  [{ text:'✏️ مخصص', callback_data:'cap_custom' }],
  [{ text:'❌ إلغاء',  callback_data:'cancel' }]
]}};

function stopKB(cap) { return { reply_markup:{ inline_keyboard:[
  [{ text:'10%', callback_data:`stp_10` }, { text:'30%', callback_data:`stp_30` }],
  [{ text:'50%', callback_data:`stp_50` }, { text:'60%', callback_data:`stp_60` }],
  [{ text:'70%', callback_data:`stp_70` }, { text:'80%', callback_data:`stp_80` }],
  [{ text:'✏️ مخصص', callback_data:'stp_custom' }],
  [{ text:'❌ إلغاء',  callback_data:'cancel' }]
]}}; }

function confirmKB(cap, stp) { return { reply_markup:{ inline_keyboard:[
  [{ text:`✅ ابدأ ($${cap}, ${stp}%)`, callback_data:`confirm_${cap}_${stp}` }],
  [{ text:'🔄 تغيير', callback_data:'change_settings' }, { text:'❌ إلغاء', callback_data:'cancel' }]
]}}; }

const modeKB = { reply_markup:{ inline_keyboard:[
  [{ text:'📝 تجريبي (Paper)', callback_data:'mode_PAPER' }],
  [{ text:'🎮 ديمو (BingX Demo)', callback_data:'mode_DEMO' }],
  [{ text:'💰 حقيقي ⚠️',       callback_data:'mode_REAL' }],
  [{ text:'❌ إلغاء', callback_data:'cancel' }]
]}};

function suggestionKB(id) { return { reply_markup:{ inline_keyboard:[
  [{ text:'✅ أوافق — نفّذ', callback_data:`sug_approve_${id}` }],
  [{ text:'❌ ارفض',          callback_data:`sug_reject_${id}`  }]
]}}; }

const emergencyKB = { reply_markup:{ inline_keyboard:[
  [{ text:'🚨 إغلاق كل الصفقات', callback_data:'emergency_close' }],
  [{ text:'⏸️ إيقاف مؤقت',      callback_data:'pause_bot'       }],
  [{ text:'❌ إلغاء',             callback_data:'cancel'          }]
]}};

const confirmStopKB = { reply_markup:{ inline_keyboard:[
  [{ text:'✅ أوقف', callback_data:'confirm_stop' }, { text:'❌ إلغاء', callback_data:'cancel' }]
]}};

let _start, _stop;

// ─── REGISTER ────────────────────────────────────────────────
function register(bot, startFn, stopFn) {
  _start = startFn; _stop = stopFn;

  bot.onText(/\/start$/, async msg => {
    process.env.TELEGRAM_CHAT_ID = msg.chat.id.toString();
    clearState(msg.chat.id);
    await dash.send(`╔══════════════════════════╗
║    🤖 AXOM Trading Bot    ║
║    Elite ICT/SMC System  ║
╚══════════════════════════╝

مرحباً! AXOM جاهز للتداول.
الوضع: ${process.env.BOT_MODE==='REAL'?'💰 حقيقي':process.env.BOT_MODE==='DEMO'?'🎮 ديمو':'📝 تجريبي'}

اختر من القائمة 👇`, mainMenu);
  });

  // Text buttons
  bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const cid = msg.chat.id, txt = msg.text;
    const state = getState(cid);

    if (txt === '🚀 بدء يوم')    return showStartDay(bot, cid);
    if (txt === '📡 الحالة')     return showStatus(bot, cid);
    if (txt === '🔄 صفقات')      return showTrades(bot, cid);
    if (txt === '📊 إحصائيات')   return showStats(bot, cid);
    if (txt === '💡 اقتراحات')   return showSuggestions(bot, cid);
    if (txt === '🔍 فرص السوق')  return showMarket(bot, cid);
    if (txt === '⚙️ إعدادات')    return showSettings(bot, cid);
    if (txt === '🆘 مساعدة')     return showHelp(bot, cid);

    // Multi-step inputs
    if (state.step === 'custom_cap') {
      const n = parseFloat(txt);
      if (isNaN(n)||n<5) return bot.sendMessage(cid,'❌ الحد الأدنى $5:');
      setState(cid,{step:'pick_stop',capital:n});
      return bot.sendMessage(cid,`💰 $${n}\nاختر نسبة الـ Stop:`, stopKB(n));
    }
    if (state.step === 'custom_stop') {
      const n = parseFloat(txt);
      if (isNaN(n)||n<5||n>95) return bot.sendMessage(cid,'❌ النسبة 5-95:');
      setState(cid,{step:'confirm',capital:state.capital,stop:n});
      return bot.sendMessage(cid,buildConfirmText(state.capital,n), confirmKB(state.capital,n));
    }

    // AI chat
    await handleChat(bot, cid, txt);
  });

  // Callbacks
  bot.on('callback_query', async q => {
    const cid  = q.message.chat.id;
    const mid  = q.message.message_id;
    const data = q.data;
    await bot.answerCallbackQuery(q.id);

    // Capital
    if (data.startsWith('cap_')) {
      const val = data.slice(4);
      if (val==='custom') {
        setState(cid,{step:'custom_cap'});
        return bot.editMessageText('✏️ أرسل المبلغ:', {chat_id:cid,message_id:mid});
      }
      const cap = parseFloat(val);
      setState(cid,{step:'pick_stop',capital:cap});
      return bot.editMessageText(`💰 $${cap}\nاختر نسبة الـ Stop:`, {chat_id:cid,message_id:mid,...stopKB(cap)});
    }

    // Stop
    if (data.startsWith('stp_')) {
      const state = getState(cid), cap = state.capital||10;
      const val = data.slice(4);
      if (val==='custom') {
        setState(cid,{...state,step:'custom_stop'});
        return bot.editMessageText('✏️ أرسل نسبة الـ Stop (5-95):', {chat_id:cid,message_id:mid});
      }
      const stp = parseFloat(val);
      setState(cid,{step:'confirm',capital:cap,stop:stp});
      await bot.deleteMessage(cid,mid).catch(()=>{});
      return bot.sendMessage(cid,buildConfirmText(cap,stp), confirmKB(cap,stp));
    }

    // Confirm start
    if (data.startsWith('confirm_')) {
      const [,cap,stp] = data.split('_');
      clearState(cid);
      await bot.editMessageText('⏳ جارٍ التشغيل...', {chat_id:cid,message_id:mid}).catch(()=>{});
      return _start(parseFloat(cap), parseFloat(stp));
    }

    if (data==='change_settings') return bot.editMessageText('💰 اختر رأس المال:', {chat_id:cid,message_id:mid,...capitalKB});

    // Mode
    if (data.startsWith('mode_')) {
      const m = data.slice(5);
      process.env.BOT_MODE = m;
      await db.updateSettings({mode:m});
      return bot.editMessageText(`✅ الوضع: ${m==='PAPER'?'📝 تجريبي':m==='DEMO'?'🎮 ديمو':'💰 حقيقي'}`, {chat_id:cid,message_id:mid});
    }

    // Suggestions
    if (data.startsWith('sug_approve_')) {
      const id = data.slice(12);
      return approveSuggestion(bot, cid, mid, id);
    }
    if (data.startsWith('sug_reject_')) {
      const id = data.slice(11);
      await db.updateSuggestion(id,{status:'REJECTED',resolved_at:new Date().toISOString()});
      return bot.editMessageText('❌ تم رفض الاقتراح.', {chat_id:cid,message_id:mid});
    }

    // Controls
    if (data==='continue_trading') { await bot.editMessageText('▶️ استمر!', {chat_id:cid,message_id:mid}); }
    if (data==='stop_trading')     { await _stop(); bot.editMessageText('🔒 موقوف.', {chat_id:cid,message_id:mid}); }
    if (data==='emergency_close')  { await bot.editMessageText('⏳ إغلاق...', {chat_id:cid,message_id:mid}); await closeAll('EMERGENCY'); }
    if (data==='pause_bot')        { await _stop(); bot.editMessageText('⏸️ متوقف مؤقتاً.', {chat_id:cid,message_id:mid}); }
    if (data==='confirm_stop')     { await _stop(); bot.editMessageText('🛑 توقف.', {chat_id:cid,message_id:mid}); }
    if (data==='refresh_dash')     { /* dashboard auto-refreshes */ }
    if (data==='cancel')           { clearState(cid); bot.editMessageText('❌ إلغاء.', {chat_id:cid,message_id:mid}); }
  });

  // Commands
  bot.onText(/\/stop$/,      async m => bot.sendMessage(m.chat.id,'إيقاف؟',confirmStopKB));
  bot.onText(/\/status/,     async m => showStatus(bot, m.chat.id));
  bot.onText(/\/trades/,     async m => showTrades(bot, m.chat.id));
  bot.onText(/\/stats/,      async m => showStats(bot, m.chat.id));
  bot.onText(/\/suggestions/,async m => showSuggestions(bot, m.chat.id));
  bot.onText(/\/close_all/,  async m => bot.sendMessage(m.chat.id,'⚠️ إغلاق طارئ:', emergencyKB));
  bot.onText(/\/mode/,       async m => bot.sendMessage(m.chat.id,'⚙️ اختر الوضع:', modeKB));
  bot.onText(/\/errors/,     async m => showErrors(bot, m.chat.id));
  bot.onText(/\/balance/,    async m => showBalance(bot, m.chat.id));
  bot.onText(/\/help/,       async m => showHelp(bot, m.chat.id));
}

// ─── HANDLERS ────────────────────────────────────────────────
function buildConfirmText(cap, stp) {
  return `📋 <b>تأكيد</b>\n💰 $${cap}  🛑 ${stp}%=$${(cap*stp/100).toFixed(2)}\n📝 ${process.env.BOT_MODE||'PAPER'}\nتؤكد؟`;
}

async function showStartDay(bot, cid) {
  await bot.sendMessage(cid,'🌅 <b>بدء يوم جديد</b>\n\nاختر رأس المال:', {parse_mode:'HTML',...capitalKB});
}

async function showStatus(bot, cid) {
  const [session, open, sa] = await Promise.all([db.getActiveSession(), db.getOpenTrades(), db.getDailyStats(1)]);
  const stats = sa[0]||{};
  const pnl = +(session?.net_pnl||0);
  await dash.send(`📡 <b>Status</b>

${session?'🟢 نشط':'🔴 موقوف'}  ${process.env.BOT_MODE==='REAL'?'💰':'📝'}

💰 $${(+session?.start_capital||0).toFixed(2)}  →  $${(+session?.current_balance||0).toFixed(4)}
PnL: ${pnl>=0?'+':''}$${pnl.toFixed(4)}  Stop: $${(+session?.daily_stop_amount||0).toFixed(2)}

🔄 ${open.length} مفتوحة  📊 ${stats.total_trades||0} اليوم  ✅ WR:${stats.win_rate?.toFixed(1)||0}%`,
    { reply_markup:{ inline_keyboard:[[{ text:'🚨 طارئ', callback_data:'emergency_close' }]] }});
}

async function showTrades(bot, cid) {
  const open = await db.getOpenTrades();
  if (!open.length) return dash.send('📭 لا توجد صفقات مفتوحة.');
  let txt = `🔄 <b>مفتوحة (${open.length})</b>\n\n`;
  for (const t of open) {
    const p   = MT.getPrice(t.symbol)||+t.entry_price;
    const uPnl= t.direction==='LONG'?(p-t.entry_price)*(t.position_size||1):(t.entry_price-p)*(t.position_size||1);
    const age = Math.round((Date.now()-new Date(t.opened_at).getTime())/60000);
    txt += `${t.direction==='LONG'?'🟢':'🔴'} <b>${t.symbol}</b> x${t.leverage}\n`;
    txt += `$${t.entry_price}→$${p.toFixed(2)} ${uPnl>=0?'📈+':'📉'}$${uPnl.toFixed(4)}\n`;
    txt += `${t.tp1_hit?'✅':'⬜'}TP1 ${t.tp2_hit?'✅':'⬜'}TP2 ⬜TP3  ${age}د\n\n`;
  }
  await dash.send(txt, { reply_markup:{ inline_keyboard:[[{ text:'🚨 إغلاق الكل', callback_data:'emergency_close' }]] }});
}

async function showStats(bot, cid) {
  const stats = await db.getDailyStats(7);
  if (!stats.length) return dash.send('📊 لا توجد إحصائيات بعد.');
  let tot={pnl:0,fees:0,t:0,w:0};
  let txt='📊 <b>آخر 7 أيام</b>\n\n';
  for (const s of stats) {
    tot.pnl+=s.net_pnl||0; tot.fees+=s.total_fees||0; tot.t+=s.total_trades||0; tot.w+=s.winning_trades||0;
    txt+=`${(s.net_pnl||0)>=0?'✅':'❌'} ${s.date}: ${(s.net_pnl||0)>=0?'+':''}$${(s.net_pnl||0).toFixed(2)} WR:${s.win_rate||0}% ${s.total_trades||0}ص\n`;
  }
  const wr=tot.t>0?((tot.w/tot.t)*100).toFixed(1):0;
  txt+=`\n━━━━\n💰 $${tot.pnl.toFixed(4)}  💸 $${tot.fees.toFixed(4)}\n📊 ${tot.t}  ✅ ${wr}%`;
  await dash.send(txt);
}

async function showSuggestions(bot, cid) {
  const sug = await db.getPendingSuggestions();
  if (!sug.length) return dash.send('💡 لا توجد اقتراحات معلقة حالياً.\nسيتم إرسال اقتراحات تلقائياً كل ساعة.');
  for (const s of sug.slice(0,3)) {
    await bot.sendMessage(cid,
`💡 <b>اقتراح صفقة</b>

${s.direction==='LONG'?'🟢 LONG':'🔴 SHORT'} <b>${s.symbol}</b>
📊 Score: <b>${s.score}</b>  ⚡ x${s.leverage}
${s.confidence==='HIGH'?'🔥':'⚠️'} ثقة: ${s.confidence}

📍 Entry: $${(+s.entry_price).toFixed(4)}
🛑 SL:    $${(+s.stop_loss).toFixed(4)}
🎯 TP1:   $${(+s.tp1).toFixed(4)}
🎯 TP2:   $${(+s.tp2).toFixed(4)}

📝 ${s.summary}`,
      { parse_mode:'HTML', ...suggestionKB(s.id) });
  }
}

async function approveSuggestion(bot, cid, mid, id) {
  const sug = (await db.getPendingSuggestions()).find(s=>s.id===id);
  if (!sug) return bot.editMessageText('❌ انتهت صلاحية الاقتراح.', {chat_id:cid,message_id:mid});

  const session = await db.getActiveSession();
  if (!session) return bot.editMessageText('❌ لا توجد جلسة نشطة. ابدأ يوم أولاً.', {chat_id:cid,message_id:mid});

  try {
    const { openTrade, CompoundState } = require('../trading/executor');
    // Create minimal compound state for risk calc
    const cs = new CompoundState(session.start_capital, session.daily_stop_amount);
    const signal = { ...sug, direction: sug.direction, entry: sug.entry_price, sl: sug.stop_loss, kz:{ zone:'MANUAL' } };
    await openTrade(signal, session, cs);
    await db.updateSuggestion(id,{status:'APPROVED',resolved_at:new Date().toISOString()});
    await bot.editMessageText('✅ تم تنفيذ الصفقة!', {chat_id:cid,message_id:mid});
  } catch (e) {
    await bot.editMessageText(`❌ فشل التنفيذ: ${e.message}`, {chat_id:cid,message_id:mid});
  }
}

async function showMarket(bot, cid) {
  const sigs = await db.getRecentSignals(6);
  if (!sigs.length) return dash.send('🔍 لا توجد إشارات حديثة.');
  let txt='📡 <b>آخر الإشارات</b>\n\n';
  for (const s of sigs) {
    const ago=Math.round((Date.now()-new Date(s.created_at).getTime())/60000);
    txt+=`${s.decision==='APPROVE'?'🟢':'🔴'} <b>${s.symbol}</b> Score:${s.total_score} ${ago}د\n`;
    txt+=s.decision==='APPROVE'?`   ${s.direction} TP1:$${s.tp1?.toFixed(2)||'?'}\n\n`:`   ❌ ${(s.reject_reason||'').slice(0,35)}\n\n`;
  }
  await dash.send(txt);
}

async function showSettings(bot, cid) {
  const bal = await bingx.getBalance().catch(()=>null);
  await bot.sendMessage(cid,`⚙️ <b>إعدادات</b>
الوضع: ${process.env.BOT_MODE==='REAL'?'💰 حقيقي':process.env.BOT_MODE==='DEMO'?'🎮 ديمو':'📝 تجريبي'}
${bal?`رصيد: $${bal.balance.toFixed(4)}`:''}`, {parse_mode:'HTML',...modeKB});
}

async function showBalance(bot, cid) {
  try {
    const bal = await bingx.getBalance();
    await dash.send(`💰 <b>الرصيد</b>
وضع: ${bal.mode}
رصيد: <b>$${bal.balance.toFixed(4)}</b>
متاح: <b>$${bal.available.toFixed(4)}</b>`);
  } catch (e) {
    await dash.send(`❌ فشل جلب الرصيد: ${e.message}`);
  }
}

async function showErrors(bot, cid) {
  const errs = await db.getUnresolvedErrors();
  if (!errs.length) return dash.send('✅ لا أخطاء نشطة.');
  let txt=`🚨 <b>أخطاء (${errs.length})</b>\n\n`;
  for (const e of errs.slice(0,5)) txt+=`🔴 <b>${e.source}</b>: ${e.message}\n${new Date(e.timestamp).toLocaleTimeString('ar-SA')}\n\n`;
  await dash.send(txt);
}

async function showHelp(bot, cid) {
  await dash.send(`📖 <b>AXOM دليل</b>

<b>القائمة:</b>
🚀 بدء يوم  •  📡 الحالة
🔄 صفقات   •  📊 إحصائيات
💡 اقتراحات •  🔍 فرص السوق
⚙️ إعدادات  •  🆘 مساعدة

<b>أوامر:</b>
/balance — رصيد الحساب
/errors — الأخطاء النشطة
/close_all — إغلاق طارئ
/mode — تغيير وضع التداول

💬 اكتب أي سؤال بالعربية!`, mainMenu);
}

async function handleChat(bot, cid, text) {
  try {
    const [session,open,sa] = await Promise.all([db.getActiveSession(),db.getOpenTrades(),db.getDailyStats(1)]);
    const ctx = { running:!!session, mode:process.env.BOT_MODE, balance:session?.current_balance, openTrades:open.length, todayPnL:sa[0]?.net_pnl||0, winRate:sa[0]?.win_rate||0 };
    await db.saveChat('USER', text);
    const gemini = require('../core/gemini');
    const reply  = await gemini.chatReply(text, ctx);
    await db.saveChat('BOT', reply);
    await dash.send(reply);
  } catch { await dash.send('عذراً، خطأ مؤقت.'); }
}

module.exports = { register, suggestionKB };
