// ============================================================
// AXOM — Compounding & Profit Management System
// ============================================================

class CompoundingSystem {
  constructor(baseRisk, dailyStop) {
    this.baseRisk = baseRisk;
    this.dailyStop = dailyStop;
    this.currentBalance = baseRisk;
    this.dailyHigh = baseRisk;
    this.profitLocked = 0;

    // Ladder state
    this.consecutiveWins = 0;
    this.consecutiveLosses = 0;
    this.ladderMultiplier = 1.0;
    this.streakBonus = 0; // Extra leverage bonus

    // Daily tracking
    this.todayPnL = 0;
    this.todayFees = 0;
    this.totalTrades = 0;
    this.winningTrades = 0;

    // History
    this.tradeHistory = []; // last 10 results
  }

  // ─── AFTER EACH TRADE ─────────────────────────────────────
  recordTrade(pnl, fees = 0) {
    const netPnl = pnl - fees;
    this.currentBalance += netPnl;
    this.todayPnL += netPnl;
    this.todayFees += fees;
    this.totalTrades++;

    const won = netPnl > 0;
    if (won) {
      this.winningTrades++;
      this.consecutiveWins++;
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
      this.consecutiveWins = 0;
    }

    // Update daily high
    if (this.currentBalance > this.dailyHigh) {
      this.dailyHigh = this.currentBalance;
    }

    // Update ladder
    this._updateLadder(won);

    // Update profit lock
    this._updateProfitLock();

    // Track history
    this.tradeHistory.push({ pnl: netPnl, won, time: Date.now() });
    if (this.tradeHistory.length > 10) this.tradeHistory.shift();

    return this.getState();
  }

  // ─── LADDER SYSTEM ────────────────────────────────────────
  _updateLadder(won) {
    if (!won) {
      this.ladderMultiplier = 1.0; // Reset on any loss
      this.streakBonus = 0;
      return;
    }

    // Build ladder after wins
    if (this.consecutiveWins >= 6) this.ladderMultiplier = 1.8;
    else if (this.consecutiveWins >= 4) this.ladderMultiplier = 1.5;
    else if (this.consecutiveWins >= 2) this.ladderMultiplier = 1.2;
    else this.ladderMultiplier = 1.0;

    // Streak bonus for leverage
    this.streakBonus = this.consecutiveWins >= 3 ? 5 : 0;

    // Hard ceiling
    this.ladderMultiplier = Math.min(2.0, this.ladderMultiplier);
  }

  // ─── PROFIT LOCK ──────────────────────────────────────────
  _updateProfitLock() {
    const profit = this.currentBalance - this.baseRisk;
    if (profit >= 50) this.profitLocked = this.baseRisk + 40;
    else if (profit >= 30) this.profitLocked = this.baseRisk + 25;
    else if (profit >= 20) this.profitLocked = this.baseRisk + 15;
    else if (profit >= 10) this.profitLocked = this.baseRisk + 7;
    else if (profit >= 5) this.profitLocked = this.baseRisk + 3;
    else this.profitLocked = 0;
  }

  // ─── GET CURRENT RISK ─────────────────────────────────────
  getCurrentRisk() {
    return parseFloat((this.baseRisk * this.ladderMultiplier).toFixed(4));
  }

  // ─── LEVERAGE BONUS ───────────────────────────────────────
  getLeverageBonus() { return this.streakBonus; }

  // ─── STOP CHECKS ──────────────────────────────────────────
  checkStops() {
    const totalLoss = this.baseRisk - this.currentBalance;

    // 1. Daily stop
    if (totalLoss >= this.dailyStop) {
      return { action: 'STOP', reason: 'DAILY_STOP', message: `خسرت $${totalLoss.toFixed(2)} من أصل $${this.dailyStop.toFixed(2)} حد يومي` };
    }

    // 2. Profit lock protection
    if (this.profitLocked > 0 && this.currentBalance < this.profitLocked) {
      return { action: 'STOP', reason: 'PROFIT_LOCK', message: `الرصيد $${this.currentBalance.toFixed(2)} تحت الحد المحمي $${this.profitLocked.toFixed(2)}` };
    }

    // 3. Trailing profit stop (50% of daily high)
    const profitProtectLevel = this.dailyHigh * 0.5;
    if (this.currentBalance < profitProtectLevel && this.currentBalance > this.baseRisk * 0.5) {
      return { action: 'ASK', reason: 'PROFIT_PROTECTION', message: `تراجع إلى 50% من أعلى ربح ($${this.dailyHigh.toFixed(2)})` };
    }

    // 4. 3 consecutive losses → pause
    if (this.consecutiveLosses >= 3) {
      return { action: 'PAUSE', reason: 'CONSECUTIVE_LOSSES', duration: 60, message: '3 خسارات متتالية — استراحة ساعة' };
    }

    return { action: 'CONTINUE' };
  }

  // ─── WIN RATE ─────────────────────────────────────────────
  getWinRate() {
    if (this.totalTrades === 0) return 0;
    return parseFloat(((this.winningTrades / this.totalTrades) * 100).toFixed(1));
  }

  // ─── STATE SNAPSHOT ───────────────────────────────────────
  getState() {
    return {
      balance: this.currentBalance,
      baseRisk: this.baseRisk,
      currentRisk: this.getCurrentRisk(),
      dailyHigh: this.dailyHigh,
      dailyStop: this.dailyStop,
      profitLocked: this.profitLocked,
      ladderMultiplier: this.ladderMultiplier,
      streakBonus: this.streakBonus,
      consecutiveWins: this.consecutiveWins,
      consecutiveLosses: this.consecutiveLosses,
      todayPnL: parseFloat(this.todayPnL.toFixed(4)),
      todayFees: parseFloat(this.todayFees.toFixed(4)),
      totalTrades: this.totalTrades,
      winRate: this.getWinRate(),
      last5: this.tradeHistory.slice(-5).map(t => t.won ? '✅' : '❌').join(' ')
    };
  }

  // ─── DAILY SUMMARY ────────────────────────────────────────
  getDailySummary() {
    const state = this.getState();
    return `💰 رصيد: $${state.balance.toFixed(4)}
📈 أعلى: $${state.dailyHigh.toFixed(4)}
🪜 Ladder: x${state.ladderMultiplier}
🎯 Streak: ${state.consecutiveWins} wins
📊 PnL: ${state.todayPnL >= 0 ? '+' : ''}$${state.todayPnL.toFixed(4)}
💸 رسوم: $${state.todayFees.toFixed(4)}
✅ Win Rate: ${state.winRate}%
📋 آخر 5: ${state.last5}`;
  }
}

module.exports = { CompoundingSystem };
