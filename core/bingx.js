// ============================================================
// AXOM — BingX REST API
// All trading operations, balance checks, market data
// Demo (paper) mode fully integrated
// ============================================================
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const BASE      = 'https://open-api.bingx.com';
const TAKER_FEE = 0.0005; // 0.05%

// ─── AUTH ─────────────────────────────────────────────────────
function sign(qs) {
  return crypto
    .createHmac('sha256', process.env.BINGX_SECRET_KEY || '')
    .update(qs).digest('hex');
}
function authHeaders() {
  return { 'X-BX-APIKEY': process.env.BINGX_API_KEY || '', 'Content-Type': 'application/json' };
}
function buildParams(obj) {
  const ts  = Date.now();
  const base = { ...obj, timestamp: ts, recvWindow: 5000 };
  const qs   = Object.entries(base).map(([k,v]) => `${k}=${v}`).join('&');
  return { ...base, signature: sign(qs), _qs: qs };
}

// ─── PAPER TRADING ENGINE ─────────────────────────────────────
class PaperEngine {
  constructor() {
    this.balance   = 1000.00; // default paper balance
    this.positions = {};
    this.orders    = {};
    this.orderId   = 10000;
    this.history   = [];
  }

  setBalance(amount) { this.balance = parseFloat(amount); }

  getBalance() {
    return {
      asset: 'USDT',
      balance: this.balance,
      availableMargin: this.balance,
      unrealizedProfit: this._calcUnrealizedPnl()
    };
  }

  _calcUnrealizedPnl() {
    return Object.values(this.positions)
      .reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
  }

  placeOrder({ symbol, side, quantity, price, leverage, stopLoss, takeProfit }) {
    const id     = `PAPER_${++this.orderId}`;
    const notional = quantity * price;
    const margin   = notional / leverage;
    const fee      = notional * TAKER_FEE;

    if (this.balance < margin + fee) {
      return { success: false, error: 'رصيد تجريبي غير كافٍ', balance: this.balance };
    }

    this.balance -= (margin + fee);

    this.positions[symbol] = {
      symbol, side, quantity,
      entryPrice: price, leverage,
      margin, fee,
      stopLoss, takeProfit,
      orderId: id,
      openedAt: Date.now(),
      unrealizedPnl: 0
    };

    logger.info('PAPER', `Order: ${side} ${symbol} qty:${quantity} @ ${price} x${leverage}`);
    return { success: true, orderId: id, status: 'FILLED', executedPrice: price, fee };
  }

  updatePnl(symbol, currentPrice) {
    const pos = this.positions[symbol];
    if (!pos) return;
    const diff = pos.side === 'BUY'
      ? currentPrice - pos.entryPrice
      : pos.entryPrice - currentPrice;
    pos.unrealizedPnl = diff * pos.quantity;
    pos.currentPrice  = currentPrice;
  }

  closePosition(symbol, closePrice, reason = 'MANUAL') {
    const pos = this.positions[symbol];
    if (!pos) return null;

    const diff  = pos.side === 'BUY'
      ? closePrice - pos.entryPrice
      : pos.entryPrice - closePrice;
    const pnl   = diff * pos.quantity;
    const fee   = closePrice * pos.quantity * TAKER_FEE;
    const netPnl = pnl - fee;

    this.balance += pos.margin + netPnl;

    const trade = { symbol, side: pos.side, pnl, fee, netPnl, reason, closedAt: Date.now(), duration: Date.now() - pos.openedAt };
    this.history.push(trade);
    delete this.positions[symbol];

    logger.info('PAPER', `Closed ${symbol}: PnL ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(4)}`);
    return { ...trade, balance: this.balance };
  }

  getPositions() { return Object.values(this.positions); }
  getHistory()   { return this.history.slice(-20); }
  reset(balance = 1000) { this.balance = balance; this.positions = {}; this.orders = {}; this.history = []; }
}

const paper = new PaperEngine();

// ─── PUBLIC API (no auth) ─────────────────────────────────────
async function getKlines(symbol, interval, limit = 100) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/klines`, {
      params: { symbol, interval, limit }, timeout: 5000
    });
    if (data?.data?.length) {
      return data.data.map(k => ({
        openTime: +k[0], open: +k[1], high: +k[2],
        low: +k[3], close: +k[4], volume: +k[5]
      }));
    }
  } catch (e) {}
  // Fallback: Binance futures public
  try {
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
      params: { symbol, interval, limit }, timeout: 5000
    });
    return data.map(k => ({
      openTime: +k[0], open: +k[1], high: +k[2],
      low: +k[3], close: +k[4], volume: +k[5]
    }));
  } catch (e) {
    logger.error('API', `getKlines ${symbol}: ${e.message}`);
    return [];
  }
}

async function getTicker(symbol) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/ticker`, {
      params: { symbol }, timeout: 3000
    });
    const d = data?.data || {};
    return { price: +d.lastPrice || 0, change: +d.priceChangePercent || 0, volume: +d.quoteVolume || 0 };
  } catch (e) {
    try {
      const { data } = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', {
        params: { symbol }, timeout: 3000
      });
      return { price: +data.lastPrice, change: +data.priceChangePercent, volume: +data.quoteVolume };
    } catch { return { price: 0, change: 0, volume: 0 }; }
  }
}

async function getTopSymbols(limit = 50) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/ticker`, { timeout: 5000 });
    const tickers = Array.isArray(data?.data) ? data.data : [];
    if (tickers.length) {
      return tickers
        .filter(t => t.symbol?.endsWith('-USDT') && +t.quoteVolume > 20000000)
        .sort((a,b) => +b.quoteVolume - +a.quoteVolume)
        .slice(0, limit)
        .map(t => t.symbol.replace('-USDT','USDT'));
    }
  } catch (e) {}
  // Fallback Binance
  try {
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', { timeout: 5000 });
    return data
      .filter(t => t.symbol.endsWith('USDT') && +t.quoteVolume > 50000000)
      .sort((a,b) => +b.quoteVolume - +a.quoteVolume)
      .slice(0, limit)
      .map(t => t.symbol);
  } catch { return ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT']; }
}

async function getOI(symbol) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/openInterest`, {
      params: { symbol }, timeout: 3000
    });
    return parseFloat(data?.data?.openInterest || 0);
  } catch {
    try {
      const sym = symbol.replace('-','');
      const { data } = await axios.get('https://fapi.binance.com/fapi/v1/openInterest', {
        params: { symbol: sym }, timeout: 3000
      });
      return parseFloat(data.openInterest || 0);
    } catch { return 0; }
  }
}

async function getFunding(symbol) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/premiumIndex`, {
      params: { symbol }, timeout: 3000
    });
    return {
      fundingRate: parseFloat(data?.data?.lastFundingRate || 0),
      markPrice:   parseFloat(data?.data?.markPrice || 0)
    };
  } catch {
    try {
      const sym = symbol.replace('-','');
      const { data } = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', {
        params: { symbol: sym }, timeout: 3000
      });
      return { fundingRate: parseFloat(data.lastFundingRate||0), markPrice: parseFloat(data.markPrice||0) };
    } catch { return { fundingRate: 0, markPrice: 0 }; }
  }
}

// ─── AUTHENTICATED API ────────────────────────────────────────
async function getBalance() {
  const mode = process.env.BOT_MODE || 'PAPER';

  if (mode === 'PAPER') {
    const pb = paper.getBalance();
    return { mode: 'PAPER', balance: pb.balance, available: pb.availableMargin, unrealizedPnl: pb.unrealizedProfit };
  }

  // DEMO mode — BingX demo account
  if (mode === 'DEMO') {
    try {
      const p  = buildParams({});
      const { data } = await axios.get(`${BASE}/openApi/swap/v2/user/balance`, {
        params: { timestamp: p.timestamp, recvWindow: p.recvWindow, signature: p.signature },
        headers: authHeaders(), timeout: 5000
      });
      const usdt = (data?.data?.balance?.assets || []).find(a => a.asset === 'USDT');
      const bal  = parseFloat(usdt?.availableMargin || 0);
      return { mode: 'DEMO', balance: bal, available: bal, raw: usdt };
    } catch (e) {
      logger.error('API', `getBalance DEMO failed: ${e.message}`);
      throw new Error(`فشل جلب رصيد DEMO: ${e.message}`);
    }
  }

  // REAL mode
  try {
    const p  = buildParams({});
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/user/balance`, {
      params: { timestamp: p.timestamp, recvWindow: p.recvWindow, signature: p.signature },
      headers: authHeaders(), timeout: 5000
    });
    const usdt = (data?.data?.balance?.assets || []).find(a => a.asset === 'USDT');
    const bal  = parseFloat(usdt?.availableMargin || 0);
    if (bal === 0 && !usdt) throw new Error('لا يوجد رصيد USDT في الحساب');
    return { mode: 'REAL', balance: bal, available: bal, raw: usdt };
  } catch (e) {
    logger.error('API', `getBalance REAL failed: ${e.message}`);
    throw new Error(`فشل جلب الرصيد: ${e.message}`);
  }
}

async function setLeverage(symbol, leverage) {
  if (process.env.BOT_MODE === 'PAPER') return { leverage };
  try {
    const p  = buildParams({ symbol, side: 'Long', leverage: parseInt(leverage) });
    const qs = `symbol=${p.symbol}&side=${p.side}&leverage=${p.leverage}&timestamp=${p.timestamp}&recvWindow=${p.recvWindow}`;
    const sig = sign(qs);
    const { data } = await axios.post(
      `${BASE}/openApi/swap/v2/trade/leverage?${qs}&signature=${sig}`,
      null, { headers: authHeaders(), timeout: 5000 }
    );
    return data?.data || { leverage };
  } catch (e) {
    logger.error('API', `setLeverage ${symbol}: ${e.message}`);
    return { leverage };
  }
}

async function placeOrder({ symbol, side, type = 'MARKET', quantity, price, stopLoss, takeProfit, leverage = 10 }) {
  const mode = process.env.BOT_MODE || 'PAPER';

  if (mode === 'PAPER') {
    const currentPrice = price || 0;
    return paper.placeOrder({ symbol, side, quantity, price: currentPrice, leverage, stopLoss, takeProfit });
  }

  try {
    // Set leverage first
    await setLeverage(symbol, leverage);

    const orderData = {
      symbol, side, type,
      quantity: quantity.toFixed(3),
      positionSide: side === 'BUY' ? 'LONG' : 'SHORT'
    };
    if (type === 'LIMIT' && price) { orderData.price = price.toFixed(2); orderData.timeInForce = 'GTC'; }

    const qs  = Object.entries({ ...orderData, timestamp: Date.now(), recvWindow: 5000 }).map(([k,v])=>`${k}=${v}`).join('&');
    const sig = sign(qs);

    const { data } = await axios.post(
      `${BASE}/openApi/swap/v2/trade/order?${qs}&signature=${sig}`,
      null, { headers: authHeaders(), timeout: 5000 }
    );

    const orderId = data?.data?.orderId;
    if (!orderId) throw new Error(data?.msg || 'No orderId returned');

    // Place SL/TP
    if (stopLoss)   await placeSLTP(symbol, side, quantity, stopLoss, 'STOP_MARKET');
    if (takeProfit) await placeSLTP(symbol, side, quantity, takeProfit, 'TAKE_PROFIT_MARKET');

    return { success: true, orderId, status: data?.data?.status, fee: 0 };
  } catch (e) {
    logger.error('API', `placeOrder ${symbol}: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function placeSLTP(symbol, side, quantity, stopPrice, type) {
  try {
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    const qs = `symbol=${symbol}&side=${closeSide}&type=${type}&quantity=${quantity.toFixed(3)}&stopPrice=${stopPrice.toFixed(2)}&reduceOnly=true&timestamp=${Date.now()}&recvWindow=5000`;
    const sig = sign(qs);
    await axios.post(`${BASE}/openApi/swap/v2/trade/order?${qs}&signature=${sig}`, null, { headers: authHeaders(), timeout: 5000 });
  } catch (e) {
    logger.warn('API', `SL/TP placement for ${symbol}: ${e.message}`);
  }
}

async function closePosition(symbol, side, quantity, currentPrice) {
  const mode = process.env.BOT_MODE || 'PAPER';
  if (mode === 'PAPER') return paper.closePosition(symbol, currentPrice, 'CLOSE');

  try {
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    const qs  = `symbol=${symbol}&side=${closeSide}&type=MARKET&quantity=${quantity.toFixed(3)}&reduceOnly=true&timestamp=${Date.now()}&recvWindow=5000`;
    const sig = sign(qs);
    const { data } = await axios.post(`${BASE}/openApi/swap/v2/trade/order?${qs}&signature=${sig}`, null, { headers: authHeaders(), timeout: 5000 });
    return { success: true, orderId: data?.data?.orderId };
  } catch (e) {
    logger.error('API', `closePosition ${symbol}: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ─── HELPERS ─────────────────────────────────────────────────
function calcFees(posSize, entryPrice, closePrice) {
  return {
    feeOpen:    posSize * entryPrice * TAKER_FEE,
    feeClose:   posSize * closePrice * TAKER_FEE,
    totalFees:  posSize * (entryPrice + closePrice) * TAKER_FEE
  };
}

function calcPositionSize(riskUSD, entryPrice, stopLoss, leverage) {
  const slDist  = Math.abs(entryPrice - stopLoss);
  const slPct   = slDist / entryPrice;
  if (slPct <= 0) return null;
  const posVal  = riskUSD / slPct;
  const posSize = posVal / entryPrice;
  const margin  = posVal / leverage;
  return {
    positionSize: parseFloat(posSize.toFixed(6)),
    positionValue: parseFloat(posVal.toFixed(4)),
    margin: parseFloat(margin.toFixed(4)),
    slPct: parseFloat((slPct * 100).toFixed(3))
  };
}

module.exports = {
  getKlines, getTicker, getTopSymbols, getOI, getFunding,
  getBalance, setLeverage, placeOrder, closePosition,
  calcFees, calcPositionSize,
  paper, TAKER_FEE
};
