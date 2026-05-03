// ============================================================
// AXOM — Risk Engine + Trade Executor
// Handles position sizing, TP/SL management, compounding
// ============================================================
const bingx    = require('../core/bingx');
const db       = require('../core/database');
const dash     = require('../core/dashboard');
const MT       = require('../core/marketTracker');
const logger   = require('../utils/logger');

const TRAIL_PCT = 0.003; // 0.3% trailing stop

// ─── LEVERAGE TABLE ──────────────────────────────────────────
function getLeverage(score, atr, kz, streak, ls) {
  if (score < 60) return 0;
  let lev = score>=90?45 : score>=85?35 : score>=75?25 : 15;
  if (kz?.active)    lev += 5;
  if (atr  < 0.3)    lev += 10;
  else if (atr<0.6)  lev += 0;
  else if (atr<1.0)  lev -= 5;
  else if (atr<1.5)  lev -= 10;
  else               lev -= 15;
  if (streak >= 3)   lev += 5;
  if (ls >= 80)      lev += 5;
  return Math.max(10, Math.min(50, Math.round(lev)));
}

// ─── TP LEVELS ───────────────────────────────────────────────
function getTPLevels(entry, sl, dir) {
  const d  = Math.abs(entry - sl);
  const s  = dir === 'LONG' ? 1 : -1;
  return {
    tp1: parseFloat((entry + s*d*1.0).toFixed(4)),
    tp2: parseFloat((entry + s*d*2.0).toFixed(4)),
    tp3: parseFloat((entry + s*d*3.0).toFixed(4)),
    rr:  '1:3', slDist: d
  };
}

// ─── COMPOUNDING STATE ────────────────────────────────────────
class CompoundState {
  constructor(baseRisk, stopAmt) {
    this.baseRisk          = baseRisk;
    this.stopAmount        = stopAmt;
    this.balance           = baseRisk;
    this.high              = baseRisk;
    this.locked            = 0;
    this.consecutiveWins   = 0;
    this.consecutiveLosses = 0;
    this.ladderMultiplier  = 1.0;
    this.trades            = 0;
    this.wins              = 0;
  }

  update(pnl) {
    this.balance += pnl;
    this.trades++;
    if (pnl > 0) {
      this.wins++; this.consecutiveWins++; this.consecutiveLosses = 0;
      if (this.consecutiveWins>=6)      this.ladderMultiplier = 1.8;
      else if (this.consecutiveWins>=4) this.ladderMultiplier = 1.5;
      else if (this.consecutiveWins>=2) this.ladderMultiplier = 1.2;
    } else {
      this.consecutiveLosses++; this.consecutiveWins = 0;
      this.ladderMultiplier = 1.0;
    }
    this.ladderMultiplier = Math.min(2.0, this.ladderMultiplier);
    if (this.balance > this.high) this.high = this.balance;
    this._updateLock();
  }

  _updateLock() {
    const p = this.balance - this.baseRisk;
    this.locked = p>=50?this.baseRisk+40 : p>=30?this.baseRisk+25 : p>=20?this.baseRisk+15 : p>=10?this.baseRisk+7 : p>=5?this.baseRisk+3 : 0;
  }

  currentRisk() { return parseFloat((this.baseRisk * this.ladderMultiplier).toFixed(4)); }
  leverageBonus() { return this.consecutiveWins>=3 ? 5 : 0; }
  winRate() { return this.trades>0?((this.wins/this.trades)*100).toFixed(1):0; }

  shouldStop() {
    const lost = this.baseRisk - this.balance;
    if (lost >= this.stopAmount) return { stop:true, reason:'DAILY_STOP' };
    if (this.locked>0 && this.balance<this.locked) return { stop:true, reason:'PROFIT_LOCK' };
    if (this.balance<this.high*0.5 && this.balance>this.baseRisk*0.5) return { stop:true, reason:'PROFIT_PROTECT', ask:true };
    return { stop:false };
  }

  shouldPause() {
    if (this.consecutiveLosses>=3) return { pause:true, reason:'3 خسارات متتالية', mins:60 };
    return { pause:false };
  }
}

// ─── OPEN TRADE ───────────────────────────────────────────────
async function openTrade(signal, session, compound) {
  const mode    = process.env.BOT_MODE || 'PAPER';
  const risk    = compound ? compound.currentRisk() : session.start_capital;
  const lev     = signal.leverage + (compound?.leverageBonus()||0);
  const leverage = Math.min(50, lev);

  // Get entry price from live feed
  const livePrice = MT.getPrice(signal.symbol) || signal.entry;
  const entry = livePrice || signal.entry;
  const sl    = signal.sl;

  if (!entry || !sl) throw new Error('Invalid entry/SL prices');

  // Check balance
  try {
    const balInfo = await bingx.getBalance();
    const needed  = risk / (Math.abs(entry-sl)/entry); // approx margin
    if (balInfo.available < needed * 0.5) {
      logger.warn('EXECUTOR', `Low balance: $${balInfo.available} for risk $${risk}`);
      await dash.sendBalanceAlert(balInfo.available, mode);
    }
  } catch (e) {
    logger.error('EXECUTOR', `Balance check failed: ${e.message}`);
  }

  // Position size
  const pos = bingx.calcPositionSize(risk, entry, sl, leverage);
  if (!pos) throw new Error('Position size calc failed');

  const tpLevels = getTPLevels(entry, sl, signal.direction);
  const fees     = bingx.calcFees(pos.positionSize, entry, entry);

  // Execute order
  const side  = signal.direction === 'LONG' ? 'BUY' : 'SELL';
  const order = await bingx.placeOrder({
    symbol: signal.symbol, side, type:'MARKET',
    quantity: pos.positionSize, price: entry,
    leverage, stopLoss: sl, takeProfit: tpLevels.tp2
  });

  if (!order.success && order.error) {
    throw new Error(`Order failed: ${order.error}`);
  }

  // Save to DB
  const trade = await db.saveTrade({
    session_id:    session.id,
    symbol:        signal.symbol,
    mode,
    direction:     signal.direction,
    wave_type:     signal.wave_type || 'RIDER',
    entry_price:   entry,
    current_price: entry,
    stop_loss:     sl,
    original_sl:   sl,
    tp1:           tpLevels.tp1,
    tp2:           tpLevels.tp2,
    tp3:           tpLevels.tp3,
    leverage,
    risk_amount:   risk,
    position_size: pos.positionSize,
    position_value:pos.positionValue,
    margin_used:   pos.margin,
    fee_open:      fees.feeOpen,
    total_fees:    fees.feeOpen,
    status:        'OPEN',
    score:         signal.score,
    kill_zone:     signal.kz?.zone || 'OFF',
    smt_detected:  signal.smt || false,
    slippage_hunt: signal.slippage || false,
    bingx_order_id: order.orderId || null
  });

  await dash.sendTradeOpen(trade);
  logger.info('EXECUTOR', `Opened ${signal.direction} ${signal.symbol} x${leverage} @ ${entry} risk:$${risk}`);
  return trade;
}

// ─── MONITOR TRADES ──────────────────────────────────────────
async function monitorAll(prices) {
  const open = await db.getOpenTrades();
  for (const t of open) {
    const price = prices[t.symbol] || MT.getPrice(t.symbol);
    if (!price) continue;
    await db.updateTrade(t.id, { current_price: price });
    await checkTPSL(t, price);
  }
}

async function checkTPSL(t, price) {
  const long = t.direction === 'LONG';

  // SL hit (no TP yet)
  if (!t.tp1_hit) {
    const slHit = long ? price <= t.stop_loss : price >= t.stop_loss;
    if (slHit) { await closeTrade(t, price, 'SL_HIT'); return; }
  }

  // Breakeven (after TP1)
  if (t.tp1_hit && !t.tp2_hit) {
    const beHit = long ? price <= t.entry_price : price >= t.entry_price;
    if (beHit) { await closeTrade(t, t.entry_price, 'BREAKEVEN', 0.67); return; }
  }

  // After TP2 — trailing
  if (t.tp2_hit) {
    const trailHit = long ? price <= t.stop_loss : price >= t.stop_loss;
    if (trailHit) { await closeTrade(t, t.stop_loss, 'TRAILING_STOP', 0.34); return; }
    // Update trailing SL
    const newSL = long ? price*(1-TRAIL_PCT) : price*(1+TRAIL_PCT);
    const better = long ? newSL>t.stop_loss : newSL<t.stop_loss;
    if (better) await db.updateTrade(t.id, { stop_loss:parseFloat(newSL.toFixed(4)) });
  }

  // TP1
  if (!t.tp1_hit) {
    const tp1Hit = long ? price >= t.tp1 : price <= t.tp1;
    if (tp1Hit) { await hitTP(t, price, 1); return; }
  }

  // TP2
  if (t.tp1_hit && !t.tp2_hit) {
    const tp2Hit = long ? price >= t.tp2 : price <= t.tp2;
    if (tp2Hit) { await hitTP(t, price, 2); return; }
  }
}

async function hitTP(t, price, n) {
  const pct   = 0.33;
  const size  = t.position_size * pct;
  const long  = t.direction === 'LONG';
  const pnl   = long ? (price-t.entry_price)*size : (t.entry_price-price)*size;
  const fees  = bingx.calcFees(size, t.entry_price, price);
  const newSL = n===1 ? t.entry_price : t.tp1;

  if (process.env.BOT_MODE === 'REAL') {
    await bingx.closePosition(t.symbol, t.direction==='LONG'?'BUY':'SELL', size, price);
  } else {
    bingx.paper.updatePnl(t.symbol, price);
  }

  await db.updateTrade(t.id, {
    [`tp${n}_hit`]: true,
    [`tp${n}_pnl`]: parseFloat(pnl.toFixed(4)),
    stop_loss: parseFloat(newSL.toFixed(4)),
    total_fees: parseFloat(((+t.total_fees||0)+fees.feeClose).toFixed(6))
  });

  await dash.sendTP(t, n, pnl, fees.feeClose);
  logger.info('EXECUTOR', `TP${n} hit ${t.symbol} @ ${price} pnl:+${pnl.toFixed(4)}`);
}

async function closeTrade(t, closePrice, reason, sizePct=1.0) {
  const size  = t.position_size * sizePct;
  const long  = t.direction === 'LONG';
  const pnl   = long ? (closePrice-t.entry_price)*size : (t.entry_price-closePrice)*size;
  const fees  = bingx.calcFees(size, t.entry_price, closePrice);
  const total = parseFloat(((+t.total_fees||0)+fees.feeClose).toFixed(6));
  const netPnl = parseFloat((pnl-total).toFixed(4));

  if (process.env.BOT_MODE === 'REAL') {
    await bingx.closePosition(t.symbol, t.direction==='LONG'?'BUY':'SELL', size, closePrice);
  } else {
    bingx.paper.close(t.symbol, closePrice, reason);
  }

  const updated = await db.updateTrade(t.id, {
    status:'CLOSED', close_price:closePrice,
    pnl:parseFloat(pnl.toFixed(4)),
    pnl_after_fees:netPnl,
    pnl_percent:parseFloat(((pnl/t.risk_amount)*100).toFixed(2)),
    total_fees:total, fee_close:fees.feeClose,
    tp3_hit: reason==='TRAILING_STOP' && t.tp2_hit,
    close_reason:reason,
    closed_at:new Date().toISOString()
  });

  await dash.sendClose(updated);
  logger.info('EXECUTOR', `Closed ${t.symbol} ${reason} @ ${closePrice} net:${netPnl>=0?'+':''}${netPnl}`);
  return { trade:updated, pnl:netPnl };
}

async function closeAll(reason='EMERGENCY') {
  const open = await db.getOpenTrades();
  for (const t of open) {
    try {
      const price = MT.getPrice(t.symbol) || +t.entry_price;
      await closeTrade(t, price, reason);
    } catch (e) { logger.error('EXECUTOR', `closeAll ${t.symbol}: ${e.message}`); }
  }
  await dash.send(`🚨 <b>كل الصفقات أُغلقت</b>\nالسبب: ${reason}`);
}

module.exports = { openTrade, monitorAll, closeTrade, closeAll, getLeverage, getTPLevels, CompoundState };
