// ============================================================
// AXOM — BingX/Binance API Module
// Public data:  Binance Futures (no 451 geo-block)
// Trading:      BingX REAL or VST demo
// Features:     15s timeout, 3x retry, sequential support
// ============================================================
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const BINGX_REAL = 'https://open-api.bingx.com';
const BINGX_VST  = 'https://open-api-vst.bingx.com';
const BINANCE    = 'https://fapi.binance.com';
const TAKER_FEE  = 0.0005;
const TIMEOUT    = 15000;
const DELAY_MS   = 1500;

function TRADE_BASE() {
  return process.env.BOT_MODE === 'DEMO' ? BINGX_VST : BINGX_REAL;
}

// ─── UTILS ───────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, label, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) { logger.error('BINGX', `${label} failed (${retries}x): ${e.message}`); throw e; }
      logger.warn('BINGX', `${label} attempt ${i} failed: ${e.message} — retry in ${i}s`);
      await sleep(1000 * i);
    }
  }
}

// ─── AUTH ────────────────────────────────────────────────────
function sign(qs) {
  return crypto.createHmac('sha256', process.env.BINGX_SECRET_KEY || '').update(qs).digest('hex');
}
function authHeaders() { return { 'X-BX-APIKEY': process.env.BINGX_API_KEY || '' }; }

// ─── PAPER ENGINE ────────────────────────────────────────────
class PaperEngine {
  constructor() { this.balance = 1000; this.positions = {}; this._id = 10000; this.history = []; }
  reset(bal = 1000) { this.balance = bal; this.positions = {}; this.history = []; }
  getBalance() {
    const uPnl = Object.values(this.positions).reduce((s,p) => s+(p.uPnl||0), 0);
    return { balance: this.balance, available: this.balance, unrealizedPnl: uPnl };
  }
  open({ symbol, side, qty, price, leverage, sl, tp }) {
    const notional = qty * price, margin = notional / leverage, fee = notional * TAKER_FEE;
    if (this.balance < margin + fee)
      return { success:false, error:`رصيد تجريبي غير كافٍ ($${this.balance.toFixed(2)})`, balance:this.balance };
    this.balance -= (margin + fee);
    this.positions[symbol] = { symbol, side, qty, entryPrice:price, leverage, margin, sl, tp, uPnl:0, orderId:`PAPER_${++this._id}` };
    return { success:true, orderId:this.positions[symbol].orderId, status:'FILLED' };
  }
  updatePnl(symbol, price) {
    const p = this.positions[symbol]; if (!p) return;
    p.uPnl = (p.side==='BUY' ? price-p.entryPrice : p.entryPrice-price) * p.qty;
    p.currentPrice = price;
  }
  close(symbol, closePrice, reason = 'MANUAL') {
    const p = this.positions[symbol]; if (!p) return null;
    const pnl = (p.side==='BUY' ? closePrice-p.entryPrice : p.entryPrice-closePrice) * p.qty;
    const fee = closePrice * p.qty * TAKER_FEE;
    this.balance += p.margin + pnl - fee;
    const t = { symbol, side:p.side, pnl, fee, netPnl:pnl-fee, reason, balance:this.balance };
    this.history.push(t); delete this.positions[symbol]; return t;
  }
  getPositions() { return Object.values(this.positions); }
}
const paper = new PaperEngine();

// ─── PUBLIC DATA (Binance — avoids BingX 451 geo-block) ──────

async function getKlines(symbol, interval, limit = 100) {
  return withRetry(async () => {
    const { data } = await axios.get(`${BINANCE}/fapi/v1/klines`, {
      params: { symbol, interval, limit }, timeout: TIMEOUT
    });
    return data.map(k => ({ openTime:+k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] }));
  }, `getKlines ${symbol}`);
}

async function getTicker(symbol) {
  return withRetry(async () => {
    const { data } = await axios.get(`${BINANCE}/fapi/v1/ticker/24hr`, { params:{ symbol }, timeout:TIMEOUT });
    return { price:+data.lastPrice, change:+data.priceChangePercent, volume:+data.quoteVolume };
  }, `getTicker ${symbol}`).catch(() => ({ price:0, change:0, volume:0 }));
}

async function getTopSymbols(limit = 25) {
  return withRetry(async () => {
    const { data } = await axios.get(`${BINANCE}/fapi/v1/ticker/24hr`, { timeout: TIMEOUT });
    return data
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('1000') && +t.quoteVolume > 100000000)
      .sort((a,b) => +b.quoteVolume - +a.quoteVolume)
      .slice(0, limit)
      .map(t => t.symbol);
  }, 'getTopSymbols');
}

async function getOI(symbol) {
  return withRetry(async () => {
    const { data } = await axios.get(`${BINANCE}/fapi/v1/openInterest`, { params:{ symbol }, timeout:TIMEOUT });
    return parseFloat(data.openInterest || 0);
  }, `getOI ${symbol}`).catch(() => 0);
}

async function getFunding(symbol) {
  return withRetry(async () => {
    const { data } = await axios.get(`${BINANCE}/fapi/v1/premiumIndex`, { params:{ symbol }, timeout:TIMEOUT });
    return { fundingRate:parseFloat(data.lastFundingRate||0), markPrice:parseFloat(data.markPrice||0) };
  }, `getFunding ${symbol}`).catch(() => ({ fundingRate:0, markPrice:0 }));
}

// ─── AUTH ENDPOINTS (BingX) ───────────────────────────────────

async function getBalance() {
  const mode = process.env.BOT_MODE || 'PAPER';
  if (mode === 'PAPER') {
    const pb = paper.getBalance();
    return { mode:'PAPER', balance:pb.balance, available:pb.available, unrealizedPnl:pb.unrealizedPnl };
  }
  return withRetry(async () => {
    const ts  = Date.now();
    const qs  = `timestamp=${ts}&recvWindow=5000`;
    const { data } = await axios.get(`${TRADE_BASE()}/openApi/swap/v2/user/balance`, {
      params: { timestamp:ts, recvWindow:5000, signature:sign(qs) },
      headers: authHeaders(), timeout: TIMEOUT
    });
    const usdt = (data?.data?.balance?.assets || []).find(a => a.asset === 'USDT');
    if (!usdt) return { mode, balance:0, available:0, error:'لا يوجد رصيد USDT في الحساب' };
    const bal = parseFloat(usdt.availableMargin || 0);
    return { mode, balance:bal, available:bal };
  }, `getBalance ${mode}`);
}

async function setLeverage(symbol, leverage) {
  if (process.env.BOT_MODE === 'PAPER') return { leverage };
  const qs  = `symbol=${symbol}&side=Long&leverage=${leverage}&timestamp=${Date.now()}&recvWindow=5000`;
  return withRetry(async () => {
    const { data } = await axios.post(`${TRADE_BASE()}/openApi/swap/v2/trade/leverage?${qs}&signature=${sign(qs)}`,
      null, { headers:authHeaders(), timeout:TIMEOUT });
    return data?.data || { leverage };
  }, `setLeverage ${symbol}`).catch(() => ({ leverage }));
}

async function placeOrder({ symbol, side, type='MARKET', quantity, price, leverage=10, stopLoss, takeProfit }) {
  const mode = process.env.BOT_MODE || 'PAPER';
  if (mode === 'PAPER') return paper.open({ symbol, side, qty:quantity, price:price||0, leverage, sl:stopLoss, tp:takeProfit });
  return withRetry(async () => {
    await setLeverage(symbol, leverage);
    const od = { symbol, side, type, quantity:parseFloat(quantity).toFixed(3),
      positionSide:side==='BUY'?'LONG':'SHORT', timestamp:Date.now(), recvWindow:5000 };
    if (type==='LIMIT'&&price) { od.price=price.toFixed(2); od.timeInForce='GTC'; }
    const qs  = Object.entries(od).map(([k,v])=>`${k}=${v}`).join('&');
    const { data } = await axios.post(`${TRADE_BASE()}/openApi/swap/v2/trade/order?${qs}&signature=${sign(qs)}`,
      null, { headers:authHeaders(), timeout:TIMEOUT });
    const orderId = data?.data?.orderId;
    if (!orderId) throw new Error(data?.msg || 'No orderId');
    if (stopLoss)   await _sltp(symbol, side, quantity, stopLoss,   'STOP_MARKET');
    if (takeProfit) await _sltp(symbol, side, quantity, takeProfit, 'TAKE_PROFIT_MARKET');
    return { success:true, orderId, status:data?.data?.status||'FILLED' };
  }, `placeOrder ${symbol}`).catch(e => ({ success:false, error:e.message }));
}

async function _sltp(symbol, side, qty, stopPrice, type) {
  try {
    const closeSide = side==='BUY'?'SELL':'BUY';
    const qs = `symbol=${symbol}&side=${closeSide}&type=${type}&quantity=${parseFloat(qty).toFixed(3)}&stopPrice=${stopPrice.toFixed(2)}&reduceOnly=true&timestamp=${Date.now()}&recvWindow=5000`;
    await axios.post(`${TRADE_BASE()}/openApi/swap/v2/trade/order?${qs}&signature=${sign(qs)}`,
      null, { headers:authHeaders(), timeout:TIMEOUT });
  } catch (e) { logger.warn('BINGX', `SL/TP ${symbol}: ${e.message}`); }
}

async function closePosition(symbol, side, qty, currentPrice) {
  const mode = process.env.BOT_MODE || 'PAPER';
  if (mode === 'PAPER') return paper.close(symbol, currentPrice, 'CLOSE');
  return withRetry(async () => {
    const closeSide = side==='BUY'?'SELL':'BUY';
    const qs = `symbol=${symbol}&side=${closeSide}&type=MARKET&quantity=${parseFloat(qty).toFixed(3)}&reduceOnly=true&timestamp=${Date.now()}&recvWindow=5000`;
    const { data } = await axios.post(`${TRADE_BASE()}/openApi/swap/v2/trade/order?${qs}&signature=${sign(qs)}`,
      null, { headers:authHeaders(), timeout:TIMEOUT });
    return { success:true, orderId:data?.data?.orderId };
  }, `closePosition ${symbol}`).catch(e => ({ success:false, error:e.message }));
}

// ─── CALCULATORS ─────────────────────────────────────────────
function calcFees(posSize, entryPrice, closePrice) {
  return {
    feeOpen:   posSize * entryPrice * TAKER_FEE,
    feeClose:  posSize * closePrice * TAKER_FEE,
    totalFees: posSize * (entryPrice + closePrice) * TAKER_FEE
  };
}

function calcPositionSize(riskUSD, entryPrice, stopLoss, leverage) {
  const slDist = Math.abs(entryPrice - stopLoss);
  const slPct  = slDist / entryPrice;
  if (slPct <= 0) return null;
  const posVal = riskUSD / slPct;
  return {
    positionSize:  parseFloat((posVal / entryPrice).toFixed(6)),
    positionValue: parseFloat(posVal.toFixed(4)),
    margin:        parseFloat((posVal / leverage).toFixed(4)),
    slPct:         parseFloat((slPct * 100).toFixed(3))
  };
}

module.exports = {
  getKlines, getTicker, getTopSymbols, getOI, getFunding,
  getBalance, setLeverage, placeOrder, closePosition,
  calcFees, calcPositionSize,
  paper, TAKER_FEE, sleep, DELAY_MS
};
