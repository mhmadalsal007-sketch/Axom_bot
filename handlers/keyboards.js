// ============================================================
// AXOM v3 — Professional Keyboard System
// Grid layout like B4 Card — clean, organized, functional
// ============================================================

// ─── MAIN MENU (Reply Keyboard — always visible) ─────────────
const mainMenu = {
  reply_markup: {
    keyboard: [
      ['📊 الحالة',        '🚀 بدء يوم'],
      ['🔄 صفقاتي',       '💡 اقتراحات'],
      ['📈 تحليل السوق',  '📉 إحصائياتي'],
      ['⚙️ الإعدادات',    '🧠 وضع الذكاء'],
      ['🆘 الدعم']
    ],
    resize_keyboard: true,
    persistent: true,
  }
};

// ─── CAPITAL SELECTION ───────────────────────────────────────
const capitalKB = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '💵 $10',  callback_data: 'cap_10'  },
        { text: '💵 $25',  callback_data: 'cap_25'  },
        { text: '💵 $50',  callback_data: 'cap_50'  },
      ],
      [
        { text: '💵 $100', callback_data: 'cap_100' },
        { text: '💵 $250', callback_data: 'cap_250' },
        { text: '💵 $500', callback_data: 'cap_500' },
      ],
      [{ text: '✏️ مبلغ مخصص', callback_data: 'cap_custom' }],
    ]
  }
};

const stopKB = () => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🟢 20%', callback_data: 'stp_20' },
        { text: '🟡 40%', callback_data: 'stp_40' },
        { text: '🔴 60%', callback_data: 'stp_60' },
      ],
      [{ text: '✏️ نسبة مخصصة', callback_data: 'stp_custom' }],
    ]
  }
});

const confirmKB = (cap, stp) => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ تأكيد البدء', callback_data: `confirm_${cap}_${stp}` },
        { text: '❌ إلغاء',       callback_data: 'cancel' },
      ]
    ]
  }
});

const modeKB = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📝 تجريبي (PAPER)',       callback_data: 'mode_PAPER' }],
      [{ text: '🎮 ديمو BingX (VST)',     callback_data: 'mode_DEMO'  }],
      [{ text: '💰 حقيقي (REAL)',         callback_data: 'mode_REAL'  }],
    ]
  }
};

const confirmRealKB = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '⚠️ نعم، أموال حقيقية', callback_data: 'confirm_real' },
        { text: '❌ إلغاء',              callback_data: 'cancel'       },
      ]
    ]
  }
};

const scanModeKB = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🤖 تلقائي (AUTO)',          callback_data: 'scanmode_AUTO'    }],
      [{ text: '💡 اقتراح فقط (SUGGEST)',   callback_data: 'scanmode_SUGGEST' }],
      [{ text: '⏸️ إيقاف (OFF)',            callback_data: 'scanmode_OFF'     }],
    ]
  }
};

const suggestionKB = (id) => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ افتح الصفقة', callback_data: `sug_approve_${id}` },
        { text: '❌ تجاهل',       callback_data: `sug_reject_${id}`  },
      ]
    ]
  }
});

const statsKB = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📅 اليوم',   callback_data: 'stats_today' },
        { text: '📅 أسبوع',  callback_data: 'stats_week'  },
        { text: '📅 كل وقت', callback_data: 'stats_all'   },
      ]
    ]
  }
};

const confirmStopKB = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🛑 إيقاف البوت', callback_data: 'confirm_stop' },
        { text: '❌ إلغاء',        callback_data: 'cancel'       },
      ]
    ]
  }
};

const emergencyKB = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🚨 إغلاق كل الصفقات الآن', callback_data: 'emergency_close' },
        { text: '❌ إلغاء',                  callback_data: 'cancel'          },
      ]
    ]
  }
};

const profitLockKB = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '▶️ استمر في التداول', callback_data: 'continue_trading' },
        { text: '🔒 قفّل الأرباح',     callback_data: 'stop_trading'     },
      ]
    ]
  }
};

const aiModeKB = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🧠 تحليل فرصة',       callback_data: 'ai_scan'   },
        { text: '📊 تقرير ذكي',        callback_data: 'ai_report' },
      ],
      [{ text: '💬 استشر الذكاء الصناعي', callback_data: 'ai_chat' }]
    ]
  }
};

const dashboardKB = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🔄 تحديث',         callback_data: 'refresh_dash'    },
        { text: '🚨 إغلاق طارئ',   callback_data: 'emergency_close' },
      ]
    ]
  }
};

module.exports = {
  mainMenu, capitalKB, stopKB, confirmKB, modeKB, confirmRealKB,
  scanModeKB, suggestionKB, statsKB, confirmStopKB, emergencyKB,
  profitLockKB, aiModeKB, dashboardKB,
};
