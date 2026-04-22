// ============================================================
// AXOM — Keyboard Definitions
// All inline & reply keyboards in one place
// ============================================================

const mainMenu = { reply_markup:{ keyboard:[
  [{ text:'🚀 بدء يوم' },   { text:'📡 الحالة' }],
  [{ text:'🔄 صفقات' },     { text:'📊 إحصائيات' }],
  [{ text:'💡 اقتراحات' },  { text:'🔍 فرص السوق' }],
  [{ text:'⚙️ إعدادات' },   { text:'🆘 مساعدة' }]
], resize_keyboard:true, persistent:true }};

const capitalKB = { reply_markup:{ inline_keyboard:[
  [{ text:'$5',  callback_data:'cap_5'  }, { text:'$10', callback_data:'cap_10' }],
  [{ text:'$20', callback_data:'cap_20' }, { text:'$50', callback_data:'cap_50' }],
  [{ text:'✏️ مبلغ مخصص', callback_data:'cap_custom' }],
  [{ text:'❌ إلغاء',       callback_data:'cancel'     }]
]}};

function stopKB() { return { reply_markup:{ inline_keyboard:[
  [{ text:'10%', callback_data:'stp_10' }, { text:'30%', callback_data:'stp_30' }],
  [{ text:'50%', callback_data:'stp_50' }, { text:'60%', callback_data:'stp_60' }],
  [{ text:'70%', callback_data:'stp_70' }, { text:'80%', callback_data:'stp_80' }],
  [{ text:'✏️ نسبة مخصصة', callback_data:'stp_custom' }],
  [{ text:'❌ إلغاء',       callback_data:'cancel'     }]
]}}; }

function confirmKB(cap, stp) { return { reply_markup:{ inline_keyboard:[
  [{ text:`✅ ابدأ ($${cap} | ${stp}%)`, callback_data:`confirm_${cap}_${stp}` }],
  [{ text:'🔄 تغيير', callback_data:'change_settings' }, { text:'❌ إلغاء', callback_data:'cancel' }]
]}}; }

const modeKB = { reply_markup:{ inline_keyboard:[
  [{ text:'📝 تجريبي (Paper)',    callback_data:'mode_PAPER' }],
  [{ text:'🎮 ديمو (BingX Demo)', callback_data:'mode_DEMO'  }],
  [{ text:'💰 حقيقي ⚠️',          callback_data:'mode_REAL'  }],
  [{ text:'❌ إلغاء',              callback_data:'cancel'     }]
]}};

const confirmRealKB = { reply_markup:{ inline_keyboard:[
  [{ text:'⚠️ نعم، أعرف المخاطر', callback_data:'confirm_real_mode' }],
  [{ text:'❌ لا، ابقَ تجريبي',    callback_data:'cancel'            }]
]}};

const profitProtectKB = { reply_markup:{ inline_keyboard:[
  [{ text:'▶️ استمر في التداول',    callback_data:'continue_trading' }],
  [{ text:'🔒 أوقف وحافظ على الربح', callback_data:'stop_trading'   }]
]}};

const emergencyKB = { reply_markup:{ inline_keyboard:[
  [{ text:'🚨 إغلاق كل الصفقات', callback_data:'emergency_close' }],
  [{ text:'⏸️ إيقاف مؤقت',       callback_data:'pause_bot'       }],
  [{ text:'❌ إلغاء',              callback_data:'cancel'          }]
]}};

const confirmStopKB = { reply_markup:{ inline_keyboard:[
  [{ text:'✅ أوقف', callback_data:'confirm_stop' }, { text:'❌ إلغاء', callback_data:'cancel' }]
]}};

const statsPeriodKB = { reply_markup:{ inline_keyboard:[
  [{ text:'📅 اليوم', callback_data:'stats_today' }, { text:'📅 أسبوع', callback_data:'stats_week' }],
  [{ text:'📅 شهر',  callback_data:'stats_month' }, { text:'📅 الكل',  callback_data:'stats_all'  }],
  [{ text:'❌ إغلاق', callback_data:'cancel' }]
]}};

const scanModeKB = { reply_markup:{ inline_keyboard:[
  [{ text:'🤖 تلقائي (AUTO)',    callback_data:'scanmode_AUTO'   }],
  [{ text:'💡 اقتراح فقط (SUGGEST)', callback_data:'scanmode_SUGGEST' }],
  [{ text:'⏸️ إيقاف الفحص (OFF)',  callback_data:'scanmode_OFF'    }]
]}};

function suggestionKB(id) { return { reply_markup:{ inline_keyboard:[
  [{ text:'✅ أوافق — نفّذ الصفقة', callback_data:`sug_approve_${id}` }],
  [{ text:'❌ ارفض',                  callback_data:`sug_reject_${id}`  }]
]}}; }

module.exports = {
  mainMenu, capitalKB, stopKB, confirmKB,
  modeKB, confirmRealKB, profitProtectKB,
  emergencyKB, confirmStopKB, statsPeriodKB,
  scanModeKB, suggestionKB
};
