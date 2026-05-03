// ============================================================
// AXOM v3 — Gemini AI Service
// Chat replies + High-opportunity deep analysis
// Called ONLY when score >= 80 (not on every scan)
// ============================================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
let model = null;

function init() {
  if (model) return;
  const g = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  model = g.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: { temperature: 0.15, maxOutputTokens: 800 }
  });
}

// ─── CHAT REPLY (conversational) ─────────────────────────────
async function chatReply(msg, ctx) {
  if (!model) init();
  const prompt =
`أنت AXOM، بوت تداول ذكي متخصص في ICT/SMC.
أجب بالعربية بوضوح وإيجاز (2-4 جمل).
لا تستخدم * أو # أو markdown.

حالة البوت:
- الوضع: ${ctx.mode}
- نشط: ${ctx.running ? 'نعم' : 'لا'}
- الرصيد: $${ctx.balance}
- صفقات مفتوحة: ${ctx.trades}
- وضع الفحص: ${ctx.scan}

سؤال المستخدم: ${msg}`;

  try {
    const r = await model.generateContent(prompt);
    return r.response.text().trim();
  } catch (e) {
    return 'عذراً، خطأ مؤقت في الذكاء الاصطناعي. حاول مجدداً.';
  }
}

// ─── DEEP ANALYSIS (high-score opportunities only) ──────────
// Called when score >= 80 — provides extra validation layer
async function deepAnalysis(signal) {
  if (!model) init();
  if ((signal.score || 0) < 80) return null; // not worth it for low scores

  const prompt =
`أنت محلل ICT/SMC خبير. هذه فرصة بنقاط عالية.
قيّمها بعمق وأعطِ رأياً حاسماً.
أجب بـ JSON فقط بدون markdown.

الفرصة:
- الرمز: ${signal.symbol}
- الاتجاه: ${signal.direction}
- النقاط: ${signal.score}
- الدخول: ${signal.entry}
- SL: ${signal.sl}
- TP1: ${signal.tp1} | TP2: ${signal.tp2}
- الجلسة: ${signal.kz?.zone || 'UNKNOWN'}
- OI Change: ${signal.snap?.oiChg1h || 0}%
- Funding: ${(+(signal.snap?.funding || 0) * 100).toFixed(4)}%
- SMT: ${signal.smt ? 'نعم' : 'لا'}
- الملخص: ${signal.summary || '-'}

أجب بـ JSON:
{"confirmed":true|false,"confidence":"HIGH|MEDIUM|LOW","adjusted_tp2":number,"risk_note":"جملة واحدة","final_verdict":"جملة واحدة"}`;

  try {
    const r    = await model.generateContent(prompt);
    const text = r.response.text().trim().replace(/```json\n?|```\n?/g, '').trim();
    return JSON.parse(text);
  } catch (e) {
    return null; // fail silently — don't block trade
  }
}

module.exports = { init, chatReply, deepAnalysis };
