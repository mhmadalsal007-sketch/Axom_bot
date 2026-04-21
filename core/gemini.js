const { GoogleGenerativeAI } = require('@google/generative-ai');

let model = null;

function init() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash', generationConfig: { temperature: 0.1, maxOutputTokens: 1024 } });
}

const ICT_SYSTEM = `You are AXOM — elite ICT/SMC quantitative analyst for a crypto futures trading bot.
Return ONLY valid JSON. No markdown. No explanation outside JSON.

SCORING (max 100 base + bonuses):
HTF_BIAS:15 | STRUCTURE:10 | SWEEP:20 | SMS_BODY:20 | DISPLACEMENT:15 | FVG:15 | PREMIUM_DISCOUNT:10 | KILL_ZONE:5
SMT_DIVERGENCE_BONUS:+15 | OI_SUPPORT:+8 | VOLUME_HIGH:+7 | FUNDING_OK:+5
PENALTIES: ranging_htf:-20 | sms_wick_only:-20 | no_sweep:-30 | premium_long:-20 | discount_short:-20 | weak_displacement:-10

LEVERAGE: score>=90→x40-50 | score>=85→x30-39 | score>=75→x20-29 | score>=60→x10-19 | score<60→REJECT

ABSOLUTE RULES:
1. NO trade if HTF is RANGING
2. NO trade without confirmed Liquidity Sweep
3. SMS MUST be body close — wick = REJECT
4. LONG only in Discount zone (<0.5 fib)
5. SHORT only in Premium zone (>0.5 fib)
6. Displacement must be 2+ large candles with small wicks`;

async function analyzeSignal(data) {
  if (!model) init();
  const prompt = `${ICT_SYSTEM}

DATA:
symbol:${data.symbol} | time:${data.session} | price:${data.price}
htf_1h:${data.htf_bias} | structure_30m:${data.struct30m}
sweep:${data.sweepDetected} type:${data.sweepType} candle:${data.sweepCandle}
sms:${data.smsDetected} type:${data.smsType} tf:${data.smsTF}
displacement:${data.displacement}
fvg:${data.fvgPresent} range:${data.fvgRange} mid:${data.fvgMid}
zone:${data.zone} fib:${data.fibLevel}
oi_change_1h:${data.oiChange}% | funding:${data.funding}% | volume:${data.volRatio}x | liq_1h:$${data.liq1h} | ls_ratio:${data.lsRatio}
atr:${data.atr}% | kill_zone:${data.killZone}
smt:${data.smtSignal} | btc:${data.btcAction} | eth:${data.ethAction}
eqh:${data.eqh} | eql:${data.eql}
candles_5m_last3:${JSON.stringify(data.candles5m?.slice(-3))}
candles_1m_last3:${JSON.stringify(data.candles1m?.slice(-3))}

Return JSON:
{"decision":"APPROVE|REJECT","score":0-115,"direction":"LONG|SHORT|null","leverage":10-50|null,"entry_price":number|null,"stop_loss":number|null,"tp1":number|null,"tp2":number|null,"tp3":number|null,"rr":"string","wave_type":"RIDER|SURFER|CATCHER","smt_detected":bool,"slippage_hunt":bool,"reject_reason":"string|null","analysis":"1 sentence summary","confidence":"HIGH|MEDIUM|LOW"}`;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const parsed = JSON.parse(text);
    // Cap score at 100 for display
    parsed.score = Math.min(parsed.score || 0, 100);
    return parsed;
  } catch (e) {
    return { decision:'REJECT', score:0, direction:null, leverage:null, reject_reason:`AI error: ${e.message}`, analysis:'Analysis failed', confidence:'LOW' };
  }
}

async function chatReply(userMsg, context) {
  if (!model) init();
  const prompt = `أنت AXOM، بوت تداول ذكي. أجب بالعربية بإيجاز (جملتين أو ثلاث فقط).

الحالة الحالية:
${JSON.stringify(context)}

سؤال المستخدم: ${userMsg}`;
  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) {
    return 'عذراً، حدث خطأ مؤقت. حاول مجدداً.';
  }
}

module.exports = { init, analyzeSignal, chatReply };
