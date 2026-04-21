const B = require('../core/binance');
const db = require('../core/database');
const tg = require('../core/telegram');

// ─── OPEN TRADE ───────────────────────────────────────────────
async function openTrade(signal, session, riskMgr) {
  const mode = process.env.BOT_MODE || 'PAPER';
  const risk = riskMgr.risk(session.start_capital);
  const pos = B.calcPositionSize(risk, signal.entry_price, signal.stop_loss, signal.leverage);
  if (!pos) throw new Error('Invalid position size calc');

  const fees = B.calcFees(pos.positionSize, signal.entry_price, signal.entry_price);

  // Set leverage
  if (mode === 'REAL') await B.setLeverage(signal.symbol, signal.leverage);

  // Entry order
  const side = signal.direction === 'LONG' ? 'BUY' : 'SELL';
  const order = await B.placeOrder({ symbol: signal.symbol, side, type: 'MARKET', quantity: pos.positionSize });

  // SL order (always placed on exchange for safety)
  let slOrderId = null;
  if (mode === 'REAL' && order.status === 'FILLED') {
    const slSide = side === 'BUY' ? 'SELL' : 'BUY';
    const slOrder = await B.placeOrder({ symbol: signal.symbol, side: slSide, type: 'STOP_MARKET', quantity: pos.positionSize, stopPrice: signal.stop_loss, reduceOnly: true });
    slOrderId = slOrder.orderId;
  }

  const trade = await db.saveTrade({
    session_id: session.id,
    symbol: signal.symbol,
    mode,
    direction: signal.direction,
    wave_type: signal.wave_type || 'RIDER',
    entry_price: signal.entry_price,
    current_price: signal.entry_price,
    stop_loss: signal.stop_loss,
    original_sl: signal.stop_loss,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3 || (signal.tp2 + Math.abs(signal.tp2 - signal.tp1)),
    leverage: signal.leverage,
    risk_amount: risk,
    position_size: pos.positionSize,
    position_value: pos.positionValue,
    margin_used: pos.margin,
    fee_open: fees.feeOpen,
    total_fees: fees.feeOpen,
    status: 'OPEN',
    score: signal.score,
    smt_detected: signal.smt_detected || false,
    slippage_hunt: signal.slippage_hunt || false,
    kill_zone: signal.kill_zone?.zone || 'OFF',
    binance_order_id: order.orderId,
    sl_order_id: slOrderId
  });

  await tg.sendTradeOpen(trade);
  await db.saveLog('INFO','TRADE',`Opened ${signal.direction} ${signal.symbol} x${signal.leverage} @ ${signal.entry_price}`, { tradeId: trade.id, score: signal.score });
  return trade;
}

// ─── MONITOR TRADES ──────────────────────────────────────────
async function monitorAll(prices) {
  const open = await db.getOpenTrades();
  for (const t of open) {
    const price = prices[t.symbol];
    if (!price) continue;
    // Update current price
    await db.updateTrade(t.id, { current_price: price });
    await checkTPSL(t, price);
  }
}

async function checkTPSL(t, price) {
  const long = t.direction === 'LONG';

  // SL check (only if no TP1 yet)
  if (!t.tp1_hit) {
    const slHit = long ? price <= t.stop_loss : price >= t.stop_loss;
    if (slHit) { await closeTrade(t, price, 'SL_HIT', 1.0); return; }
  }

  // SL after TP1 (Breakeven)
  if (t.tp1_hit && !t.tp2_hit) {
    const slHit = long ? price <= t.entry_price : price >= t.entry_price;
    if (slHit) { await closeTrade(t, t.entry_price, 'BREAKEVEN', 0.67); return; }
  }

  // SL after TP2 (at TP1)
  if (t.tp2_hit) {
    const slHit = long ? price <= t.stop_loss : price >= t.stop_loss;
    if (slHit) { await closeTrade(t, t.stop_loss, 'TRAILING_STOP', 0.34); return; }
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

  // Trailing TP3
  if (t.tp2_hit) await updateTrailing(t, price);
}

async function hitTP(t, price, tpNum) {
  const pct = tpNum === 1 ? 0.33 : 0.33;
  const partSize = t.position_size * pct;
  const isLong = t.direction === 'LONG';
  const pnl = isLong ? (price - t.entry_price) * partSize : (t.entry_price - price) * partSize;
  const fees = B.calcFees(partSize, t.entry_price, price);

  // Partial close on exchange
  if (process.env.BOT_MODE === 'REAL') {
    const s = isLong ? 'SELL' : 'BUY';
    await B.placeOrder({ symbol: t.symbol, side: s, type: 'MARKET', quantity: partSize, reduceOnly: true });
  }

  const newSL = tpNum === 1 ? t.entry_price : t.tp1;
  const updates = {
    [`tp${tpNum}_hit`]: true,
    [`tp${tpNum}_pnl`]: parseFloat(pnl.toFixed(4)),
    stop_loss: newSL,
    total_fees: parseFloat(((t.total_fees||0) + fees.feeClose).toFixed(6))
  };
  await db.updateTrade(t.id, updates);
  tpNum === 1 ? await tg.sendTP1(t, pnl, fees.feeClose) : await tg.sendTP2(t, pnl, fees.feeClose);
  await db.saveLog('INFO','TRADE',`TP${tpNum} hit ${t.symbol} @ ${price} PnL: +${pnl.toFixed(4)}`);
}

async function updateTrailing(t, price) {
  const trail = 0.003;
  const isLong = t.direction === 'LONG';
  const newSL = isLong ? price * (1 - trail) : price * (1 + trail);
  const better = isLong ? newSL > t.stop_loss : newSL < t.stop_loss;
  if (better) await db.updateTrade(t.id, { stop_loss: parseFloat(newSL.toFixed(4)) });
}

// ─── CLOSE TRADE ─────────────────────────────────────────────
async function closeTrade(t, closePrice, reason, sizePct = 1.0) {
  const closeSize = t.position_size * sizePct;
  const isLong = t.direction === 'LONG';
  const pnl = isLong
    ? (closePrice - t.entry_price) * closeSize
    : (t.entry_price - closePrice) * closeSize;
  const fees = B.calcFees(closeSize, t.entry_price, closePrice);
  const totalFees = parseFloat(((t.total_fees||0) + fees.feeClose).toFixed(6));
  const pnlAfterFees = pnl - totalFees;

  if (process.env.BOT_MODE === 'REAL') {
    const s = isLong ? 'SELL' : 'BUY';
    await B.placeOrder({ symbol: t.symbol, side: s, type: 'MARKET', quantity: closeSize, reduceOnly: true });
    // Cancel SL order if exists
    if (t.sl_order_id) await B.cancelOrder(t.symbol, t.sl_order_id).catch(()=>{});
  }

  const updated = await db.updateTrade(t.id, {
    status: 'CLOSED',
    close_price: closePrice,
    pnl: parseFloat(pnl.toFixed(4)),
    pnl_after_fees: parseFloat(pnlAfterFees.toFixed(4)),
    pnl_percent: parseFloat(((pnl / t.risk_amount) * 100).toFixed(2)),
    total_fees: totalFees,
    fee_close: fees.feeClose,
    tp3_hit: reason.includes('TRAILING') && t.tp2_hit,
    close_reason: reason,
    closed_at: new Date().toISOString()
  });

  await tg.sendClose(updated);
  await db.saveLog('INFO','TRADE',`Closed ${t.symbol} ${reason} PnL: ${pnlAfterFees.toFixed(4)}`);
  return updated;
}

async function closeAll(reason = 'EMERGENCY') {
  const open = await db.getOpenTrades();
  for (const t of open) {
    try {
      const price = await B.getPrice(t.symbol);
      await closeTrade(t, price, reason);
    } catch (e) { console.error(`Close ${t.symbol} error:`, e.message); }
  }
  await tg.sendText(`🚨 <b>كل الصفقات أُغلقت</b>\nالسبب: ${reason}`);
}

module.exports = { openTrade, monitorAll, closeTrade, closeAll };
