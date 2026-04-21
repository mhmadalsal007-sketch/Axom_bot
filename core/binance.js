const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');

const BASE = 'https://fapi.binance.com';
const WS_BASE = 'wss://fstream.binance.com';
const TAKER_FEE = 0.0004; // 0.04%
const MAKER_FEE = 0.0002; // 0.02%

// ─── SIGNATURE ───────────────────────────────────────────────
function sign(params) {
  const q = Object.entries(params).map(([k,v]) => `${k}=${v}`).join('&');
  return crypto.createHmac('sha256', process.env.BINANCE_SECRET_KEY).update(q).digest('hex');
}

function headers() {
  return { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY };
}

// ─── PUBLIC ENDPOINTS ────────────────────────────────────────
async function getKlines(symbol, interval, limit = 100) {
  const { data } = await axios.get(`${BASE}/fapi/v1/klines`, {
    params: { symbol, interval, limit },
    timeout: 5000
  });
  return data.map(k => ({
    openTime: k[0], open: +k[1], high: +k[2], low: +k[3],
    close: +k[4], volume: +k[5], closeTime: k[6]
  }));
}

async function getPrice(symbol) {
  const { data } = await axios.get(`${BASE}/fapi/v1/ticker/price`, { params: { symbol }, timeout: 3000 });
  return parseFloat(data.price);
}

async function getTicker24h(symbol) {
  const { data } = await axios.get(`${BASE}/fapi/v1/ticker/24hr`, { params: { symbol }, timeout: 3000 });
  return {
    price: parseFloat(data.lastPrice),
    change: parseFloat(data.priceChangePercent),
    volume: parseFloat(data.quoteVolume),
    high: parseFloat(data.highPrice),
    low: parseFloat(data.lowPrice)
  };
}

async function getTopSymbols(limit = 50) {
  const { data } = await axios.get(`${BASE}/fapi/v1/ticker/24hr`, { timeout: 5000 });
  return data
    .filter(s => s.symbol.endsWith('USDT') && parseFloat(s.quoteVolume) > 100000000)
    .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map(s => s.symbol);
}

async function getOI(symbol) {
  const { data } = await axios.get(`${BASE}/fapi/v1/openInterest`, { params: { symbol }, timeout: 3000 });
  return parseFloat(data.openInterest);
}

async function getOIHistory(symbol, period = '1h', limit = 5) {
  const { data } = await axios.get(`${BASE}/futures/data/openInterestHist`, {
    params: { symbol, period, limit }, timeout: 3000
  });
  return data.map(d => ({ time: d.timestamp, oi: parseFloat(d.sumOpenInterest) }));
}

async function getFunding(symbol) {
  const { data } = await axios.get(`${BASE}/fapi/v1/premiumIndex`, { params: { symbol }, timeout: 3000 });
  return {
    fundingRate: parseFloat(data.lastFundingRate),
    nextFundingTime: data.nextFundingTime,
    markPrice: parseFloat(data.markPrice)
  };
}

async function getLSRatio(symbol) {
  try {
    const { data } = await axios.get(`${BASE}/futures/data/globalLongShortAccountRatio`, {
      params: { symbol, period: '1h', limit: 1 }, timeout: 3000
    });
    return parseFloat(data[0]?.longShortRatio || 1);
  } catch { return 1; }
}

async function getOrderBook(symbol, limit = 20) {
  const { data } = await axios.get(`${BASE}/fapi/v1/depth`, { params: { symbol, limit }, timeout: 3000 });
  return {
    bids: data.bids.map(b => ({ price: +b[0], qty: +b[1] })),
    asks: data.asks.map(a => ({ price: +a[0], qty: +a[1] }))
  };
}

// ─── FEE & POSITION CALCULATOR ───────────────────────────────
function calcFees(positionSize, entryPrice, closePrice) {
  const notionalOpen = positionSize * entryPrice;
  const notionalClose = positionSize * closePrice;
  const feeOpen = notionalOpen * TAKER_FEE;
  const feeClose = notionalClose * TAKER_FEE;
  return { feeOpen, feeClose, totalFees: feeOpen + feeClose };
}

function calcPositionSize(riskAmount, entryPrice, stopLoss, leverage) {
  const slDist = Math.abs(entryPrice - stopLoss);
  const slPct = slDist / entryPrice;
  if (slPct <= 0) return null;
  const positionValue = riskAmount / slPct;
  const positionSize = positionValue / entryPrice;
  const margin = positionValue / leverage;
  return {
    positionSize: parseFloat(positionSize.toFixed(6)),
    positionValue: parseFloat(positionValue.toFixed(4)),
    margin: parseFloat(margin.toFixed(4)),
    slPct: parseFloat((slPct * 100).toFixed(4))
  };
}

// ─── AUTHENTICATED ENDPOINTS ─────────────────────────────────
async function setLeverage(symbol, leverage) {
  if (process.env.BOT_MODE !== 'REAL') return { leverage };
  const params = { symbol, leverage, timestamp: Date.now() };
  params.signature = sign(params);
  const { data } = await axios.post(`${BASE}/fapi/v1/leverage`, null, { params, headers: headers(), timeout: 5000 });
  return data;
}

async function placeOrder({ symbol, side, type, quantity, price, stopPrice, reduceOnly }) {
  if (process.env.BOT_MODE !== 'REAL') {
    return { orderId: `PAPER_${Date.now()}`, status: 'FILLED', price: price || 0, clientOrderId: `axom_${Date.now()}` };
  }
  const params = { symbol, side, type, timestamp: Date.now(), recvWindow: 5000 };
  if (quantity) params.quantity = parseFloat(quantity).toFixed(3);
  if (type === 'LIMIT' && price) { params.price = parseFloat(price).toFixed(2); params.timeInForce = 'GTC'; }
  if ((type === 'STOP_MARKET' || type === 'TAKE_PROFIT_MARKET') && stopPrice) params.stopPrice = parseFloat(stopPrice).toFixed(2);
  if (reduceOnly) params.reduceOnly = true;
  params.signature = sign(params);
  const { data } = await axios.post(`${BASE}/fapi/v1/order`, null, { params, headers: headers(), timeout: 5000 });
  return data;
}

async function cancelOrder(symbol, orderId) {
  if (process.env.BOT_MODE !== 'REAL') return { status: 'CANCELED' };
  const params = { symbol, orderId, timestamp: Date.now() };
  params.signature = sign(params);
  const { data } = await axios.delete(`${BASE}/fapi/v1/order`, { params, headers: headers(), timeout: 5000 });
  return data;
}

async function getBalance() {
  if (process.env.BOT_MODE !== 'REAL') return { balance: parseFloat(process.env.PAPER_BALANCE || 1000) };
  const params = { timestamp: Date.now() };
  params.signature = sign(params);
  const { data } = await axios.get(`${BASE}/fapi/v2/balance`, { params, headers: headers(), timeout: 5000 });
  const usdt = data.find(b => b.asset === 'USDT');
  return { balance: parseFloat(usdt?.availableBalance || 0) };
}

async function getPositions() {
  if (process.env.BOT_MODE !== 'REAL') return [];
  const params = { timestamp: Date.now() };
  params.signature = sign(params);
  const { data } = await axios.get(`${BASE}/fapi/v2/positionRisk`, { params, headers: headers(), timeout: 5000 });
  return data.filter(p => parseFloat(p.positionAmt) !== 0);
}

// ─── WEBSOCKET MANAGER ───────────────────────────────────────
class AxomWebSocket {
  constructor() {
    this.ws = null;
    this.isAlive = false;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.reconnectAttempts = 0;
    this.priceCallbacks = [];
    this.liquidationCallbacks = [];
    this.symbols = [];
  }

  onPrice(cb) { this.priceCallbacks.push(cb); }
  onLiquidation(cb) { this.liquidationCallbacks.push(cb); }

  connect(symbols) {
    this.symbols = symbols;
    const streams = symbols.flatMap(s => [`${s.toLowerCase()}@aggTrade`, `${s.toLowerCase()}@forceOrder`]).join('/');
    const url = `${WS_BASE}/stream?streams=${streams}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.isAlive = true;
      this.reconnectAttempts = 0;
      this._startPing();
      console.log(`✅ WebSocket connected (${symbols.length} pairs)`);
    });

    this.ws.on('message', (raw) => {
      try {
        const { stream, data } = JSON.parse(raw);
        if (!stream || !data) return;
        if (stream.includes('aggTrade')) {
          const tick = { symbol: data.s, price: parseFloat(data.p), qty: parseFloat(data.q), time: data.T, isBuy: !data.m };
          this.priceCallbacks.forEach(cb => cb(tick));
        }
        if (stream.includes('forceOrder')) {
          const liq = { symbol: data.o?.s, side: data.o?.S, price: parseFloat(data.o?.p||0), qty: parseFloat(data.o?.q||0), value: parseFloat(data.o?.p||0)*parseFloat(data.o?.q||0) };
          this.liquidationCallbacks.forEach(cb => cb(liq));
        }
      } catch (e) {}
    });

    this.ws.on('pong', () => { this.isAlive = true; });

    this.ws.on('close', () => {
      this.isAlive = false;
      this._clearPing();
      const delay = Math.min(3000 * (this.reconnectAttempts + 1), 30000);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        console.log(`🔄 WS reconnecting (attempt ${this.reconnectAttempts})...`);
        this.connect(this.symbols);
      }, delay);
    });

    this.ws.on('error', (err) => { console.error('WS Error:', err.message); });
  }

  _startPing() {
    this._clearPing();
    this.pingTimer = setInterval(() => {
      if (!this.isAlive) { this.ws.terminate(); return; }
      this.isAlive = false;
      this.ws.ping();
    }, 20000);
  }

  _clearPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  isConnected() { return this.isAlive; }
  disconnect() { this._clearPing(); if (this.ws) this.ws.terminate(); }
}

module.exports = {
  getKlines, getPrice, getTicker24h, getTopSymbols,
  getOI, getOIHistory, getFunding, getLSRatio, getOrderBook,
  calcFees, calcPositionSize,
  setLeverage, placeOrder, cancelOrder, getBalance, getPositions,
  AxomWebSocket, TAKER_FEE
};
