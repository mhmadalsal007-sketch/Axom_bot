// ============================================================
// AXOM — BingX API (replaces Binance)
// Supports both REAL and PAPER trading modes
// ============================================================
const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');

const BASE = 'https://open-api.bingx.com';
const WS_BASE = 'wss://open-api-ws.bingx.com/market';
const TAKER_FEE = 0.0005; // 0.05% BingX taker
const MAKER_FEE = 0.0002; // 0.02% BingX maker

// ─── PAPER TRADING STATE ─────────────────────────────────────
const paperState = {
  balance: 1000,
  positions: {},
  orders: {},
  orderIdCounter: 1000
};

function resetPaper(balance = 1000) {
  paperState.balance = balance;
  paperState.positions = {};
  paperState.orders = {};
  paperState.orderIdCounter = 1000;
}

function getPaperBalance() { return paperState.balance; }

function updatePaperBalance(amount) {
  paperState.balance += amount;
  return paperState.balance;
}

// ─── SIGNATURE ───────────────────────────────────────────────
function sign(params) {
  const q = Object.entries(params)
    .filter(([,v]) => v !== undefined)
    .map(([k,v]) => `${k}=${v}`)
    .join('&');
  return crypto.createHmac('sha256', process.env.BINGX_SECRET_KEY || process.env.BINANCE_SECRET_KEY || '')
    .update(q).digest('hex');
}

function headers() {
  return { 'X-BX-APIKEY': process.env.BINGX_API_KEY || process.env.BINANCE_API_KEY || '' };
}

// ─── PUBLIC API ───────────────────────────────────────────────
async function getKlines(symbol, interval, limit = 100) {
  // BingX interval format: 1m, 5m, 15m, 30m, 1h, 4h, 1d
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/klines`, {
      params: { symbol, interval, limit },
      timeout: 5000
    });
    if (!data?.data) return getFallbackKlines(symbol, interval, limit);
    return data.data.map(k => ({
      openTime: k[0], open: +k[1], high: +k[2], low: +k[3],
      close: +k[4], volume: +k[5], closeTime: k[6]
    }));
  } catch (e) {
    return getFallbackKlines(symbol, interval, limit);
  }
}

// Fallback to Binance public API if BingX fails
async function getFallbackKlines(symbol, interval, limit) {
  const { data } = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
    params: { symbol, interval, limit }, timeout: 5000
  });
  return data.map(k => ({
    openTime: k[0], open: +k[1], high: +k[2], low: +k[3],
    close: +k[4], volume: +k[5], closeTime: k[6]
  }));
}

async function getPrice(symbol) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/price`, {
      params: { symbol }, timeout: 3000
    });
    return parseFloat(data?.data?.price || 0);
  } catch {
    // Fallback Binance
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price', {
      params: { symbol }, timeout: 3000
    });
    return parseFloat(data.price);
  }
}

async function getTicker24h(symbol) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/ticker`, {
      params: { symbol }, timeout: 3000
    });
    const d = data?.data || {};
    return {
      price: parseFloat(d.lastPrice || 0),
      change: parseFloat(d.priceChangePercent || 0),
      volume: parseFloat(d.quoteVolume || 0),
      high: parseFloat(d.highPrice || 0),
      low: parseFloat(d.lowPrice || 0)
    };
  } catch {
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', {
      params: { symbol }, timeout: 3000
    });
    return {
      price: parseFloat(data.lastPrice),
      change: parseFloat(data.priceChangePercent),
      volume: parseFloat(data.quoteVolume),
      high: parseFloat(data.highPrice),
      low: parseFloat(data.lowPrice)
    };
  }
}

async function getTopSymbols(limit = 50) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/ticker`, { timeout: 5000 });
    const tickers = Array.isArray(data?.data) ? data.data : [];
    return tickers
      .filter(s => s.symbol?.endsWith('-USDT') && parseFloat(s.quoteVolume) > 50000000)
      .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(s => s.symbol.replace('-', ''));
  } catch {
    // Fallback
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', { timeout: 5000 });
    return data
      .filter(s => s.symbol.endsWith('USDT') && parseFloat(s.quoteVolume) > 100000000)
      .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(s => s.symbol);
  }
}

async function getOI(symbol) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/openInterest`, {
      params: { symbol }, timeout: 3000
    });
    return parseFloat(data?.data?.openInterest || 0);
  } catch {
    try {
      const sym = symbol.replace('USDT', '') + 'USDT';
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
      markPrice: parseFloat(data?.data?.markPrice || 0)
    };
  } catch {
    try {
      const { data } = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', {
        params: { symbol }, timeout: 3000
      });
      return {
        fundingRate: parseFloat(data.lastFundingRate || 0),
        markPrice: parseFloat(data.markPrice || 0)
      };
    } catch { return { fundingRate: 0, markPrice: 0 }; }
  }
}

async function getLSRatio(symbol) {
  try {
    const { data } = await axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol, period: '1h', limit: 1 }, timeout: 3000
    });
    return parseFloat(data[0]?.longShortRatio || 1);
  } catch { return 1; }
}

async function getOrderBook(symbol, limit = 20) {
  try {
    const { data } = await axios.get(`${BASE}/openApi/swap/v2/quote/depth`, {
      params: { symbol, limit }, timeout: 3000
    });
    return {
      bids: (data?.data?.bids || []).map(b => ({ price: +b[0], qty: +b[1] })),
      asks: (data?.data?.asks || []).map(a => ({ price: +a[0], qty: +a[1] }))
    };
  } catch { return { bids: [], asks: [] }; }
}

// ─── FEE CALCULATOR ───────────────────────────────────────────
function calcFees(positionSize, entryPrice, closePrice) {
  const feeOpen  = positionSize * entryPrice * TAKER_FEE;
  const feeClose = positionSize * closePrice * TAKER_FEE;
  return { feeOpen, feeClose, totalFees: feeOpen + feeClose };
}

function calcPositionSize(riskAmount, entryPrice, stopLoss, leverage) {
  const slDist = Math.abs(entryPrice - stopLoss);
  const slPct  = slDist / entryPrice;
  if (slPct <= 0) return null;
  const positionValue = riskAmount / slPct;
  const positionSize  = positionValue / entryPrice;
  const margin        = positionValue / leverage;
  return {
    positionSize: parseFloat(positionSize.toFixed(6)),
    positionValue: parseFloat(positionValue.toFixed(4)),
    margin: parseFloat(margin.toFixed(4)),
    slPct: parseFloat((slPct * 100).toFixed(4))
  };
}

// ─── PAPER TRADING ENGINE ────────────────────────────────────
function paperPlaceOrder({ symbol, side, type, quantity, price, stopPrice }) {
  const orderId = `PAPER_${++paperState.orderIdCounter}`;
  const execPrice = price || stopPrice || 0;

  if (type === 'MARKET' || type === 'LIMIT') {
    // Simulate fill
    paperState.positions[symbol] = paperState.positions[symbol] || { size: 0, side: null, entryPrice: 0 };
    const pos = paperState.positions[symbol];

    if (!pos.side || pos.size === 0) {
      pos.side = side;
      pos.size = parseFloat(quantity);
      pos.entryPrice = execPrice;
    } else {
      // Add to position
      pos.size += parseFloat(quantity);
    }
  }

  return { orderId, status: 'FILLED', price: execPrice, symbol, side, quantity };
}

function paperClosePosition(symbol, closePrice, size) {
  const pos = paperState.positions[symbol];
  if (!pos || pos.size === 0) return { pnl: 0 };

  const closeSize = size || pos.size;
  const isLong = pos.side === 'BUY';
  const pnl = isLong
    ? (closePrice - pos.entryPrice) * closeSize
    : (pos.entryPrice - closePrice) * closeSize;

  pos.size -= closeSize;
  if (pos.size <= 0) {
    pos.size = 0;
    pos.side = null;
    pos.entryPrice = 0;
  }

  updatePaperBalance(pnl);
  return { pnl, closedSize: closeSize };
}

function getPaperPositions() {
  return Object.entries(paperState.positions)
    .filter(([,p]) => p.size > 0)
    .map(([symbol, p]) => ({ symbol, ...p }));
}

// ─── REAL TRADING ENDPOINTS ───────────────────────────────────
async function setLeverage(symbol, leverage) {
  if (process.env.BOT_MODE !== 'REAL') return { leverage };
  const params = { symbol, leverage, timestamp: Date.now(), recvWindow: 5000 };
  params.signature = sign(params);
  try {
    const { data } = await axios.post(`${BASE}/openApi/swap/v2/trade/leverage`, null, {
      params, headers: headers(), timeout: 5000
    });
    return data?.data || { leverage };
  } catch (e) {
    console.error('setLeverage error:', e.message);
    return { leverage };
  }
}

async function placeOrder({ symbol, side, type, quantity, price, stopPrice, reduceOnly }) {
  if (process.env.BOT_MODE !== 'REAL') {
    return paperPlaceOrder({ symbol, side, type, quantity, price, stopPrice });
  }

  const params = {
    symbol, side, type,
    quantity: parseFloat(quantity).toFixed(3),
    timestamp: Date.now(),
    recvWindow: 5000
  };

  if (type === 'LIMIT' && price) {
    params.price = parseFloat(price).toFixed(2);
    params.timeInForce = 'GTC';
  }
  if (stopPrice) params.stopPrice = parseFloat(stopPrice).toFixed(2);
  if (reduceOnly) params.reduceOnly = 'true';

  params.signature = sign(params);

  const { data } = await axios.post(`${BASE}/openApi/swap/v2/trade/order`, null, {
    params, headers: headers(), timeout: 5000
  });
  return data?.data || {};
}

async function cancelOrder(symbol, orderId) {
  if (process.env.BOT_MODE !== 'REAL') return { status: 'CANCELED' };
  const params = { symbol, orderId, timestamp: Date.now() };
  params.signature = sign(params);
  const { data } = await axios.delete(`${BASE}/openApi/swap/v2/trade/order`, {
    params, headers: headers(), timeout: 5000
  });
  return data?.data || {};
}

async function getBalance() {
  if (process.env.BOT_MODE !== 'REAL') {
    return { balance: getPaperBalance() };
  }
  const params = { timestamp: Date.now() };
  params.signature = sign(params);
  const { data } = await axios.get(`${BASE}/openApi/swap/v2/user/balance`, {
    params, headers: headers(), timeout: 5000
  });
  const usdt = (data?.data?.balance?.assets || []).find(a => a.asset === 'USDT');
  return { balance: parseFloat(usdt?.availableMargin || 0) };
}

async function getPositions() {
  if (process.env.BOT_MODE !== 'REAL') return getPaperPositions();
  const params = { timestamp: Date.now() };
  params.signature = sign(params);
  const { data } = await axios.get(`${BASE}/openApi/swap/v2/user/positions`, {
    params, headers: headers(), timeout: 5000
  });
  return (data?.data || []).filter(p => parseFloat(p.positionAmt || 0) !== 0);
}

// ─── BINGX WEBSOCKET ─────────────────────────────────────────
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
    // BingX uses Binance-compatible stream format for public data
    // Fall back to Binance public WS for price feeds
    const streams = symbols.flatMap(s => [
      `${s.toLowerCase()}@aggTrade`,
      `${s.toLowerCase()}@forceOrder`
    ]).join('/');

    const url = `wss://fstream.binance.com/stream?streams=${streams}`;
    this._connectWS(url);
  }

  _connectWS(url) {
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.isAlive = true;
      this.reconnectAttempts = 0;
      this._startPing();
      console.log(`✅ WebSocket connected`);
    });

    this.ws.on('message', (raw) => {
      try {
        const { stream, data } = JSON.parse(raw);
        if (!stream || !data) return;

        if (stream.includes('aggTrade')) {
          this.priceCallbacks.forEach(cb => cb({
            symbol: data.s,
            price: parseFloat(data.p),
            qty: parseFloat(data.q),
            time: data.T
          }));
        }

        if (stream.includes('forceOrder')) {
          this.liquidationCallbacks.forEach(cb => cb({
            symbol: data.o?.s,
            side: data.o?.S,
            price: parseFloat(data.o?.p || 0),
            qty: parseFloat(data.o?.q || 0),
            value: parseFloat(data.o?.p || 0) * parseFloat(data.o?.q || 0)
          }));
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
        console.log(`🔄 Reconnecting WS (attempt ${this.reconnectAttempts})...`);
        this._connectWS(url);
      }, delay);
    });

    this.ws.on('error', (err) => {
      console.error('WS Error:', err.message);
    });
  }

  _startPing() {
    this._clearPing();
    this.pingTimer = setInterval(() => {
      if (!this.isAlive) { this.ws?.terminate(); return; }
      this.isAlive = false;
      try { this.ws.ping(); } catch (e) {}
    }, 20000);
  }

  _clearPing() {
    if (this.pingTimer)    { clearInterval(this.pingTimer);    this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  isConnected() { return this.isAlive; }
  disconnect()  { this._clearPing(); this.ws?.terminate(); }
}

module.exports = {
  // Public
  getKlines, getPrice, getTicker24h, getTopSymbols,
  getOI, getFunding, getLSRatio, getOrderBook,
  // Calc
  calcFees, calcPositionSize,
  // Trading
  setLeverage, placeOrder, cancelOrder, getBalance, getPositions,
  // Paper
  resetPaper, getPaperBalance, updatePaperBalance,
  paperPlaceOrder, paperClosePosition, getPaperPositions,
  // WS
  AxomWebSocket, TAKER_FEE
};
