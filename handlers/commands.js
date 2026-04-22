// ============================================================
// AXOM — Telegram Commands + Button System
// Full keyboard system, suggestions, scan mode, AI chat
// ============================================================
const db   = require('../core/database');
const dash = require('../core/dashboard');
const G    = require('../core/gemini');
const KB   = require('./keyboards');
const { closeAll } = require('../trading/executor');
const bingx = require('../core/bingx');
const MT    = require('../core/marketTracker');

const userState = {};
const setState  = (id,s) => { userState[id]=s; };
const getState  = id => userState[id]||{};
const clearState= id => { delete userState[id]; };

let _start, _stop;

function register(bot, startFn, stopFn) {
  _start = startFn;
  _stop  = stopFn;

  // /start
  bot.onText(/\/start$/, async msg => {
    process.env.TELEGRAM_CHAT_ID = msg.chat.id.toString();
    clearState(msg.chat.id);
    await dash.send(
`╔══════════════════════════╗
║    🤖 AXOM Trading Bot    ║
║    Elite ICT/SMC v3.0    ║
╚══════════════════════════╝

مرحباً! AXOM جاهز للعمل.
الوضع: ${_modeLabel()}

اختر من القائمة 👇`, KB.mainMenu);
  });

  // Reply keyboard buttons
  bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const cid   = msg.chat.id;
    const txt   = msg.text;
    const state = getState(cid);

    // Main menu
    if (txt==='🚀 بدء يوم')    return _startDayFlow(bot, cid);
    if (txt==='📡 الحالة')     return _showStatus(bot, cid);
    if (txt==='🔄 صفقات')      return _showTrades(bot, cid);
    if (txt==='📊 إحصائيات')   return _showStats(bot, cid);
    if (txt==='💡 اقتراحات')   return _showSuggestions(bot, cid);
    if (txt==='🔍 فرص السوق')  return _showMarket(bot, cid);
    if (txt==='⚙️ إعدادات')    return _showSettings(bot, cid);
    if (txt==='🆘 مساعدة')     return _showHelp(bot, cid);

    // Multi-step inputs
    if (state.step==='custom_cap') {
      const n=parseFloat(txt);
      if (isNaN(n)||n<5) return bot.sendMessage(cid,'❌ الحد الأدنى $5:');
      setState(cid,{step:'pick_stop',capital:n});
      return bot.sendMessage(cid,`💰 $${n}\nاختر نسبة Stop:`,KB.stopKB());
    }
    if (state.step==='custom_stop') {
      const n=parseFloat(txt);
      if (isNaN(n)||n<5||n>95) return bot.sendMessage(cid,'❌ النسبة 5-95:');
      setState(cid,{step:'confirm',capital:state.capital,stop:n});
      return bot.sendMessage(cid,_confirmText(state.capital,n),KB.confirmKB(state.capital,n));
    }

    // AI chat
    await _chatAI(bot, cid, txt);
  });

  // Callback queries
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
        return bot.editMessageText('✏️ أرسل المبلغ بالدولار:',{chat_id:cid,message_id:mid});
      }
      const cap=parseFloat(val);
      setState(cid,{step:'pick_stop',capital:cap});
      return bot.editMessageText(
        `💰 $${cap}\nاختر نسبة الـ Daily Stop:`,
        {chat_id:cid,message_id:mid,...KB.stopKB()});
    }

    // Stop %
    if (data.startsWith('stp_')) {
      const state=getState(cid), cap=state.capital||10;
      const val=data.slice(4);
      if (val==='custom') {
        setState(cid,{...state,step:'custom_stop'});
        return bot.editMessageText('✏️ أرسل نسبة Stop (5-95):',{chat_id:cid,message_id:mid});
      }
      const stp=parseFloat(val);
      setState(cid,{step:'confirm',capital:cap,stop:stp});
      await bot.deleteMessage(cid,mid).catch(()=>{});
      return bot.sendMessage(cid,_confirmText(cap,stp),KB.confirmKB(cap,stp));
    }

    // Confirm start
    if (data.startsWith('confirm_')) {
      const parts=data.split('_');
      if (parts[1]==='real') {
        // confirm real mode
        process.env.BOT_MODE='REAL';
        await db.updateSettings({mode:'REAL'});
        return bot.editMessageText('✅ الوضع الحقيقي 💰 — صفقات حقيقية!',{chat_id:cid,message_id:mid});
      }
      const cap=parseFloat(parts[1]), stp=parseFloat(parts[2]);
      clearState(cid);
      await bot.editMessageText('⏳ جارٍ التشغيل...',{chat_id:cid,message_id:mid}).catch(()=>{});
      return _start(cap, stp);
    }

    if (data==='change_settings')
      return bot.editMessageText('💰 اختر رأس المال:',{chat_id:cid,message_id:mid,...KB.capitalKB});

    // Mode
    if (data.startsWith('mode_')) {
      const m=data.slice(5);
      if (m==='REAL') {
        return bot.editMessageText(
          '⚠️ <b>تحذير!</b>\nالوضع الحقيقي يستخدم أموالك!\nمتأكد؟',
          {chat_id:cid,message_id:mid,parse_mode:'HTML',...KB.confirmRealKB});
      }
      process.env.BOT_MODE=m;
      await db.updateSettings({mode:m});
      return bot.editMessageText(`✅ الوضع: ${_modeLabel()}`,{chat_id:cid,message_id:mid});
    }

    // Scan mode
    if (data.startsWith('scanmode_')) {
      const m=data.slice(9);
      global.setScanMode && global.setScanMode(m);
      const labels={AUTO:'🤖 تلقائي',SUGGEST:'💡 اقتراح فقط',OFF:'⏸️ مغلق'};
      return bot.editMessageText(`✅ وضع الفحص: ${labels[m]||m}`,{chat_id:cid,message_id:mid});
    }

    // Suggestions
    if (data.startsWith('sug_approve_')) {
      return _approveSuggestion(bot,cid,mid,data.slice(12));
    }
    if (data.startsWith('sug_reject_')) {
      await db.updateSuggestion(data.slice(11),{status:'REJECTED',resolved_at:new Date().toISOString()});
      return bot.editMessageText('❌ تم رفض الاقتراح.',{chat_id:cid,message_id:mid});
    }

    // Stats period
    if (data.startsWith('stats_'))
      return _showStatsPeriod(bot,cid,mid,data.slice(6));

    // Controls
    if (data==='continue_trading') {
      await _start(null,null,true);
      return bot.editMessageText('▶️ استمر!',{chat_id:cid,message_id:mid});
    }
    if (data==='stop_trading') {
      await _stop();
      return bot.editMessageText('🔒 موقوف. ربحك محمي.',{chat_id:cid,message_id:mid});
    }
    if (data==='emergency_close') {
      await bot.editMessageText('⏳ إغلاق كل الصفقات...',{chat_id:cid,message_id:mid});
      return closeAll('EMERGENCY');
    }
    if (data==='pause_bot') {
      await _stop();
      return bot.editMessageText('⏸️ متوقف مؤقتاً.',{chat_id:cid,message_id:mid});
    }
    if (data==='confirm_stop') {
      await _stop();
      return bot.editMessageText('🛑 توقف. /start_day لاحقاً.',{chat_id:cid,message_id:mid});
    }
    if (data==='cancel') {
      clearState(cid);
      return bot.editMessageText('❌ إلغاء.',{chat_id:cid,message_id:mid});
    }
    if (data==='refresh_dash') { /* dashboard auto-updates */ }
  });

  // Text commands
  bot.onText(/\/stop$/,        async m => bot.sendMessage(m.chat.id,'إيقاف البوت؟',KB.confirmStopKB));
  bot.onText(/\/start_day/,    async m => _startDayFlow(bot,m.chat.id));
  bot.onText(/\/status/,       async m => _showStatus(bot,m.chat.id));
  bot.onText(/\/trades/,       async m => _showTrades(bot,m.chat.id));
  bot.onText(/\/stats/,        async m => _showStats(bot,m.chat.id));
  bot.onText(/\/suggestions/,  async m => _showSuggestions(bot,m.chat.id));
  bot.onText(/\/market/,       async m => _showMarket(bot,m.chat.id));
  bot.onText(/\/mode/,         async m => bot.sendMessage(m.chat.id,'⚙️ الوضع:',KB.modeKB));
  bot.onText(/\/scanmode/,     async m => bot.sendMessage(m.chat.id,'🔍 وضع الفحص:',KB.scanModeKB));
  bot.onText(/\/close_all/,    async m => bot.sendMessage(m.chat.id,'⚠️ إغلاق طارئ:',KB.emergencyKB));
  bot.onText(/\/balance/,      async m => _showBalance(bot,m.chat.id));
  bot.onText(/\/errors/,       async m => _showErrors(bot,m.chat.id));
  bot.onText(/\/performance/,  async m => _showPerformance(bot,m.chat.id));
  bot.onText(/\/help/,         async m => _showHelp(bot,m.chat.id));
}

// ─── HELPER FUNCTIONS ────────────────────────────────────────
function _modeLabel() {
  const m=process.env.BOT_MODE||'PAPER';
  return m==='PAPER'?'📝 تجريبي':m==='DEMO'?'🎮 ديمو':'💰 حقيقي';
}

function _confirmText(cap,stp) {
  return `📋 <b>تأكيد الإعدادات</b>

💰 رأس المال:  <b>$${cap}</b>
🛑 Daily Stop: <b>${stp}%</b> = <b>$${(cap*stp/100).toFixed(2)}</b>
📝 الوضع:      <b>${_modeLabel()}</b>

تؤكد البدء؟`;
}

async function _startDayFlow(bot, cid) {
  await bot.sendMessage(cid,
    '🌅 <b>بدء يوم تداول جديد</b>\n\nاختر رأس المال 👇',
    {parse_mode:'HTML',...KB.capitalKB});
}

async function _showStatus(bot, cid) {
  const [session,open,sa]=await Promise.all([db.getActiveSession(),db.getOpenTrades(),db.getDailyStats(1)]);
  const stats=sa[0]||{};
  const pnl=+(session?.net_pnl||0);
  await dash.send(
`📡 <b>AXOM Status</b>

${session?'🟢 نشط':'🔴 موقوف'}  ${_modeLabel()}

💰 رأس المال: <b>$${(+session?.start_capital||0).toFixed(2)}</b>
📊 الرصيد:    <b>$${(+session?.current_balance||0).toFixed(4)}</b>
📈 أعلى:      <b>$${(+session?.daily_high||0).toFixed(4)}</b>
🛑 Stop:      <b>$${(+session?.daily_stop_amount||0).toFixed(2)}</b>
PnL:          <b>${pnl>=0?'+':''}$${pnl.toFixed(4)}</b>

🔄 مفتوحة: ${open.length}  📊 اليوم: ${stats.total_trades||0}
✅ Win Rate: ${stats.win_rate?.toFixed(1)||0}%  💸 رسوم: $${(+(stats.total_fees||0)).toFixed(4)}`,
    {reply_markup:{inline_keyboard:[[
      {text:'🚨 طارئ',callback_data:'emergency_close'},
      {text:'🔄 تحديث',callback_data:'refresh_dash'}
    ]]}});
}

async function _showTrades(bot, cid) {
  const open=await db.getOpenTrades();
  if (!open.length) return dash.send('📭 لا توجد صفقات مفتوحة.');
  let txt=`🔄 <b>مفتوحة (${open.length})</b>\n\n`;
  for (const t of open) {
    const p=MT.getPrice(t.symbol)||+t.entry_price;
    const uPnl=t.direction==='LONG'?(p-t.entry_price)*(t.position_size||1):(t.entry_price-p)*(t.position_size||1);
    const age=Math.round((Date.now()-new Date(t.opened_at).getTime())/60000);
    txt+=`${t.direction==='LONG'?'🟢':'🔴'} <b>${t.symbol}</b> x${t.leverage} Score:${t.score}\n`;
    txt+=`$${(+t.entry_price).toFixed(2)} → $${p.toFixed(2)}  ${uPnl>=0?'📈+':'📉'}$${uPnl.toFixed(4)}\n`;
    txt+=`${t.tp1_hit?'✅':'⬜'}TP1 ${t.tp2_hit?'✅':'⬜'}TP2 ⬜TP3  ${age}د\n\n`;
  }
  await dash.send(txt,{reply_markup:{inline_keyboard:[[{text:'🚨 إغلاق الكل',callback_data:'emergency_close'}]]}});
}

async function _showStats(bot, cid) {
  await bot.sendMessage(cid,'📊 اختر الفترة:',KB.statsPeriodKB);
}

async function _showStatsPeriod(bot, cid, mid, period) {
  const dMap={today:1,week:7,month:30,all:365};
  const lMap={today:'اليوم',week:'أسبوع',month:'شهر',all:'الكل'};
  const stats=await db.getDailyStats(dMap[period]||7);
  if (!stats.length) return bot.editMessageText('📊 لا توجد بيانات.',{chat_id:cid,message_id:mid});
  let tot={pnl:0,fees:0,t:0,w:0};
  let txt=`📊 <b>${lMap[period]||period}</b>\n\n`;
  for (const s of stats.slice(0,7)) {
    tot.pnl+=s.net_pnl||0; tot.fees+=s.total_fees||0; tot.t+=s.total_trades||0; tot.w+=s.winning_trades||0;
    txt+=`${(s.net_pnl||0)>=0?'✅':'❌'} ${s.date}: ${(s.net_pnl||0)>=0?'+':''}$${(s.net_pnl||0).toFixed(2)} WR:${s.win_rate||0}% ${s.total_trades||0}ص\n`;
  }
  const wr=tot.t>0?((tot.w/tot.t)*100).toFixed(1):0;
  txt+=`\n💰 $${tot.pnl.toFixed(4)}  💸 $${tot.fees.toFixed(4)}\n📊 ${tot.t}  ✅ ${wr}%`;
  await bot.editMessageText(txt,{chat_id:cid,message_id:mid,parse_mode:'HTML'});
}

async function _showSuggestions(bot, cid) {
  const sug=await db.getPendingSuggestions();
  if (!sug.length) return dash.send('💡 لا توجد اقتراحات معلقة حالياً.\nيتم توليدها تلقائياً كل ساعة.');
  for (const s of sug.slice(0,3)) {
    await bot.sendMessage(cid,
`💡 <b>اقتراح صفقة</b>

${s.direction==='LONG'?'🟢 LONG':'🔴 SHORT'} <b>${s.symbol}</b>
📊 Score: <b>${s.score}</b>  ⚡ x${s.leverage}
${s.confidence==='HIGH'?'🔥':'⚠️'} ثقة: ${s.confidence}

📍 Entry: <b>$${(+s.entry_price).toFixed(4)}</b>
🛑 SL:    <b>$${(+s.stop_loss).toFixed(4)}</b>
🎯 TP1:   <b>$${(+s.tp1).toFixed(4)}</b>
🎯 TP2:   <b>$${(+s.tp2).toFixed(4)}</b>

📝 ${s.summary}`,
      {parse_mode:'HTML',...KB.suggestionKB(s.id)});
  }
}

async function _approveSuggestion(bot, cid, mid, id) {
  const sug=(await db.getPendingSuggestions()).find(s=>s.id===id);
  if (!sug) return bot.editMessageText('❌ انتهت صلاحية الاقتراح.',{chat_id:cid,message_id:mid});
  const session=await db.getActiveSession();
  if (!session) return bot.editMessageText('❌ لا توجد جلسة نشطة.',{chat_id:cid,message_id:mid});
  try {
    const {openTrade,CompoundState}=require('../trading/executor');
    const cs=new CompoundState(session.start_capital,session.daily_stop_amount);
    const signal={...sug,direction:sug.direction,entry:sug.entry_price,sl:sug.stop_loss,kz:{zone:'MANUAL'}};
    await openTrade(signal,session,cs);
    await db.updateSuggestion(id,{status:'APPROVED',resolved_at:new Date().toISOString()});
    await bot.editMessageText('✅ تم تنفيذ الصفقة!',{chat_id:cid,message_id:mid});
  } catch(e) {
    await bot.editMessageText(`❌ فشل: ${e.message}`,{chat_id:cid,message_id:mid});
  }
}

async function _showMarket(bot, cid) {
  const sigs=await db.getRecentSignals(6);
  if (!sigs.length) return dash.send('🔍 لا توجد إشارات حديثة.');
  let txt='📡 <b>آخر الإشارات</b>\n\n';
  for (const s of sigs) {
    const ago=Math.round((Date.now()-new Date(s.created_at).getTime())/60000);
    txt+=`${s.decision==='APPROVE'?'🟢':'🔴'} <b>${s.symbol}</b> Score:${s.total_score} ${ago}د\n`;
    txt+=s.decision==='APPROVE'
      ?`   ${s.direction} TP1:$${s.tp1?.toFixed(2)||'?'} x${s.leverage}\n\n`
      :`   ❌ ${(s.reject_reason||'').slice(0,35)}\n\n`;
  }
  await dash.send(txt);
}

async function _showSettings(bot, cid) {
  let balTxt='';
  try {
    const b=await bingx.getBalance();
    balTxt=`\n💰 الرصيد: $${b.balance.toFixed(4)}`;
  } catch {}
  await bot.sendMessage(cid,
    `⚙️ <b>الإعدادات</b>\nالوضع: ${_modeLabel()}${balTxt}\n\nوضع الفحص: ${global.getCurrentScanMode?.()|| 'AUTO'}`,
    {parse_mode:'HTML',...KB.modeKB});
}

async function _showBalance(bot, cid) {
  try {
    const b=await bingx.getBalance();
    await dash.send(`💰 <b>الرصيد</b>
وضع: ${b.mode}
رصيد: <b>$${b.balance.toFixed(4)}</b>
متاح: <b>$${b.available.toFixed(4)}</b>`);
  } catch(e) {
    await dash.send(`❌ فشل جلب الرصيد: ${e.message}`);
  }
}

async function _showErrors(bot, cid) {
  const errs=await db.getUnresolvedErrors();
  if (!errs.length) return dash.send('✅ لا أخطاء نشطة.');
  let txt=`🚨 <b>أخطاء نشطة (${errs.length})</b>\n\n`;
  for (const e of errs.slice(0,5))
    txt+=`🔴 <b>${e.source}</b>: ${e.message}\n${new Date(e.timestamp).toLocaleTimeString('ar-SA')}\n\n`;
  await dash.send(txt);
}

async function _showPerformance(bot, cid) {
  const week=await db.getWeeklyStats();
  if (!week.length) return dash.send('📈 لا توجد بيانات كافية.');
  const tot=week.reduce((a,s)=>({pnl:a.pnl+(s.net_pnl||0),fees:a.fees+(s.total_fees||0),t:a.t+(s.total_trades||0),w:a.w+(s.winning_trades||0)}),{pnl:0,fees:0,t:0,w:0});
  const wr=tot.t>0?((tot.w/tot.t)*100).toFixed(1):0;
  await dash.send(`📈 <b>تقرير الأسبوع</b>

💰 صافي: <b>${tot.pnl>=0?'+':''}$${tot.pnl.toFixed(4)}</b>
💸 رسوم: <b>$${tot.fees.toFixed(4)}</b>
📊 صفقات: <b>${tot.t}</b>  ✅ WR: <b>${wr}%</b>
📅 أيام: <b>${week.length}</b>
💹 متوسط/يوم: <b>$${week.length>0?(tot.pnl/week.length).toFixed(4):0}</b>`);
}

async function _showHelp(bot, cid) {
  await dash.send(
`📖 <b>AXOM دليل الاستخدام</b>

<b>القائمة الرئيسية:</b>
🚀 بدء يوم — تحديد رأس المال والـ Stop
📡 الحالة — حالة البوت والرصيد
🔄 صفقات — الصفقات المفتوحة حالياً
📊 إحصائيات — الأداء التاريخي
💡 اقتراحات — صفقات مقترحة تنتظر موافقتك
🔍 فرص السوق — آخر إشارات التحليل
⚙️ إعدادات — تغيير وضع التداول
🆘 مساعدة — هذه القائمة

<b>أوامر إضافية:</b>
/balance — رصيد الحساب المباشر
/performance — تقرير أسبوعي
/errors — الأخطاء النشطة
/scanmode — وضع الفحص (تلقائي/اقتراح/إيقاف)
/close_all — إغلاق طارئ لكل الصفقات

<b>💬 الدردشة:</b>
اكتب أي سؤال وسيرد AXOM بالعربية!`, KB.mainMenu);
}

async function _chatAI(bot, cid, text) {
  try {
    const [session,open,sa]=await Promise.all([db.getActiveSession(),db.getOpenTrades(),db.getDailyStats(1)]);
    const ctx={running:!!session,mode:process.env.BOT_MODE,balance:session?.current_balance,openTrades:open.length,todayPnL:sa[0]?.net_pnl||0,winRate:sa[0]?.win_rate||0};
    await db.saveChat('USER',text);
    const reply=await G.chatReply(text,ctx);
    await db.saveChat('BOT',reply);
    await dash.send(reply);
  } catch { await dash.send('عذراً، خطأ مؤقت.'); }
}

module.exports = { register };
