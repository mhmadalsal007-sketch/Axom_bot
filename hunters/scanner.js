const B = require('../core/binance');
const A = require('../brain/analyzer');
const L = require('../brain/liquidity');
const G = require('../core/gemini');
const db = require('../core/database');

const oiCache = {}, liqCache = {};

// ─── MAIN SCAN ────────────────────────────────────────────────
async function scan(openTrades = []) {
  const skipSymbols = new Set(openTrades.map(t => t.symbol));

  try {
    const allSymbols = await B.getTopSymbols(40);
    const candidates = [];

    // Quick filter
    for (const sym of allSymbols) {
      if (skipSymbols.has(sym)) continue;
      try {
        const [oi, fund] = await Promise.all([B.getOI(sym), B.getFunding(sym)]);
        const prevOI = oiCache[sym] || oi;
        const oiChg = prevOI > 0 ? ((oi - prevOI) / prevOI) * 100 : 0;
        oiCache[sym] = oi;
        if (Math.abs(oiChg) > 0.3 && Math.abs(fund.fundingRate) < 0.0012)
          candidates.push({ sym, oi, oiChg, fund: fund.fundingRate });
      } catch { continue; }
    }

    if (!candidates.length) return null;
    candidates.sort((a,b) => Math.abs(b.oiChg) - Math.abs(a.oiChg));

    // Deep analyze top 5
    for (const c of candidates.slice(0,5)) {
      const result = await deepAnalyze(c, openTrades);
      if (result && result.decision === 'APPROVE' && result.score >= 75) return result;
    }
  } catch (e) {
    await db.saveError('SCAN','SYSTEM', e.message);
  }
  return null;
}

// ─── DEEP ANALYZE ────────────────────────────────────────────
async function deepAnalyze({ sym, oi, oiChg, fund }, openTrades) {
  try {
    // Fetch all timeframes in parallel
    const [c1m, c5m, c15m, c30m, c1h] = await Promise.all([
      B.getKlines(sym, '1m', 60),
      B.getKlines(sym, '5m', 60),
      B.getKlines(sym, '15m', 30),
      B.getKlines(sym, '30m', 20),
      B.getKlines(sym, '1h', 30)
    ]);

    const price = c1m[c1m.length-1].close;
    const kz = A.getKillZone();

    // Step 1: HTF Bias
    const bias = A.detectBias(c1h);
    if (bias === 'RANGING') return null;

    // Step 2+3: Liquidity levels
    const liqLvl = A.findLiquidityLevels(c15m);

    // Step 4: Sweep
    const sweep = A.detectSweep(c5m, liqLvl.eqh, liqLvl.eql);
    if (!sweep.swept) return null;

    const dir = sweep.type === 'BULLISH_SWEEP' ? 'LONG' : 'SHORT';
    if (bias === 'BULLISH' && dir !== 'LONG') return null;
    if (bias === 'BEARISH' && dir !== 'SHORT') return null;

    // Step 5: SMS
    const sms = A.detectSMS(c5m, dir);
    if (!sms.detected) return null;

    // Step 6: Displacement
    const disp = A.checkDisplacement(c5m);
    if (!disp.strong) return null;

    // Step 7: FVG
    const fvg = A.detectFVG(c1m, dir);

    // Step 8: Premium/Discount
    const high30m = Math.max(...c30m.slice(-5).map(c=>c.high));
    const low30m  = Math.min(...c30m.slice(-5).map(c=>c.low));
    const zone = A.checkZone(price, high30m, low30m, dir);

    // Step 9: Kill zone (handled by score)

    // Step 10: SMT Divergence
    const compSym = sym.includes('BTC') ? 'ETHUSDT' : 'BTCUSDT';
    const smt = await A.detectSMT(sym, compSym);

    // ATR & Volume
    const atr = A.calcATR(c1h);
    const vol = A.analyzeVolume(c5m);

    // Slippage hunt
    const slip = A.detectSlippageHunt(c1m, liqLvl.eqh, liqLvl.eql);

    // LS Score
    const ls = L.calcLS(oiChg, vol.ratio, liqCache[sym]||0, fund);
    const lsScore = ls.score;

    // Long/Short ratio
    const lsRatio = await B.getLSRatio(sym);

    // Wave type
    const waveType = L.getWaveType(lsScore, openTrades, 0);

    // Entry price
    const entry = fvg.found ? fvg.mid : price;
    const sl = dir === 'LONG'
      ? (slip.detected ? slip.sl : liqLvl.eql * 0.999)
      : (slip.detected ? slip.sl : liqLvl.eqh * 1.001);

    // Build data for Gemini
    const gData = {
      symbol: sym, session: kz.zone, price,
      htf_bias: bias, struct30m: 'confirmed',
      sweepDetected: 'YES', sweepType: sweep.type, sweepCandle: sweep.desc||'',
      smsDetected: 'YES', smsType: sms.type, smsTF: '5M',
      displacement: disp.desc||'STRONG',
      fvgPresent: fvg.found?'YES':'NO', fvgRange: fvg.found?`${fvg.low}-${fvg.high}`:'NONE',
      fvgMid: fvg.mid||price, zone: zone.zone, fibLevel: zone.fib||'0.5',
      oiChange: oiChg.toFixed(2), funding: (fund*100).toFixed(4),
      volRatio: vol.ratio, liq1h: liqCache[sym]||0, lsRatio,
      atr: atr.toFixed(3), killZone: kz.zone,
      smtSignal: smt.detected?smt.type:'NONE',
      btcAction: sym.includes('BTC')?'PRIMARY':(smt.desc||'N/A'),
      ethAction: sym.includes('ETH')?'PRIMARY':(smt.desc||'N/A'),
      eqh: liqLvl.eqh, eql: liqLvl.eql,
      candles5m: c5m, candles1m: c1m
    };

    const ai = await G.analyzeSignal(gData);

    // Save signal to DB
    await db.saveSignal({
      symbol: sym, decision: ai.decision, total_score: ai.score,
      sweep_score: 20, sms_score: 20, displacement_score: 15,
      fvg_score: fvg.found?15:0, kill_zone_score: kz.score||0,
      smt_score: smt.score||0, oi_bonus: oiChg>2?8:0,
      volume_bonus: vol.ratio>1.5?7:0, funding_bonus: Math.abs(fund)<0.0005?5:0,
      direction: ai.direction, entry_price: ai.entry_price||entry,
      stop_loss: ai.stop_loss||sl, tp1: ai.tp1, tp2: ai.tp2,
      leverage: ai.leverage, reject_reason: ai.reject_reason,
      gemini_analysis: ai.analysis, liquidity_momentum_score: lsScore,
      kill_zone: kz.zone, smt_type: smt.type||null
    });

    if (ai.decision !== 'APPROVE') return null;

    return {
      ...ai, symbol: sym,
      entry_price: ai.entry_price || entry,
      stop_loss: ai.stop_loss || sl,
      liquidity_score: lsScore,
      wave_type: waveType,
      atr, kill_zone: kz
    };
  } catch (e) {
    console.error(`deepAnalyze ${sym}:`, e.message);
    return null;
  }
}

function trackLiquidation(liq) {
  if (!liq?.symbol) return;
  liqCache[liq.symbol] = (liqCache[liq.symbol]||0) + (liq.value||0);
  setTimeout(() => { if (liqCache[liq.symbol]) liqCache[liq.symbol] = 0; }, 3600000);
}

module.exports = { scan, deepAnalyze, trackLiquidation };
