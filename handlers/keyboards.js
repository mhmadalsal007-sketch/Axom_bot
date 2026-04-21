// ============================================================
// AXOM — Keyboard Builder
// All inline keyboards for the bot
// ============================================================

// ─── MAIN MENU ───────────────────────────────────────────────
const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: '🚀 بدء يوم جديد' }, { text: '📡 الحالة' }],
      [{ text: '🔄 الصفقات' }, { text: '📊 الإحصائيات' }],
      [{ text: '🔍 فرص السوق' }, { text: '📈 الأداء' }],
      [{ text: '⚙️ الإعدادات' }, { text: '🆘 مساعدة' }]
    ],
    resize_keyboard: true,
    persistent: true
  }
};

// ─── START DAY FLOW ──────────────────────────────────────────
const startDayMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '💰 $5', callback_data: 'capital_5' }, { text: '💰 $10', callback_data: 'capital_10' }],
      [{ text: '💰 $20', callback_data: 'capital_20' }, { text: '💰 $50', callback_data: 'capital_50' }],
      [{ text: '✏️ أدخل مبلغ مخصص', callback_data: 'capital_custom' }],
      [{ text: '❌ إلغاء', callback_data: 'cancel' }]
    ]
  }
};

function stopMenu(capital) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛑 10%', callback_data: `stop_10` }, { text: '🛑 30%', callback_data: `stop_30` }],
        [{ text: '🛑 50%', callback_data: `stop_50` }, { text: '🛑 60%', callback_data: `stop_60` }],
        [{ text: '🛑 70%', callback_data: `stop_70` }, { text: '🛑 80%', callback_data: `stop_80` }],
        [{ text: '✏️ نسبة مخصصة', callback_data: 'stop_custom' }],
        [{ text: '❌ إلغاء', callback_data: 'cancel' }]
      ]
    }
  };
}

// ─── CONFIRM START ───────────────────────────────────────────
function confirmStart(capital, stop) {
  const stopAmount = (capital * stop / 100).toFixed(2);
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `✅ تأكيد البدء`, callback_data: `confirm_start_${capital}_${stop}` }],
        [{ text: '🔄 تغيير الإعدادات', callback_data: 'change_settings' }],
        [{ text: '❌ إلغاء', callback_data: 'cancel' }]
      ]
    }
  };
}

// ─── MODE MENU ───────────────────────────────────────────────
const modeMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📝 تجريبي (آمن)', callback_data: 'set_mode_PAPER' }],
      [{ text: '💰 حقيقي ⚠️', callback_data: 'set_mode_REAL' }],
      [{ text: '❌ إلغاء', callback_data: 'cancel' }]
    ]
  }
};

// ─── CONFIRM REAL MODE ───────────────────────────────────────
const confirmRealMode = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '⚠️ نعم، أفهم المخاطر', callback_data: 'confirm_real_mode' }],
      [{ text: '❌ لا، ابقَ تجريبي', callback_data: 'cancel' }]
    ]
  }
};

// ─── PROFIT PROTECTION ───────────────────────────────────────
const profitProtectionMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '▶️ استمر في التداول', callback_data: 'continue_trading' }],
      [{ text: '🔒 أوقف وحافظ على الربح', callback_data: 'stop_trading' }]
    ]
  }
};

// ─── EMERGENCY ───────────────────────────────────────────────
const emergencyMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🚨 إغلاق كل الصفقات الآن', callback_data: 'emergency_close' }],
      [{ text: '⏸️ إيقاف مؤقت', callback_data: 'pause_bot' }],
      [{ text: '❌ إلغاء', callback_data: 'cancel' }]
    ]
  }
};

// ─── SETTINGS MENU ───────────────────────────────────────────
const settingsMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔄 تغيير وضع التداول', callback_data: 'change_mode' }],
      [{ text: '📊 إعدادات المخاطرة', callback_data: 'risk_settings' }],
      [{ text: '🚫 قائمة الحظر', callback_data: 'blacklist' }],
      [{ text: '🔑 API Keys', callback_data: 'api_settings' }],
      [{ text: '❌ إغلاق', callback_data: 'cancel' }]
    ]
  }
};

// ─── STOP BOT CONFIRM ────────────────────────────────────────
const confirmStop = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '✅ نعم، أوقف البوت', callback_data: 'confirm_stop' }],
      [{ text: '❌ لا، استمر', callback_data: 'cancel' }]
    ]
  }
};

// ─── STATS PERIOD ────────────────────────────────────────────
const statsPeriodMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📅 اليوم', callback_data: 'stats_today' }, { text: '📅 أسبوع', callback_data: 'stats_week' }],
      [{ text: '📅 شهر', callback_data: 'stats_month' }, { text: '📅 كل الوقت', callback_data: 'stats_all' }],
      [{ text: '❌ إغلاق', callback_data: 'cancel' }]
    ]
  }
};

module.exports = {
  mainMenu, startDayMenu, stopMenu, confirmStart,
  modeMenu, confirmRealMode, profitProtectionMenu,
  emergencyMenu, settingsMenu, confirmStop, statsPeriodMenu
};
