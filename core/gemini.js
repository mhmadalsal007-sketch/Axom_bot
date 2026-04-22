const { GoogleGenerativeAI } = require('@google/generative-ai');
let model = null;

function init() {
  if (model) return;
  const g = new GoogleGenerativeAI(process.env.GEMINI_API_KEY||'');
  model = g.getGenerativeModel({ model:'gemini-1.5-flash', generationConfig:{ temperature:0.1, maxOutputTokens:600 } });
}

async function chatReply(msg, ctx) {
  if (!model) init();
  const prompt = `أنت AXOM بوت تداول ذكي. أجب بالعربية بإيجاز (2-3 جمل).
الحالة: ${JSON.stringify(ctx)}
سؤال: ${msg}`;
  try {
    const r = await model.generateContent(prompt);
    return r.response.text().trim();
  } catch (e) { return 'عذراً، خطأ مؤقت في الذكاء الاصطناعي.'; }
}

module.exports = { init, chatReply };
