// ============================================================
// AXOM — BingX WebSocket Engine (WSS Only)
// ListenKey auto-renewal every 50 min
// Auto-reconnect < 1 second on failure
// ============================================================
const WebSocket = require('ws');
const axios     = require('axios');
const crypto    = require('crypto');
const logger    = require('../utils/logger');

const BINGX_BASE   = 'https://open-api.bingx.com';
const BINGX_WSS    = 'wss://open-api-ws.bingx.com/market';
const BINANCE_WSS  = 'wss://fstream.binance.com'; // fallback public data

// ─── SIGN ─────────────────────────────────────────────────────
function sign(queryString) {
  return crypto
    .createHmac('sha256', process.env.BINGX_SECRET_KEY || '')
    .update(queryString).digest('hex');
}
function authHeaders() {
  return { 'X-BX-APIKEY': process.env.BINGX_API_KEY || '' };
}

// ─── LISTEN KEY MANAGER ───────────────────────────────────────
class ListenKeyManager {
  constructor() {
    this.listenKey  = null;
    this.renewTimer = null;
  }

  async create() {
    try {
      const ts = Date.now();
      const qs = `timestamp=${ts}`;
      const sig = sign(qs);
      const { data } = await axios.post(
        `${BINGX_BASE}/openApi/user/auth/userDataStream?${qs}&signature=${sig}`,
        null, { headers: authHeaders(), timeout: 5000 }
      );
      this.listenKey = data?.listenKey || data?.data?.listenKey || null;
      if (this.listenKey) {
        logger.info('BINGX', `ListenKey created: ${this.listenKey.substring(0, 20)}...`);
        this._startRenewal();
      }
      return this.listenKey;
    } catch (e) {
      logger.error('BINGX', `ListenKey create failed: ${e.message}`);
      return null;
    }
  }

  async renew() {
    if (!this.listenKey) return;
    try {
      const ts = Date.now();
      const qs = `listenKey=${this.listenKey}&timestamp=${ts}`;
      const sig = sign(qs);
      await axios.put(
        `${BINGX_BASE}/openApi/user/auth/userDataStream?${qs}&signature=${sig}`,
        null, { headers: authHeaders(), timeout: 5000 }
      );
      logger.info('BINGX', 'ListenKey renewed ✅');
    } catch (e) {
      logger.warn('BINGX', `ListenKey renew failed: ${e.message} — recreating`);
      await this.create();
    }
  }

  _startRenewal() {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = setInterval(() => this.renew(), 50 * 60 * 1000); // 50 min
  }

  destroy() {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.listenKey = null;
  }
}

// ─── WEBSOCKET CHANNEL ────────────────────────────────────────
class WSSChannel {
  constructor(name, url, onMessage, onOpen) {
    this.name        = name;
    this.url         = url;
    this.onMessage   = onMessage;
    this.onOpen      = onOpen;
    this.ws          = null;
    this.alive       = false;
    this.pingTimer   = null;
    this.reconnTimer = null;
    this.attempts    = 0;
    this.maxAttempts = 999; // infinite retry
  }

  connect() {
    this._clearTimers();
    try {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.alive    = true;
        this.attempts = 0;
        logger.info('WSS', `[${this.name}] Connected ✅`);
        this._startPing();
        if (this.onOpen) this.onOpen(this.ws);
      });

      this.ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          this.onMessage(data);
        } catch (e) {}
      });

      this.ws.on('pong', () => { this.alive = true; });

      this.ws.on('error', (err) => {
        logger.error('WSS', `[${this.name}] Error: ${err.message}`);
      });

      this.ws.on('close', (code) => {
        this.alive = false;
        this._clearTimers();
        const delay = Math.min(500 * (this.attempts + 1), 3000); // max 3s
        logger.warn('WSS', `[${this.name}] Closed (${code}). Reconnecting in ${delay}ms...`);
        this.reconnTimer = setTimeout(() => {
          this.attempts++;
          this.connect();
        }, delay);
      });
    } catch (e) {
      logger.error('WSS', `[${this.name}] Connect exception: ${e.message}`);
      this.reconnTimer = setTimeout(() => this.connect(), 1000);
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  _startPing() {
    this.pingTimer = setInterval(() => {
      if (!this.alive) { this.ws?.terminate(); return; }
      this.alive = false;
      try { this.ws.ping(); } catch (e) {}
    }, 20000);
  }

  _clearTimers() {
    if (this.pingTimer)   { clearInterval(this.pingTimer);   this.pingTimer = null; }
    if (this.reconnTimer) { clearTimeout(this.reconnTimer);  this.reconnTimer = null; }
  }

  isConnected() { return this.alive && this.ws?.readyState === WebSocket.OPEN; }
  close()       { this._clearTimers(); this.ws?.terminate(); }
}

// ─── BINGX WSS ENGINE ────────────────────────────────────────
class BingXWSEngine {
  constructor() {
    this.lkManager      = new ListenKeyManager();
    this.marketChannel  = null; // public price data
    this.accountChannel = null; // private account data
    this.priceCallbacks = [];
    this.liqCallbacks   = [];
    this.orderCallbacks = [];
    this.subscribedSyms = new Set();
  }

  onPrice(cb)     { this.priceCallbacks.push(cb); }
  onLiquidation(cb) { this.liqCallbacks.push(cb); }
  onOrderUpdate(cb) { this.orderCallbacks.push(cb); }

  // ── Public market WSS (Binance compatible for reliability) ──
  connectMarket(symbols) {
    const streams = symbols
      .flatMap(s => [`${s.toLowerCase()}@aggTrade`, `${s.toLowerCase()}@forceOrder`])
      .join('/');
    const url = `${BINANCE_WSS}/stream?streams=${streams}`;

    this.marketChannel = new WSSChannel('MARKET', url, (data) => {
      const { stream, data: d } = data;
      if (!stream || !d) return;

      if (stream.includes('aggTrade')) {
        this.priceCallbacks.forEach(cb => cb({
          symbol: d.s, price: parseFloat(d.p),
          qty: parseFloat(d.q), isBuy: !d.m, ts: d.T
        }));
      }
      if (stream.includes('forceOrder')) {
        this.liqCallbacks.forEach(cb => cb({
          symbol: d.o?.s, side: d.o?.S,
          price: parseFloat(d.o?.p || 0),
          qty:   parseFloat(d.o?.q || 0),
          value: parseFloat(d.o?.p || 0) * parseFloat(d.o?.q || 0)
        }));
      }
    });
    this.marketChannel.connect();
  }

  // ── Private account WSS (BingX listen key) ──
  async connectAccount() {
    const listenKey = await this.lkManager.create();
    if (!listenKey) {
      logger.warn('BINGX', 'No ListenKey — account updates unavailable (check API keys)');
      return;
    }

    const url = `${BINGX_WSS}/swap?listenKey=${listenKey}`;
    this.accountChannel = new WSSChannel('ACCOUNT', url, (data) => {
      if (data.e === 'ORDER_TRADE_UPDATE' || data.e === 'executionReport') {
        this.orderCallbacks.forEach(cb => cb(data));
      }
    });
    this.accountChannel.connect();
  }

  isMarketConnected()  { return this.marketChannel?.isConnected()  || false; }
  isAccountConnected() { return this.accountChannel?.isConnected() || false; }

  getStatus() {
    return {
      market:  this.isMarketConnected()  ? '🟢 متصل' : '🔴 منقطع',
      account: this.isAccountConnected() ? '🟢 متصل' : '🔴 منقطع'
    };
  }

  close() {
    this.marketChannel?.close();
    this.accountChannel?.close();
    this.lkManager.destroy();
  }
}

const engine = new BingXWSEngine();
module.exports = engine;
