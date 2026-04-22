// ============================================================
// AXOM — ICT/SMC Analysis Engine
// Steps 1-10 including SMT Divergence
// ============================================================
const bingx = require('../core/bingx');

// ─── STEP 1: HTF BIAS ─────────────────────────────────────────
function detectBias(candles1h) {
  if (!candles1h || candles1h.length < 20) return 'RANGING';
  const c = candles1h.slice(-20);
  const sH = [], sL = [];
  for (let i = 2; i < c.length-2; i++) {
    if (c[i].high > c[i-1].high && c[i].high > c[i-2].high && c[i].high > c[i+1].high && c[i].high > c[i+2].high) sH.push(c[i].high);
    if (c[i].low  < c[i-1].low  && c[i].low  < c[i-2].low  && c[i].low  < c[i+1].low  && c[i].low  < c[i+2].low)  sL.push(c[i].low);
  }
  if (sH.length < 2 || sL.length < 2) return 'RANGING';
  const hh = sH.at(-1) > sH.at(-2), hl = sL.at(-1) > sL.at(-2);
  const lh = sH.at(-1) < sH.at(-2), ll = sL.at(-1) < sL.at(-2);
  if (hh && hl) return 'BULLISH';
  if (lh && ll) return 'BEARISH';
  return 'RANGING';
}

// ─── STEP 2: LIQUIDITY LEVELS ────────────────────────────────
function findLiqLevels(candles) {
  if (!candles || candles.length < 10) {
    const highs = (candles||[]).map(c=>c.high), lows = (candles||[]).map(c=>c.low);
    return { eqh: Math.max(...highs)||null, eql: Math.min(...lows)||null };
  }
  const tol = 0.001;
  let bestEQH = null, bestEQL = null;
  const highs = candles.map(c=>c.high), lows = candles.map(c=>c.low);
  for (let i=0;i<highs.length-1;i++)
    for (let j=i+2;j<highs.length;j++)
      if (Math.abs(highs[i]-highs[j])/highs[i]<tol && (!bestEQH||j-i>bestEQH.str))
        bestEQH = { price:(highs[i]+highs[j])/2, str:j-i };
  for (let i=0;i<lows.length-1;i++)
    for (let j=i+2;j<lows.length;j++)
      if (Math.abs(lows[i]-lows[j])/lows[i]<tol && (!bestEQL||j-i>bestEQL.str))
        bestEQL = { price:(lows[i]+lows[j])/2, str:j-i };
  return {
    eqh: bestEQH?.price || Math.max(...highs.slice(-10)),
    eql: bestEQL?.price || Math.min(...lows.slice(-10))
  };
}

// ─── STEP 3: LIQUIDITY SWEEP ─────────────────────────────────
function detectSweep(candles, eqh, eql) {
  if (!candles||candles.length<3) return { swept:false };
  for (const c of candles.slice(-6)) {
    if (eql && c.low < eql && c.close > eql)
      return { swept:true, type:'BULLISH_SWEEP', level:eql, desc:`EQL ${eql.toFixed(2)} swept` };
    if (eqh && c.high > eqh && c.close < eqh)
      return { swept:true, type:'BEARISH_SWEEP', level:eqh, desc:`EQH ${eqh.toFixed(2)} swept` };
  }
  return { swept:false };
}

// ─── STEP 4: SMS/MSS (body close only) ───────────────────────
function detectSMS(candles, dir) {
  if (!candles||candles.length<8) return { detected:false };
  const recent = candles.slice(-10);
  for (let i=recent.length-1;i>=3;i--) {
    const c = recent[i];
    if (dir==='LONG') {
      const swH = Math.max(...recent.slice(Math.max(0,i-5),i).map(x=>x.high));
      if (c.close>swH && c.open<swH) return { detected:true, type:'BODY_CLOSE', dir:'BULLISH', price:c.close };
    } else {
      const swL = Math.min(...recent.slice(Math.max(0,i-5),i).map(x=>x.low));
      if (c.close<swL && c.open>swL) return { detected:true, type:'BODY_CLOSE', dir:'BEARISH', price:c.close };
    }
  }
  return { detected:false };
}

// ─── STEP 5: DISPLACEMENT ────────────────────────────────────
function checkDisplacement(candles) {
  if (!candles||candles.length<5) return { strong:false };
  const last = candles.slice(-5);
  const avgR = last.reduce((s,c)=>s+(c.high-c.low),0)/last.length;
  let big=0;
  for (const c of last) {
    const body=Math.abs(c.close-c.open), range=c.high-c.low;
    const wick=range>0?(range-body)/range:1;
    if (body>avgR*0.55 && wick<0.4) big++;
  }
  return big>=2 ? { strong:true, count:big } : { strong:false, count:big };
}

// ─── STEP 6: FVG ─────────────────────────────────────────────
function detectFVG(candles, dir) {
  if (!candles||candles.length<3) return { found:false };
  for (let i=1;i<candles.length-1;i++) {
    const [c1,,c3]=[candles[i-1],candles[i],candles[i+1]];
    if (dir==='LONG'  && c1.high<c3.low)  return { found:true, type:'BULL', high:c3.low,  low:c1.high, mid:(c1.high+c3.low)/2 };
    if (dir==='SHORT' && c1.low>c3.high)  return { found:true, type:'BEAR', high:c1.low,  low:c3.high, mid:(c1.low+c3.high)/2 };
  }
  return { found:false };
}

// ─── STEP 7: PREMIUM/DISCOUNT ────────────────────────────────
function checkZone(price, dispHigh, dispLow, dir) {
  const range = dispHigh-dispLow;
  if (range<=0) return { valid:true, zone:'UNKNOWN', fib:'N/A' };
  const fib = (price-dispLow)/range;
  if (dir==='LONG')  return { valid:fib<0.5,  zone:fib<0.5?'DISCOUNT':'PREMIUM', fib:fib.toFixed(3) };
  if (dir==='SHORT') return { valid:fib>0.5,  zone:fib>0.5?'PREMIUM':'DISCOUNT', fib:fib.toFixed(3) };
  return { valid:true, zone:'UNKNOWN', fib:fib.toFixed(3) };
}

// ─── STEP 8: KILL ZONE ───────────────────────────────────────
function getKillZone() {
  const h=new Date().getUTCHours(), m=new Date().getUTCMinutes(), t=h+m/60;
  if (t>=8  && t<11) return { active:true, zone:'LONDON',    bonus:5  };
  if (t>=13 && t<16) return { active:true, zone:'NEW_YORK',  bonus:5  };
  if (t>=7  && t<8)  return { active:true, zone:'LON_OPEN',  bonus:2  };
  if (t>=12 && t<13) return { active:true, zone:'NY_OPEN',   bonus:2  };
  if (t>=0  && t<2)  return { active:true, zone:'ASIA',      bonus:1  };
  return { active:false, zone:'OFF_ZONE', bonus:-5 };
}

// ─── STEP 9: ATR & VOLUME ────────────────────────────────────
function calcATR(candles, period=14) {
  if (!candles||candles.length<period+1) return 0;
  let sum=0;
  for (let i=candles.length-period;i<candles.length;i++) {
    sum+=Math.max(candles[i].high-candles[i].low,
      Math.abs(candles[i].high-candles[i-1].close),
      Math.abs(candles[i].low-candles[i-1].close));
  }
  const atr=sum/period;
  return (atr/candles[candles.length-1].close)*100;
}
function analyzeVolume(candles, period=20) {
  if (!candles||candles.length<period) return { ratio:1 };
  const avg=candles.slice(-period-1,-1).reduce((s,c)=>s+c.volume,0)/period;
  const cur=candles.at(-1).volume;
  return { ratio:avg>0?parseFloat((cur/avg).toFixed(2)):1, avg, current:cur };
}

// ─── STEP 10: SMT DIVERGENCE ─────────────────────────────────
async function detectSMT(primarySym, compSym) {
  try {
    const [pC,cC] = await Promise.all([bingx.getKlines(primarySym,'5m',15), bingx.getKlines(compSym,'5m',15)]);
    if (!pC.length||!cC.length) return { detected:false, score:0 };
    const pL1=Math.min(...pC.slice(-8,-4).map(c=>c.low)),  pL2=Math.min(...pC.slice(-4).map(c=>c.low));
    const cL1=Math.min(...cC.slice(-8,-4).map(c=>c.low)),  cL2=Math.min(...cC.slice(-4).map(c=>c.low));
    const pH1=Math.max(...pC.slice(-8,-4).map(c=>c.high)), pH2=Math.max(...pC.slice(-4).map(c=>c.high));
    const cH1=Math.max(...cC.slice(-8,-4).map(c=>c.high)), cH2=Math.max(...cC.slice(-4).map(c=>c.high));
    if (pL2<pL1 && cL2>cL1) return { detected:true, type:'BULLISH_SMT', score:15, desc:`${primarySym} LL + ${compSym} HL` };
    if (pH2>pH1 && cH2<cH1) return { detected:true, type:'BEARISH_SMT', score:15, desc:`${primarySym} HH + ${compSym} LH` };
    return { detected:false, score:0 };
  } catch { return { detected:false, score:0 }; }
}

// ─── SLIPPAGE HUNT ───────────────────────────────────────────
function detectSlippage(candles, eqh, eql) {
  if (!candles||candles.length<2) return { detected:false };
  for (const c of candles.slice(-3)) {
    if (eql && c.low<eql && c.close>eql && (eql-c.low)/eql<0.003)
      return { detected:true, type:'BULL_HUNT', level:eql, suggestSL:c.low*0.9995 };
    if (eqh && c.high>eqh && c.close<eqh && (c.high-eqh)/eqh<0.003)
      return { detected:true, type:'BEAR_HUNT', level:eqh, suggestSL:c.high*1.0005 };
  }
  return { detected:false };
}

module.exports = {
  detectBias, findLiqLevels, detectSweep, detectSMS,
  checkDisplacement, detectFVG, checkZone, getKillZone,
  calcATR, analyzeVolume, detectSMT, detectSlippage
};
