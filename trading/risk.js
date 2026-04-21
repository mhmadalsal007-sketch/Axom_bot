// ─── LEVERAGE TABLE ───────────────────────────────────────────
function getLeverage(score, atr, kz, streak, ls) {
  if (score < 60) return 0;
  let lev = score >= 90 ? 45 : score >= 85 ? 35 : score >= 75 ? 25 : 15;
  if (kz?.active) lev += 5;
  if (atr < 0.3) lev += 10;
  else if (atr < 0.6) lev += 0;
  else if (atr < 1.0) lev -= 5;
  else if (atr < 1.5) lev -= 10;
  else lev -= 15;
  if (streak >= 3) lev += 5;
  if (ls >= 80) lev += 5;
  return Math.max(10, Math.min(50, Math.round(lev)));
}

// ─── POSITION SIZE ────────────────────────────────────────────
function getPositionSize(risk, entry, sl, lev) {
  const dist = Math.abs(entry - sl);
  const pct = dist / entry;
  if (pct <= 0) return null;
  const val = risk / pct;
  const size = val / entry;
  const margin = val / lev;
  return {
    positionSize: parseFloat(size.toFixed(6)),
    positionValue: parseFloat(val.toFixed(4)),
    margin: parseFloat(margin.toFixed(4)),
    slPct: parseFloat((pct * 100).toFixed(4))
  };
}

// ─── TP LEVELS ────────────────────────────────────────────────
function getTPLevels(entry, sl, dir) {
  const d = Math.abs(entry - sl);
  const sign = dir === 'LONG' ? 1 : -1;
  return {
    tp1: parseFloat((entry + sign * d * 1.0).toFixed(4)),
    tp2: parseFloat((entry + sign * d * 2.0).toFixed(4)),
    tp3: parseFloat((entry + sign * d * 3.0).toFixed(4)),
    rr: '1:3', slDist: d
  };
}

// ─── DAILY RISK MANAGER ───────────────────────────────────────
class DailyRisk {
  constructor(capital, stopPct) {
    this.start = capital;
    this.balance = capital;
    this.high = capital;
    this.stopAmount = (capital * stopPct) / 100;
    this.locked = 0;
    this.wins = 0;
    this.losses = 0;
    this.streak = 0;
    this.lossStreak = 0;
    this.trades = 0;
    this.winTrades = 0;
    this.ladder = 1.0;
  }

  update(pnl) {
    this.balance += pnl;
    this.trades++;
    if (pnl > 0) {
      this.wins++; this.winTrades++; this.streak++; this.lossStreak = 0;
      this._updateLadder();
    } else {
      this.losses++; this.lossStreak++; this.streak = 0; this.ladder = 1.0;
    }
    if (this.balance > this.high) this.high = this.balance;
    this._updateLock();
  }

  _updateLadder() {
    if (this.streak >= 6) this.ladder = 1.8;
    else if (this.streak >= 4) this.ladder = 1.5;
    else if (this.streak >= 2) this.ladder = 1.2;
    else this.ladder = 1.0;
    this.ladder = Math.min(2.0, this.ladder);
  }

  _updateLock() {
    const profit = this.balance - this.start;
    if (profit >= 50) this.locked = this.start + 40;
    else if (profit >= 30) this.locked = this.start + 25;
    else if (profit >= 20) this.locked = this.start + 15;
    else if (profit >= 10) this.locked = this.start + 7;
    else if (profit >= 5) this.locked = this.start + 3;
  }

  risk(base) { return parseFloat((base * this.ladder).toFixed(4)); }

  shouldStop() {
    const lost = this.start - this.balance;
    if (lost >= this.stopAmount) return { stop: true, reason: 'DAILY_STOP' };
    if (this.locked > 0 && this.balance < this.locked) return { stop: true, reason: 'PROFIT_LOCK' };
    if (this.balance < this.high * 0.5 && this.balance > this.start * 0.5)
      return { stop: true, reason: 'PROFIT_PROTECTION', ask: true };
    return { stop: false };
  }

  shouldPause() {
    if (this.lossStreak >= 3) return { pause: true, reason: '3 consecutive losses', mins: 60 };
    return { pause: false };
  }

  status() {
    return {
      balance: this.balance, high: this.high, stop: this.stopAmount,
      locked: this.locked, ladder: this.ladder,
      streak: this.streak, lossStreak: this.lossStreak,
      trades: this.trades, winRate: this.trades > 0 ? ((this.winTrades/this.trades)*100).toFixed(1) : '0'
    };
  }
}

// ─── CIRCUIT BREAKERS ────────────────────────────────────────
function checkBreakers(data) {
  const alerts = [];
  if (data.priceChangePct && Math.abs(data.priceChangePct) > 1.5)
    alerts.push({ type: 'FLASH_CRASH', action: 'CLOSE_ALL', sev: 'CRITICAL' });
  if (data.funding > 0.001)
    alerts.push({ type: 'FUNDING_HIGH', action: 'NO_LONGS', sev: 'HIGH' });
  if (data.funding < -0.0008)
    alerts.push({ type: 'FUNDING_LOW', action: 'NO_SHORTS', sev: 'HIGH' });
  return alerts;
}

module.exports = { getLeverage, getPositionSize, getTPLevels, DailyRisk, checkBreakers };
