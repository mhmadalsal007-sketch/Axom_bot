/ ============================================================
// AXOM — AI Scoring Agent + Sequential Ranker
// Processes symbols one-by-one with 1.5s delay
// Logs each symbol analysis result
// ============================================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const A      = require('./analyzer');
const bingx  = require('../core/bingx');
const MT     = require('../core/marketTracker');
const logger = require('../utils/logger');
const { sleep, DELAY_MS } = bingx;

let model = null;

function initGemini() {
  if (model) return;
  const g = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  model = g.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
  });
}

const SYSTEM = `You are AXOM elite ICT/SMC analyst. Return ONLY valid JSON, no markdown.

SCORING WEIGHTS:
htf_bias:15 | sweep:20 | sms_body:20 | displacement:15 | fvg:15 | zone:10 | kill_zone:5
SMT_bonus:+15 | oi_up:+8 | volume_high:+7 | funding_ok:+5
PENALTIES: ranging:-999 | no_sweep:-999 | wick_sms:-20 | premium_long:-20 | discount_short:-20

RULES:
1. HTF RANGING = score 0, REJECT
2. No sweep = score 0, REJECT
3. SMS must be BODY close only — wick = REJECT
4. LONG only in Discount (<0.5 fib)
5. SHORT only in Premium (>0.5 fib)

LEVERAGE: score>=90→x45 | score>=85→x35 | score>=75→x25 | score>=60→x15 | else→REJECT

Return JSON only:
{"decision":"APPROVE|REJECT","score":0-115,"direction":"LONG|SHORT|null","leverage":10-50,"entry":number,"sl":number,"tp1":number,"tp2":number,"reject_reason":"string|null","summary":"1 line max","confidence":"HIGH|MEDIUM|LOW","smt":bool,"slippage":bool}`;

// ─── SCORE ONE SYMBOL ─────────────────────────────────────────
async function scoreSymbol(symbol) {
  logger.info('SCORER', `🔍 Analyzing ${symbol}...`);
  try {
    // Fetch all timeframes sequentially (not parallel)
    const c1m  = await bingx.getKlines(symbol, '1m', 60);  await sleep(300);
    const c5m  = await bingx.getKlines(symbol, '5m', 60);  await sleep(300);
    const c15m = await bingx.getKlines(symbol, '15m', 30); await sleep(300);
    const c1h  = await bingx.getKlines(symbol, '1h', 30);

    if (!c1h.length || !c5m.length) {
      logger.warn('SCORER', `${symbol} — no candle data, skipping`);
      return { symbol, score:0, decision:'REJECT', reject_reason:'No candle data' };
    }

    const price  = MT.getPrice(symbol) || c1m.at(-1)?.close || 0;
    const snap   = MT.getSnapshot(symbol);
    const kz     = A.getKillZone();
    const bias   = A.detectBias(c1h);
    const liqLvl = A.findLiqLevels(c15m);
    const sweep  = A.detectSweep(c5m, liqLvl.eqh, liqLvl.eql);
    const dir    = sweep.type === 'BULLISH_SWEEP' ? 'LONG' : sweep.type === 'BEARISH_SWEEP' ? 'SHORT' : null;
    const sms    = dir ? A.detectSMS(c5m, dir) : { detected:false };
    const disp   = A.checkDisplacement(c5m);
    const fvg    = dir ? A.detectFVG(c1m, dir) : { found:false };
    const atr    = A.calcATR(c1h);
    const vol    = A.analyzeVolume(c5m);
    const slp    = A.detectSlippage(c1m, liqLvl.eqh, liqLvl.eql);
    const high5  = Math.max(...c5m.slice(-5).map(c=>c.high));
    const low5   = Math.min(...c5m.slice(-5).map(c=>c.low));
    const zone   = dir ? A.checkZone(price, high5, low5, dir) : { zone:'UNKNOWN', fib:'N/A', valid:false };

    // SMT (separate request — with delay)
    await sleep(300);
    const compSym = symbol.includes('BTC') ? 'ETHUSDT' : 'BTCUSDT';
    const smt     = await A.detectSMT(symbol, compSym);

    // Gemini AI analysis
    if (!model) initGemini();
    const prompt = `${SYSTEM}

SYMBOL:${symbol} PRICE:${price} SESSION:${kz.zone}
HTF_BIAS:${bias} SWEEP:${sweep.swept?sweep.type:'NONE'} DIR:${dir||'NONE'}
SMS:${sms.detected?sms.type:'NONE'} DISP:${disp.strong?'STRONG':'WEAK'}(${disp.count})
FVG:${fvg.found?fvg.type:'NONE'} ZONE:${zone.zone}(fib:${zone.fib})
OI_CHG:${snap.oiChg1h}% FUNDING:${(snap.funding*100).toFixed(4)}% VOL:${vol.ratio}x LIQ:$${snap.liq1h}
ATR:${atr.toFixed(3)}% EQH:${liqLvl.eqh?.toFixed(2)} EQL:${liqLvl.eql?.toFixed(2)}
SMT:${smt.detected?smt.type:'NONE'} SLIPPAGE:${slp.detected?slp.type:'NONE'}
CANDLES_5M:${JSON.stringify(c5m.slice(-3).map(c=>({o:+c.open.toFixed(2),h:+c.high.toFixed(2),l:+c.low.toFixed(2),c:+c.close.toFixed(2)})))}

JSON only:`;

    const result = await model.generateContent(prompt);
    let text = result.response.text().trim().replace(/```json\n?|```\n?/g, '').trim();
    const ai = JSON.parse(text);
    ai.score  = Math.min(100, Math.max(0, ai.score || 0));
    ai.symbol = symbol;
    ai.atr    = atr;
    ai.kz     = kz;
    ai.liqLvl = liqLvl;
    ai.snap   = snap;

    // Log result
    if (ai.decision === 'APPROVE') {
      logger.info('SCORER', `✅ ${symbol} → APPROVE Score:${ai.score} ${ai.direction} x${ai.leverage}`);
    } else {
      logger.info('SCORER', `❌ ${symbol} → REJECT (${ai.reject_reason || 'low score'})`);
    }

    return ai;
  } catch (e) {
    logger.warn('SCORER', `${symbol} analysis error: ${e.message}`);
    return { symbol, score:0, decision:'REJECT', reject_reason:e.message };
  }
}

// ─── SEQUENTIAL RANKER — top 3 ────────────────────────────────
async function rankCandidates(candidates) {
  logger.info('SCORER', `Starting sequential scan of ${candidates.length} symbols...`);
  const scored = [];

  for (const sym of candidates) {
    const result = await scoreSymbol(sym);
    if (result.score > 0) scored.push(result);

    // 1.5s delay between symbols (rate limiting + human-like)
    await sleep(DELAY_MS);
  }

  scored.sort((a,b) => b.score - a.score);
  const top3     = scored.slice(0, 3);
  const approved = top3.filter(r => r.decision === 'APPROVE' && r.score >= 75);

  logger.info('SCORER', `Scan complete. Top: ${top3.map(t=>`${t.symbol}(${t.score})`).join(', ')}`);
  return { top3, best: approved[0] || null, allScored: scored };
}

// ─── LIQUIDITY SCORE ─────────────────────────────────────────
function calcLS(oiChg, volRatio, liq1h, funding) {
  const oiS  = oiChg>5?30:oiChg>3?22:oiChg>1?15:oiChg>0?8:0;
  const volS = volRatio>3?25:volRatio>2?20:volRatio>1.5?15:volRatio>1?8:0;
  const liqS = liq1h>10e6?25:liq1h>5e6?20:liq1h>1e6?15:liq1h>500000?8:3;
  const fR   = Math.abs(funding*100);
  const funS = fR<0.01?20:fR<0.03?15:fR<0.05?10:fR<0.1?5:0;
  return Math.min(100, oiS+volS+liqS+funS);
}

module.exports = { scoreSymbol, rankCandidates, calcLS, initGemini };
