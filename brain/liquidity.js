// ─── LIQUIDITY MOMENTUM SCORE (0-100) ────────────────────────
function calcLS(oiChange, volRatio, liq1h, funding) {
  const oiS = oiChange > 5 ? 30 : oiChange > 3 ? 22 : oiChange > 1 ? 15 : oiChange > 0 ? 8 : 0;
  const volS = volRatio > 3 ? 25 : volRatio > 2 ? 20 : volRatio > 1.5 ? 15 : volRatio > 1 ? 8 : 0;
  const liqS = liq1h > 10e6 ? 25 : liq1h > 5e6 ? 20 : liq1h > 1e6 ? 15 : liq1h > 500000 ? 8 : 3;
  const fR = Math.abs(funding * 100);
  const funS = fR < 0.01 ? 20 : fR < 0.03 ? 15 : fR < 0.05 ? 10 : fR < 0.1 ? 5 : 0;
  const score = Math.min(100, Math.max(0, oiS + volS + liqS + funS));
  return { score, oiS, volS, liqS, funS, label: labelLS(score), riskMult: multLS(score) };
}

function labelLS(s) {
  if (s >= 80) return '🔥 STRONG WAVE';
  if (s >= 60) return '✅ GOOD WAVE';
  if (s >= 40) return '⚠️ WEAK WAVE';
  return '❌ NO WAVE';
}

function multLS(s) {
  if (s >= 80) return 2.0;
  if (s >= 60) return 1.5;
  if (s >= 40) return 1.0;
  return 0;
}

// ─── WAVE TYPE ───────────────────────────────────────────────
function getWaveType(lsScore, openTrades, consecutiveWins) {
  const hasRiderTP1 = openTrades.some(t => t.wave_type === 'RIDER' && t.tp1_hit && !t.tp2_hit);
  if (hasRiderTP1 && lsScore >= 60 && consecutiveWins >= 1) return 'SURFER';
  const riderDone = openTrades.some(t => t.wave_type === 'RIDER' && t.tp3_hit);
  if (riderDone && lsScore >= 40) return 'CATCHER';
  return 'RIDER';
}

module.exports = { calcLS, labelLS, multLS, getWaveType };
