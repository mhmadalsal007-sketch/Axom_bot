# 🤖 AXOM Trading Bot v2.0
**Elite Autonomous ICT/SMC Crypto Trading System**

---

## 📋 قبل البدء — اجمع هذه المعلومات:

| المعلومة | من أين | المتغير |
|----------|--------|---------|
| Telegram Bot Token | @BotFather | `TELEGRAM_BOT_TOKEN` |
| Telegram Chat ID | @userinfobot | `TELEGRAM_CHAT_ID` |
| Supabase URL | supabase.com → Settings | `SUPABASE_URL` |
| Supabase Service Key | supabase.com → Settings → API | `SUPABASE_SERVICE_KEY` |
| Binance API Key | binance.com → API Management | `BINANCE_API_KEY` |
| Binance Secret | binance.com → API Management | `BINANCE_SECRET_KEY` |
| Gemini API Key | aistudio.google.com | `GEMINI_API_KEY` |

---

## 🚀 خطوات الإعداد:

### 1. Supabase
1. اذهب لـ [supabase.com](https://supabase.com) → New Project → اسم: `axom`
2. انتظر حتى يكتمل الإنشاء (دقيقتان)
3. SQL Editor → New Query → الصق محتوى `database/schema.sql` → Run
4. Settings → API → انسخ:
   - Project URL → `SUPABASE_URL`
   - service_role (secret) → `SUPABASE_SERVICE_KEY`

### 2. Telegram Bot
1. افتح @BotFather في تيليغرام
2. أرسل `/newbot`
3. اسم البوت: `Axom Trading`
4. Username: `AxomTradeBot` (أو أي اسم متاح)
5. انسخ الـ Token → `TELEGRAM_BOT_TOKEN`
6. افتح @userinfobot → أرسل أي رسالة → انسخ الـ ID → `TELEGRAM_CHAT_ID`

### 3. Binance API
1. binance.com → Profile → API Management → Create API
2. اسم: `Axom`
3. فعّل: ✅ Enable Reading ✅ Enable Futures
4. لا تفعّل: ❌ Enable Withdrawals
5. بعد رفع المشروع على Render، أضف IP الـ Render للـ IP Restriction
6. انسخ API Key + Secret

### 4. Gemini AI
1. اذهب لـ [aistudio.google.com](https://aistudio.google.com)
2. Get API Key → Create API Key (مجاني)
3. انسخ → `GEMINI_API_KEY`

### 5. GitHub
```bash
git init
git add .
git commit -m "AXOM Bot v2.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/axom-bot.git
git push -u origin main
```

### 6. Render
1. اذهب لـ [render.com](https://render.com) → New → Web Service
2. Connect GitHub → اختر `axom-bot`
3. الإعدادات:
   - **Name**: axom-bot
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Plan**: Free
4. Environment Variables → أضف:
```
TELEGRAM_BOT_TOKEN = xxx
TELEGRAM_CHAT_ID   = xxx
SUPABASE_URL       = xxx
SUPABASE_SERVICE_KEY = xxx
BINANCE_API_KEY    = xxx
BINANCE_SECRET_KEY = xxx
GEMINI_API_KEY     = xxx
BOT_MODE           = PAPER
NODE_ENV           = production
PORT               = 3000
```
5. Deploy!
6. انسخ الـ URL (مثل: `https://axom-bot.onrender.com`)

### 7. UptimeRobot (إبقاء البوت مستيقظاً)
1. اذهب لـ [uptimerobot.com](https://uptimerobot.com) → Register → New Monitor
2. Type: HTTP(s)
3. URL: `https://axom-bot.onrender.com/health`
4. Interval: Every 5 minutes
5. Create!

---

## 📱 الأوامر في Telegram:

| الأمر | الوظيفة |
|-------|---------|
| `/start` | رسالة ترحيب |
| `/start_day` | بدء يوم تداول |
| `/begin 10 60` | ابدأ بـ $10، ستوب 60% |
| `/stop` | إيقاف البوت |
| `/status` | حالة البوت الآن |
| `/trades` | الصفقات المفتوحة |
| `/stats` | إحصائيات 7 أيام |
| `/market` | آخر الإشارات |
| `/performance` | تقرير أسبوعي |
| `/errors` | الأخطاء النشطة |
| `/mode` | تغيير الوضع |
| `/set_paper` | وضع تجريبي |
| `/set_real` | وضع حقيقي ⚠️ |
| `/close_all` | إغلاق طارئ |
| `/help` | قائمة الأوامر |

---

## 📊 كيف يعمل البوت:

```
كل 30 ثانية:
1. يفحص Top 40 عملة
2. يصفي بـ OI + Funding
3. يحلل ICT/SMC (HTF→Sweep→SMS→Displacement→FVG)
4. يتحقق من SMT Divergence
5. Gemini AI يقرر ويحسب Score
6. Score ≥ 75 → يفتح صفقة
7. يتابع TP1→TP2→TP3 Trailing
8. يسكر ويبحث عن فرصة جديدة

كل 10 ثواني:
- يراقب الصفقات المفتوحة
- يحرك الـ SL عند كل TP
- يتحقق من Trailing Stop

كل 5 دقائق:
- يرسل تحديث دوري على Telegram
```

---

## ⚠️ تحذيرات مهمة:
- **ابدأ دائماً بـ PAPER mode**
- اختبر أسبوعين على الأقل قبل REAL
- لا تخاطر بأكثر من 5% من رأس مالك الكلي يومياً
- التداول ينطوي على مخاطر عالية

---

## 🛠️ هيكل المشروع:
```
axom-bot/
├── index.js          ← نقطة البداية
├── package.json
├── .env.example      ← نموذج المتغيرات
├── database/
│   └── schema.sql    ← قاعدة البيانات
├── core/
│   ├── binance.js    ← Binance API
│   ├── database.js   ← Supabase
│   ├── gemini.js     ← AI Analysis
│   └── telegram.js   ← إشعارات
├── brain/
│   ├── analyzer.js   ← ICT/SMC + SMT
│   └── liquidity.js  ← Liquidity Score
├── trading/
│   ├── risk.js       ← إدارة المخاطر
│   └── executor.js   ← التنفيذ
├── hunters/
│   └── scanner.js    ← فحص السوق
└── handlers/
    └── commands.js   ← أوامر Telegram
```
