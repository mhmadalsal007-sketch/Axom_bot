const { getKlines } = require('../core/binance');

// ─── HTF BIAS ────────────────────────────────────────────────
function detectBias(candles) {
  if (!candles || candles.length < 20) return 'RANGING';
  const c = candles.slice(-20);
  const swingH = [], swingL = [];
  for (let i = 2; i < c.length - 2; i++) {
    if (c[i].high > c[i-1].high && c[i].high > c[i-2].high && c[i].high > c[i+1].high && c[i].high > c[i+2].high)
      swingH.push(c[i].high);
    if (c[i].low < c[i-1].low && c[i].low < c[i-2].low && c[i].low < c[i+1].low && c[i].low < c[i+2].low)
      swingL.push(c[i].low);
  }
  if (swingH.length < 2 || swingL.length < 2) return 'RANGING';
  const hh = swingH[swingH.length-1] > swingH[swingH.length-2];
  const hl = swingL[swingL.length-1] > swingL[swingL.length-2];
  const lh = swingH[swingH.length-1] < swingH[swingH.length-2];
  const ll = swingL[swingL.length-1] < swingL[swingL.length-2];
  if (hh && hl) return 'BULLISH';
  if (lh && ll) return 'BEARISH';
  return 'RANGING';
}

// ─── LIQUIDITY LEVELS ────────────────────────────────────────
function findLiquidityLevels(candles) {
  if (!candles || candles.length < 10) return { eqh: null, eql: null };
  const tol = 0.0008;
  let bestEQH = null, bestEQL = null;
  const highs = candles.map(c => c.high);
  const lows  = candles.map(c => c.low);
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 2; j < highs.length; j++) {
      if (Math.abs(highs[i] - highs[j]) / highs[i] < tol) {
        if (!bestEQH || j - i > bestEQH.strength)
          bestEQH = { price: (highs[i] + highs[j]) / 2, strength: j - i };
      }
    }
  }
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 2; j < lows.length; j++) {
      if (Math.abs(lows[i] - lows[j]) / lows[i] < tol) {
        if (!bestEQL || j - i > bestEQL.strength)
          bestEQL = { price: (lows[i] + lows[j]) / 2, strength: j - i };
      }
    }
  }
  return {
    eqh: bestEQH?.price || Math.max(...highs.slice(-10)),
    eql: bestEQL?.price || Math.min(...lows.slice(-10))
  };
}

// ─── LIQUIDITY SWEEP ─────────────────────────────────────────
function detectSweep(candles, eqh, eql) {
  if (!candles || candles.length < 3) return { swept: false };
  const last = candles.slice(-6);
  for (const c of last) {
    if (eql && c.low < eql && c.close > eql)
      return { swept: true, type: 'BULLISH_SWEEP', level: eql, desc: `Sweep EQL ${eql.toFixed(2)}, close ${c.close.toFixed(2)}` };
    if (eqh && c.high > eqh && c.close < eqh)
      return { swept: true, type: 'BEARISH_SWEEP', level: eqh, desc: `Sweep EQH ${eqh.toFixed(2)}, close ${c.close.toFixed(2)}` };
  }
  return { swept: false };
}

// ─── SMS / MSS (body close only) ─────────────────────────────
function detectSMS(candles, direction) {
  if (!candles || candles.length < 8) return { detected: false };
  const recent = candles.slice(-10);
  for (let i = recent.length - 1; i >= 3; i--) {
    const c = recent[i];
    if (direction === 'LONG') {
      const swH = Math.max(...recent.slice(Math.max(0,i-5), i).map(x => x.high));
      if (c.close > swH && c.open < swH)
        return { detected: true, type: 'BODY_CLOSE', direction: 'BULLISH', price: c.close, desc: `Body close above ${swH.toFixed(2)}` };
    } else {
      const swL = Math.min(...recent.slice(Math.max(0,i-5), i).map(x => x.low));
      if (c.close < swL && c.open > swL)
        return { detected: true, type: 'BODY_CLOSE', direction: 'BEARISH', price: c.close, desc: `Body close below ${swL.toFixed(2)}` };
    }
  }
  return { detected: false };
}

// ─── DISPLACEMENT ────────────────────────────────────────────
function checkDisplacement(candles) {
  if (!candles || candles.length < 5) return { strong: false };
  const last = candles.slice(-5);
  const avgR = last.reduce((s,c) => s + (c.high - c.low), 0) / last.length;
  let big = 0;
  for (const c of last) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const wick = range > 0 ? (range - body) / range : 1;
    if (body > avgR * 0.55 && wick < 0.4) big++;
  }
  return big >= 2
    ? { strong: true, desc: `${big} displacement candles` }
    : { strong: false, desc: `Only ${big} large candles` };
}

// ─── FVG ─────────────────────────────────────────────────────
function detectFVG(candles, direction) {
  if (!candles || candles.length < 3) return { found: false };
  for (let i = 1; i < candles.length - 1; i++) {
    const [c1, , c3] = [candles[i-1], candles[i], candles[i+1]];
    if (direction === 'LONG' && c1.high < c3.low) {
      const mid = (c1.high + c3.low) / 2;
      return { found: true, type: 'BULLISH', high: c3.low, low: c1.high, mid, desc: `FVG ${c1.high.toFixed(2)}-${c3.low.toFixed(2)}` };
    }
    if (direction === 'SHORT' && c1.low > c3.high) {
      const mid = (c1.low + c3.high) / 2;
      return { found: true, type: 'BEARISH', high: c1.low, low: c3.high, mid, desc: `FVG ${c3.high.toFixed(2)}-${c1.low.toFixed(2)}` };
    }
  }
  return { found: false };
}

// ─── PREMIUM / DISCOUNT ──────────────────────────────────────
function checkZone(price, dispHigh, dispLow, direction) {
  const range = dispHigh - dispLow;
  if (range <= 0) return { valid: true, zone: 'UNKNOWN', fib: '0.5' };
  const fib = (price - dispLow) / range;
  const inDiscount = fib < 0.5, inPremium = fib > 0.5;
  if (direction === 'LONG')
    return { valid: inDiscount, zone: inDiscount?'DISCOUNT':'PREMIUM', fib: fib.toFixed(3) };
  return { valid: inPremium, zone: inPremium?'PREMIUM':'DISCOUNT', fib: fib.toFixed(3) };
}

// ─── KILL ZONE ───────────────────────────────────────────────
function getKillZone() {
  const h = new Date().getUTCHours(), m = new Date().getUTCMinutes();
  const t = h + m/60;
  if (t >= 8 && t < 11)  return { active: true, zone: 'LONDON', score: 5 };
  if (t >= 13 && t < 16) return { active: true, zone: 'NY', score: 5 };
  if (t >= 7 && t < 8)   return { active: true, zone: 'LONDON_OPEN', score: 2 };
  if (t >= 12 && t < 13) return { active: true, zone: 'NY_OPEN', score: 2 };
  if (t >= 0 && t < 2)   return { active: true, zone: 'ASIA', score: 1 };
  return { active: false, zone: 'OFF', score: -5 };
}

// ─── SMT DIVERGENCE ──────────────────────────────────────────
async function detectSMT(primarySym, compSym) {
  try {
    const [pC, cC] = await Promise.all([
      getKlines(primarySym, '5m', 15),
      getKlines(compSym, '5m', 15)
    ]);
    if (!pC || !cC) return { detected: false, score: 0 };
    const pL1 = Math.min(...pC.slice(-8,-4).map(c=>c.low));
    const pL2 = Math.min(...pC.slice(-4).map(c=>c.low));
    const cL1 = Math.min(...cC.slice(-8,-4).map(c=>c.low));
    const cL2 = Math.min(...cC.slice(-4).map(c=>c.low));
    const pH1 = Math.max(...pC.slice(-8,-4).map(c=>c.high));
    const pH2 = Math.max(...pC.slice(-4).map(c=>c.high));
    const cH1 = Math.max(...cC.slice(-8,-4).map(c=>c.high));
    const cH2 = Math.max(...cC.slice(-4).map(c=>c.high));
    if (pL2 < pL1 && cL2 > cL1)
      return { detected: true, type: 'BULLISH_SMT', score: 15, desc: `${primarySym} LL + ${compSym} HL` };
    if (pH2 > pH1 && cH2 < cH1)
      return { detected: true, type: 'BEARISH_SMT', score: 15, desc: `${primarySym} HH + ${compSym} LH` };
    return { detected: false, score: 0 };
  } catch { return { detected: false, score: 0 }; }
}

// ─── ATR ─────────────────────────────────────────────────────
function calcATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return 0;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low - candles[i-1].close)
    );
    sum += tr;
  }
  const atr = sum / period;
  return (atr / candles[candles.length-1].close) * 100;
}

// ─── VOLUME ──────────────────────────────────────────────────
function analyzeVolume(candles, period = 20) {
  if (!candles || candles.length < period) return { ratio: 1, aboveAvg: false };
  const avg = candles.slice(-period-1, -1).reduce((s,c) => s + c.volume, 0) / period;
  const cur = candles[candles.length-1].volume;
  const ratio = avg > 0 ? cur / avg : 1;
  return { ratio: parseFloat(ratio.toFixed(2)), avg, current: cur, aboveAvg: ratio > 1.5 };
}

// ─── SLIPPAGE HUNT ───────────────────────────────────────────
function detectSlippageHunt(candles, eqh, eql) {
  if (!candles || candles.length < 2) return { detected: false };
  const last = candles.slice(-3);
  for (const c of last) {
    if (eql && c.low < eql && c.close > eql && (eql - c.low)/eql < 0.003)
      return { detected: true, type: 'BULLISH_HUNT', level: eql, sl: c.low * 0.9995, desc: `Hunt below EQL ${eql.toFixed(2)}` };
    if (eqh && c.high > eqh && c.close < eqh && (c.high - eqh)/eqh < 0.003)
      return { detected: true, type: 'BEARISH_HUNT', level: eqh, sl: c.high * 1.0005, desc: `Hunt above EQH ${eqh.toFixed(2)}` };
  }
  return { detected: false };
}

module.exports = {
  detectBias, findLiquidityLevels, detectSweep,
  detectSMS, checkDisplacement, detectFVG,
  checkZone, getKillZone, detectSMT,
  calcATR, analyzeVolume, detectSlippageHunt
};
