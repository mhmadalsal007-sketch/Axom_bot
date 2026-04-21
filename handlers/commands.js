const db = require('../core/database');
const tg = require('../core/telegram');
const G = require('../core/gemini');
const { closeAll } = require('../trading/executor');
const B = require('../core/binance');

let _startBot, _stopBot;

function register(bot, startFn, stopFn) {
  _startBot = startFn;
  _stopBot = stopFn;

  // /start
  bot.onText(/\/start$/, async msg => {
    process.env.TELEGRAM_CHAT_ID = msg.chat.id.toString();
    await tg.sendText(`╔═══════════════════════╗
║    🤖 AXOM Trading Bot  ║
║    Elite ICT/SMC System ║
╚═══════════════════════╝

مرحباً بك في AXOM!
نظام تداول ذكي يعمل 24/7

<b>الأوامر الرئيسية:</b>
/start_day — بدء يوم تداول جديد
/status — حالة البوت الآن
/trades — الصفقات المفتوحة
/stats — إحصائيات الأداء
/market — أفضل الفرص الآن
/mode — تغيير وضع التداول
/close_all — إغلاق طارئ
/help — قائمة كل الأوامر

الوضع الحالي: ${process.env.BOT_MODE==='REAL'?'💰 حقيقي':'📝 تجريبي'}

اكتب أي سؤال وسأجيبك! 💬`);
  });

  // /start_day
  bot.onText(/\/start_day/, async msg => {
    await tg.sendText(`🌅 <b>بدء يوم تداول جديد</b>

أرسل الإعدادات بهذا الشكل:
<code>/begin [رأس المال] [ستوب %]</code>

أمثلة:
<code>/begin 5 60</code>  ← $5 رأس مال، 60% ستوب
<code>/begin 10 70</code> ← $10 رأس مال، 70% ستوب
<code>/begin 20 50</code> ← $20 رأس مال، 50% ستوب

⚠️ الحد الأدنى: $5
📊 الستوب: بين 10% و 90%`);
  });

  // /begin [capital] [stop%]
  bot.onText(/\/begin (\d+\.?\d*) (\d+\.?\d*)/, async (msg, match) => {
    const capital = parseFloat(match[1]);
    const stop = parseFloat(match[2]);
    if (capital < 5) { await tg.sendText('❌ الحد الأدنى لرأس المال $5'); return; }
    if (stop < 10 || stop > 90) { await tg.sendText('❌ الستوب بين 10% و 90%'); return; }
    await tg.sendText(`⏳ جاري تشغيل AXOM...

💰 رأس المال: <b>$${capital}</b>
🛑 Daily Stop: <b>${stop}% = $${(capital*stop/100).toFixed(2)}</b>
📝 الوضع: <b>${process.env.BOT_MODE==='REAL'?'حقيقي 💰':'تجريبي 📝'}</b>

🔍 يبحث عن فرص...`);
    await _startBot(capital, stop);
  });

  // /stop
  bot.onText(/\/stop/, async msg => {
    await _stopBot();
    await tg.sendText('🛑 <b>البوت توقف</b>\nأرسل /start_day لبدء يوم جديد.');
  });

  // /status
  bot.onText(/\/status/, async msg => {
    const session = await db.getActiveSession();
    const open = await db.getOpenTrades();
    const stats = (await db.getDailyStats(1))[0] || {};
    await tg.sendStatus(session, open, stats);
  });

  // /trades
  bot.onText(/\/trades/, async msg => {
    const open = await db.getOpenTrades();
    if (!open.length) { await tg.sendText('📭 لا توجد صفقات مفتوحة حالياً.'); return; }
    let text = `🔄 <b>الصفقات المفتوحة (${open.length})</b>\n\n`;
    for (const t of open) {
      const dir = t.direction === 'LONG' ? '🟢' : '🔴';
      const age = Math.round((Date.now() - new Date(t.opened_at).getTime()) / 60000);
      text += `${dir} <b>${t.symbol}</b> x${t.leverage}\n`;
      text += `📍 Entry: $${t.entry_price}  •  Score: ${t.score}\n`;
      text += `🎯 ${t.tp1_hit?'✅':'⬜'}TP1  ${t.tp2_hit?'✅':'⬜'}TP2  ⬜TP3\n`;
      text += `⏱️ منذ ${age} دقيقة  •  ${t.wave_type}\n\n`;
    }
    await tg.sendText(text);
  });

  // /stats
  bot.onText(/\/stats/, async msg => {
    const stats = await db.getDailyStats(7);
    if (!stats.length) { await tg.sendText('📊 لا توجد إحصائيات بعد.'); return; }
    let totalPnl = 0, totalT = 0, totalW = 0, totalF = 0;
    let text = '📊 <b>آخر 7 أيام</b>\n\n';
    for (const s of stats) {
      totalPnl += s.net_pnl||0; totalT += s.total_trades||0; totalW += s.winning_trades||0; totalF += s.total_fees||0;
      const icon = (s.net_pnl||0) >= 0 ? '✅' : '❌';
      text += `${icon} <b>${s.date}</b>: ${(s.net_pnl||0)>=0?'+':''}$${(s.net_pnl||0).toFixed(2)} | ${s.win_rate||0}% WR | ${s.total_trades||0} صفقة\n`;
    }
    text += `\n━━━━━━━━━━━━━━━━\n`;
    text += `💰 إجمالي صافي: <b>${totalPnl>=0?'+':''}$${totalPnl.toFixed(2)}</b>\n`;
    text += `💸 إجمالي رسوم: <b>$${totalF.toFixed(4)}</b>\n`;
    text += `📊 كل الصفقات: <b>${totalT}</b>\n`;
    text += `✅ Win Rate: <b>${totalT>0?((totalW/totalT)*100).toFixed(1):0}%</b>`;
    await tg.sendText(text);
  });

  // /market - best opportunities now
  bot.onText(/\/market/, async msg => {
    await tg.sendText('🔍 أفحص السوق الآن...');
    try {
      const signals = await db.getRecentSignals(5);
      if (!signals.length) { await tg.sendText('لا توجد إشارات حديثة.'); return; }
      let text = '📡 <b>آخر الإشارات</b>\n\n';
      for (const s of signals) {
        const icon = s.decision === 'APPROVE' ? '🟢' : '🔴';
        text += `${icon} <b>${s.symbol}</b>  Score: ${s.total_score}\n`;
        text += `${s.decision === 'APPROVE' ? `📍 ${s.direction} | TP1: $${s.tp1?.toFixed(2)||'N/A'}` : `❌ ${s.reject_reason||'Low score'}`}\n`;
        text += `⏰ ${new Date(s.created_at).toLocaleTimeString('ar-SA')}\n\n`;
      }
      await tg.sendText(text);
    } catch (e) { await tg.sendText('خطأ في جلب الإشارات.'); }
  });

  // /mode
  bot.onText(/\/mode/, async msg => {
    const cur = process.env.BOT_MODE || 'PAPER';
    await tg.sendText(`⚙️ <b>وضع التداول</b>

الوضع الحالي: <b>${cur === 'PAPER' ? '📝 تجريبي' : '💰 حقيقي'}</b>

${cur === 'PAPER' ? '/set_real — التحويل للوضع الحقيقي ⚠️' : '/set_paper — التحويل للوضع التجريبي'}

⚠️ الوضع الحقيقي يستخدم أموالاً فعلية!`);
  });

  bot.onText(/\/set_paper/, async msg => {
    process.env.BOT_MODE = 'PAPER';
    await db.updateSettings({ mode: 'PAPER' });
    await tg.sendText('✅ تم التحويل للوضع التجريبي 📝\nالصفقات الآن محاكاة فقط.');
  });

  bot.onText(/\/set_real/, async msg => {
    process.env.BOT_MODE = 'REAL';
    await db.updateSettings({ mode: 'REAL' });
    await tg.sendText('✅ تم التحويل للوضع الحقيقي 💰\n⚠️ كل الصفقات ستنفذ بأموال حقيقية!');
  });

  // /close_all
  bot.onText(/\/close_all/, async msg => {
    await tg.sendText('⏳ جاري إغلاق كل الصفقات...');
    await closeAll('MANUAL');
  });

  // /continue_trading
  bot.onText(/\/continue_trading/, async msg => {
    await tg.sendText('✅ استمر في التداول. كن حذراً!');
  });

  // /stop_trading
  bot.onText(/\/stop_trading/, async msg => {
    await _stopBot();
    await tg.sendText('🛑 توقف التداول. ربحك محمي. ✅');
  });

  // /errors
  bot.onText(/\/errors/, async msg => {
    const errs = await db.getUnresolvedErrors();
    if (!errs.length) { await tg.sendText('✅ لا توجد أخطاء غير محلولة.'); return; }
    let text = `🚨 <b>أخطاء نشطة (${errs.length})</b>\n\n`;
    for (const e of errs.slice(0,5)) {
      text += `🔴 <b>${e.source}</b>: ${e.message}\n`;
      text += `⏰ ${new Date(e.timestamp).toLocaleTimeString('ar-SA')}\n\n`;
    }
    await tg.sendText(text);
  });

  // /performance - detailed analysis
  bot.onText(/\/performance/, async msg => {
    const week = await db.getWeeklyStats();
    if (!week.length) { await tg.sendText('لا توجد بيانات كافية.'); return; }
    const total = week.reduce((acc, s) => ({
      pnl: acc.pnl + (s.net_pnl||0),
      fees: acc.fees + (s.total_fees||0),
      trades: acc.trades + (s.total_trades||0),
      wins: acc.wins + (s.winning_trades||0)
    }), { pnl:0, fees:0, trades:0, wins:0 });
    const wr = total.trades > 0 ? ((total.wins/total.trades)*100).toFixed(1) : 0;
    await tg.sendText(`📈 <b>تقرير الأسبوع</b>

💰 صافي الربح: <b>${total.pnl>=0?'+':''}$${total.pnl.toFixed(4)}</b>
💸 إجمالي الرسوم: <b>$${total.fees.toFixed(4)}</b>
📊 إجمالي الصفقات: <b>${total.trades}</b>
✅ Win Rate: <b>${wr}%</b>
📅 أيام التداول: <b>${week.length}</b>
💹 متوسط يومي: <b>${total.trades>0?(total.pnl/week.length).toFixed(4):0}</b>`);
  });

  // /help
  bot.onText(/\/help/, async msg => {
    await tg.sendText(`📖 <b>دليل AXOM الكامل</b>

<b>التشغيل:</b>
/start_day — بدء يوم جديد
/begin [مبلغ] [ستوب%] — تحديد الإعدادات
/stop — إيقاف البوت

<b>المراقبة:</b>
/status — حالة البوت
/trades — الصفقات المفتوحة
/market — آخر الإشارات
/stats — إحصائيات 7 أيام
/performance — تقرير أسبوعي
/errors — الأخطاء النشطة

<b>التحكم:</b>
/mode — وضع التداول
/set_paper — تجريبي
/set_real — حقيقي
/close_all — إغلاق طارئ
/continue_trading — استمر
/stop_trading — أوقف

<b>💬 الدردشة:</b>
اكتب أي سؤال بالعربية وسأجيبك!`);
  });

  // Chat - any non-command message
  bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    try {
      const [session, open, stats] = await Promise.all([
        db.getActiveSession(), db.getOpenTrades(), db.getDailyStats(1)
      ]);
      const ctx = {
        running: !!session, mode: process.env.BOT_MODE,
        balance: session?.current_balance, dailyHigh: session?.daily_high,
        openTrades: open.length, todayPnL: stats[0]?.net_pnl||0,
        winRate: stats[0]?.win_rate||0, totalTrades: stats[0]?.total_trades||0
      };
      await db.saveChatMessage('USER', msg.text);
      const reply = await G.chatReply(msg.text, ctx);
      await db.saveChatMessage('BOT', reply);
      await tg.sendText(reply);
    } catch { await tg.sendText('عذراً، حدث خطأ. حاول مجدداً.'); }
  });
}

module.exports = { register };
