// ============================================================
// AXOM — BingX API
// PAPER: internal simulation
// DEMO:  BingX VST (https://open-api-vst.bingx.com)
// REAL:  BingX Live (https://open-api.bingx.com)
// ============================================================
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const BASE_REAL = 'https://open-api.bingx.com';
const BASE_VST  = 'https://open-api-vst.bingx.com';  // Demo/VST
const TAKER_FEE = 0.0005;

function BASE() {
  return process.env.BOT_MODE === 'DEMO' ? BASE_VST : BASE_REAL;
}

// ─── AUTH ─────────────────────────────────────────────────────
function sign(qs) {
  return crypto
    .createHmac('sha256', process.env.BINGX_SECRET_KEY || '')
    .update(qs).digest('hex');
}
function authHeaders() {
  return { 'X-BX-APIKEY': process.env.BINGX_API_KEY || '' };
}
function buildQS(obj) {
  const ts  = Date.now();
  const all = { ...obj, timestamp: ts, recvWindow: 5000 };
  const qs  = Object.entries(all).map(([k,v]) => `${k}=${v}`).join('&');
  return { qs, sig: sign(qs), ts };
}

// ─── PAPER TRADING ENGINE ────────────────────────────────────
class PaperEngine {
  constructor() {
    this.balance   = 1000;
    this.positions = {};
    this._id       = 10000;
    this.history   = [];
  }
  reset(bal = 1000) { this.balance = bal; this.positions = {}; this.history = []; }
  getBalance() {
    const uPnl = Object.values(this.positions).reduce((s,p) => s + (p.uPnl||0), 0);
    return { balance: this.balance, available: this.balance, unrealizedPnl: uPnl };
  }
  open({ symbol, side, qty, price, leverage, sl, tp }) {
    const notional = qty * price;
    const margin   = notional / leverage;
    const fee      = notional * TAKER_FEE;
    if (this.balance < margin + fee) return { success:false, error:'رصيد تجريبي غير كافٍ', balance:this.balance };
    this.balance -= (margin + fee);
    this.positions[symbol] = { symbol, side, qty, entryPrice:price, leverage, margin, sl, tp, fee, orderId:`PAPER_${++this._id}`, uPnl:0 };
    return { success:true, orderId:this.positions[symbol].orderId, status:'FILLED' };
  }
  updatePnl(symbol, price) {
    const p = this.positions[symbol];
    if (!p) return;
    p.uPnl = (p.side==='BUY' ? price-p.entryPrice : p.entryPrice-price) * p.qty;
    p.currentPrice = price;
  }
  close(symbol, closePrice, reason='MANUAL') {
    const p = this.positions[symbol];
    if (!p) return null;
    const pnl    = (p.side==='BUY' ? closePrice-p.entryPrice : p.entryPrice-closePrice) * p.qty;
    const fee    = closePrice * p.qty * TAKER_FEE;
    const netPnl = pnl - fee;
    this.balance += p.margin + netPnl;
    const trade  = { symbol, side:p.side, pnl, fee, netPnl, reason, balance:this.balance };
    this.history.push(trade);
    delete this.positions[symbol];
    return trade;
  }
  getPositions() { return Object.values(this.positions); }
}
const paper = new PaperEngine();

// ─── PUBLIC API (no auth, uses Binance as fallback) ───────────
async function getKlines(symbol, interval, limit = 100) {
  const mode = process.env.BOT_MODE || 'PAPER';
  // Try BingX first (for DEMO/REAL), fallback to Binance public
  if (mode !== 'PAPER') {
    try {
      const { data } = await axios.get(`${BASE()}/openApi/swap/v2/quote/klines`, {
        params: { symbol, interval, limit }, timeout: 5000
      });
      if (data?.data?.length) {
        return data.data.map(k => ({ openTime:+k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] }));
      }
    } catch (e) { logger.warn('BINGX', `getKlines ${symbol} BingX failed, using Binance: ${e.message}`); }
  }
  // Binance public fallback
  try {
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
      params: { symbol, interval, limit }, timeout: 5000
    });
    return data.map(k => ({ openTime:+k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] }));
  } catch (e) {
    logger.error('BINGX', `getKlines ${symbol}: ${e.message}`);
    return [];
  }
}

async function getTicker(symbol) {
  try {
    const { data } = await axios.get(`${BASE_REAL}/openApi/swap/v2/quote/ticker`, { params:{ symbol }, timeout:3000 });
    const d = data?.data||{};
    return { price:+d.lastPrice||0, change:+d.priceChangePercent||0, volume:+d.quoteVolume||0 };
  } catch {
    try {
      const { data } = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', { params:{ symbol }, timeout:3000 });
      return { price:+data.lastPrice, change:+data.priceChangePercent, volume:+data.quoteVolume };
    } catch { return { price:0, change:0, volume:0 }; }
  }
}

async function getTopSymbols(limit = 50) {
  try {
    const { data } = await axios.get(`${BASE_REAL}/openApi/swap/v2/quote/ticker`, { timeout:5000 });
    const tickers = Array.isArray(data?.data) ? data.data : [];
    if (tickers.length) {
      return tickers
        .filter(t => t.symbol?.endsWith('-USDT') && +t.quoteVolume > 20000000)
        .sort((a,b) => +b.quoteVolume - +a.quoteVolume)
        .slice(0, limit)
        .map(t => t.symbol.replace('-USDT','USDT'));
    }
  } catch {}
  try {
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', { timeout:5000 });
    return data
      .filter(t => t.symbol.endsWith('USDT') && +t.quoteVolume > 50000000)
      .sort((a,b) => +b.quoteVolume - +a.quoteVolume)
      .slice(0, limit)
      .map(t => t.symbol);
  } catch { return ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT']; }
}

async function getOI(symbol) {
  try {
    const { data } = await axios.get(`${BASE_REAL}/openApi/swap/v2/quote/openInterest`, { params:{ symbol }, timeout:3000 });
    return parseFloat(data?.data?.openInterest || 0);
  } catch {
    try {
      const { data } = await axios.get('https://fapi.binance.com/fapi/v1/openInterest', { params:{ symbol }, timeout:3000 });
      return parseFloat(data.openInterest || 0);
    } catch { return 0; }
  }
}

async function getFunding(symbol) {
  try {
    const { data } = await axios.get(`${BASE_REAL}/openApi/swap/v2/quote/premiumIndex`, { params:{ symbol }, timeout:3000 });
    return { fundingRate:parseFloat(data?.data?.lastFundingRate||0), markPrice:parseFloat(data?.data?.markPrice||0) };
  } catch {
    try {
      const { data } = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { params:{ symbol }, timeout:3000 });
      return { fundingRate:parseFloat(data.lastFundingRate||0), markPrice:parseFloat(data.markPrice||0) };
    } catch { return { fundingRate:0, markPrice:0 }; }
  }
}

// ─── BALANCE (auth required) ─────────────────────────────────
async function getBalance() {
  const mode = process.env.BOT_MODE || 'PAPER';

  if (mode === 'PAPER') {
    const pb = paper.getBalance();
    return { mode:'PAPER', balance:pb.balance, available:pb.available, unrealizedPnl:pb.unrealizedPnl };
  }

  // DEMO (VST) or REAL — same endpoint, different base URL
  const { qs, sig } = buildQS({});
  try {
    const { data } = await axios.get(`${BASE()}/openApi/swap/v2/user/balance`, {
      params: { timestamp: Date.now(), recvWindow:5000, signature: sign(`timestamp=${Date.now()}&recvWindow=5000`) },
      headers: authHeaders(), timeout: 5000
    });
    const usdt = (data?.data?.balance?.assets || []).find(a => a.asset === 'USDT');
    const bal  = parseFloat(usdt?.availableMargin || 0);
    if (!usdt) {
      logger.warn('BINGX', `No USDT balance found in ${mode} account`);
      return { mode, balance:0, available:0, error:'لا يوجد رصيد USDT' };
    }
    return { mode, balance:bal, available:bal };
  } catch (e) {
    logger.error('BINGX', `getBalance ${mode} failed: ${e.message}`);
    throw new Error(`فشل جلب رصيد ${mode}: ${e.message}`);
  }
}

// ─── SET LEVERAGE ────────────────────────────────────────────
async function setLeverage(symbol, leverage) {
  if (process.env.BOT_MODE === 'PAPER') return { leverage };
  try {
    const qs  = `symbol=${symbol}&side=Long&leverage=${leverage}&timestamp=${Date.now()}&recvWindow=5000`;
    const sig = sign(qs);
    const { data } = await axios.post(`${BASE()}/openApi/swap/v2/trade/leverage?${qs}&signature=${sig}`, null, { headers:authHeaders(), timeout:5000 });
    return data?.data || { leverage };
  } catch (e) {
    logger.warn('BINGX', `setLeverage ${symbol}: ${e.message}`);
    return { leverage };
  }
}

// ─── PLACE ORDER ─────────────────────────────────────────────
async function placeOrder({ symbol, side, type='MARKET', quantity, price, leverage=10, stopLoss, takeProfit }) {
  const mode = process.env.BOT_MODE || 'PAPER';

  if (mode === 'PAPER') {
    return paper.open({ symbol, side, qty:quantity, price:price||0, leverage, sl:stopLoss, tp:takeProfit });
  }

  try {
    await setLeverage(symbol, leverage);

    const orderData = {
      symbol, side, type,
      quantity: quantity.toFixed(3),
      positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
      timestamp: Date.now(), recvWindow: 5000
    };
    if (type==='LIMIT' && price) { orderData.price = price.toFixed(2); orderData.timeInForce = 'GTC'; }

    const qs  = Object.entries(orderData).map(([k,v])=>`${k}=${v}`).join('&');
    const sig = sign(qs);
    const { data } = await axios.post(`${BASE()}/openApi/swap/v2/trade/order?${qs}&signature=${sig}`, null, { headers:authHeaders(), timeout:5000 });

    const orderId = data?.data?.orderId;
    if (!orderId) throw new Error(data?.msg || 'No orderId returned');

    if (stopLoss)   await _placeSLTP(symbol, side, quantity, stopLoss,   'STOP_MARKET');
    if (takeProfit) await _placeSLTP(symbol, side, quantity, takeProfit, 'TAKE_PROFIT_MARKET');

    return { success:true, orderId, status:data?.data?.status || 'FILLED' };
  } catch (e) {
    logger.error('BINGX', `placeOrder ${symbol}: ${e.message}`);
    return { success:false, error:e.message };
  }
}

async function _placeSLTP(symbol, side, qty, stopPrice, type) {
  try {
    const closeSide = side==='BUY'?'SELL':'BUY';
    const qs = `symbol=${symbol}&side=${closeSide}&type=${type}&quantity=${qty.toFixed(3)}&stopPrice=${stopPrice.toFixed(2)}&reduceOnly=true&timestamp=${Date.now()}&recvWindow=5000`;
    await axios.post(`${BASE()}/openApi/swap/v2/trade/order?${qs}&signature=${sign(qs)}`, null, { headers:authHeaders(), timeout:5000 });
  } catch (e) { logger.warn('BINGX', `SL/TP ${symbol}: ${e.message}`); }
}

// ─── CLOSE POSITION ──────────────────────────────────────────
async function closePosition(symbol, side, qty, currentPrice) {
  const mode = process.env.BOT_MODE || 'PAPER';
  if (mode === 'PAPER') return paper.close(symbol, currentPrice, 'CLOSE');
  try {
    const closeSide = side==='BUY'?'SELL':'BUY';
    const qs  = `symbol=${symbol}&side=${closeSide}&type=MARKET&quantity=${qty.toFixed(3)}&reduceOnly=true&timestamp=${Date.now()}&recvWindow=5000`;
    const { data } = await axios.post(`${BASE()}/openApi/swap/v2/trade/order?${qs}&signature=${sign(qs)}`, null, { headers:authHeaders(), timeout:5000 });
    return { success:true, orderId:data?.data?.orderId };
  } catch (e) {
    logger.error('BINGX', `closePosition ${symbol}: ${e.message}`);
    return { success:false, error:e.message };
  }
}

// ─── CALC HELPERS ────────────────────────────────────────────
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
  const posVal  = riskUSD / slPct;
  const posSize = posVal / entryPrice;
  return {
    positionSize:  parseFloat(posSize.toFixed(6)),
    positionValue: parseFloat(posVal.toFixed(4)),
    margin:        parseFloat((posVal / leverage).toFixed(4)),
    slPct:         parseFloat((slPct * 100).toFixed(3))
  };
}

module.exports = {
  getKlines, getTicker, getTopSymbols, getOI, getFunding,
  getBalance, setLeverage, placeOrder, closePosition,
  calcFees, calcPositionSize,
  paper, TAKER_FEE
};
