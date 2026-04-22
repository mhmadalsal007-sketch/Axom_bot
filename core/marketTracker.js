// ============================================================
// AXOM — MarketTracker
// Single source of truth for all live market data
// ============================================================

class MarketTracker {
  constructor() {
    this.prices     = {};   // symbol → price
    this.prevPrices = {};
    this.oiData     = {};   // symbol → {oi, prevOI, change1h}
    this.funding    = {};   // symbol → rate
    this.liq1h      = {};   // symbol → USD in last hour
    this._liqLog    = {};   // symbol → [{ts, val}]
    this.volRatio   = {};   // symbol → ratio vs avg
    this.priceHist  = {};   // symbol → [{price, ts}] last 30 ticks
    this.updatedAt  = {};   // symbol → timestamp
  }

  // ─── PRICE ──────────────────────────────────────────────────
  setPrice(symbol, price) {
    this.prevPrices[symbol] = this.prices[symbol] || price;
    this.prices[symbol]     = price;
    this.updatedAt[symbol]  = Date.now();

    if (!this.priceHist[symbol]) this.priceHist[symbol] = [];
    this.priceHist[symbol].push({ price, ts: Date.now() });
    if (this.priceHist[symbol].length > 30) this.priceHist[symbol].shift();
  }

  getPrice(symbol)    { return this.prices[symbol] || null; }
  getAllPrices()       { return { ...this.prices }; }

  getPriceChange(symbol) {
    const c = this.prices[symbol], p = this.prevPrices[symbol];
    if (!c || !p) return 0;
    return ((c - p) / p) * 100;
  }

  isFlashCrash(symbol, thresholdPct = 1.5) {
    const hist = this.priceHist[symbol];
    if (!hist || hist.length < 2) return false;
    const now    = Date.now();
    const recent = hist.filter(h => now - h.ts < 10000);
    if (recent.length < 2) return false;
    const chg = Math.abs((recent.at(-1).price - recent[0].price) / recent[0].price) * 100;
    return chg > thresholdPct;
  }

  // ─── OI ─────────────────────────────────────────────────────
  setOI(symbol, oi) {
    const prev = this.oiData[symbol]?.oi || oi;
    const chg  = prev > 0 ? ((oi - prev) / prev) * 100 : 0;
    this.oiData[symbol] = { oi, prevOI: prev, change1h: parseFloat(chg.toFixed(3)) };
  }
  getOIChange(symbol) { return this.oiData[symbol]?.change1h || 0; }
  getOI(symbol)       { return this.oiData[symbol]?.oi || 0; }

  // ─── FUNDING ────────────────────────────────────────────────
  setFunding(symbol, rate) { this.funding[symbol] = rate; }
  getFunding(symbol)       { return this.funding[symbol] || 0; }
  isFundingDangerous(symbol, dir) {
    const r = this.getFunding(symbol);
    return dir === 'LONG' ? r > 0.001 : r < -0.0008;
  }

  // ─── LIQUIDATIONS ───────────────────────────────────────────
  addLiquidation(symbol, value) {
    if (!this._liqLog[symbol]) this._liqLog[symbol] = [];
    this._liqLog[symbol].push({ ts: Date.now(), val: value });
    const cutoff = Date.now() - 3600000;
    this._liqLog[symbol] = this._liqLog[symbol].filter(l => l.ts > cutoff);
    this.liq1h[symbol]   = this._liqLog[symbol].reduce((s,l) => s + l.val, 0);
  }
  getLiq1h(symbol) { return this.liq1h[symbol] || 0; }

  // ─── VOLUME ─────────────────────────────────────────────────
  setVolRatio(symbol, ratio) { this.volRatio[symbol] = ratio; }
  getVolRatio(symbol)        { return this.volRatio[symbol] || 1; }

  // ─── SNAPSHOT ───────────────────────────────────────────────
  getSnapshot(symbol) {
    return {
      symbol,
      price:      this.prices[symbol] || 0,
      priceChg:   this.getPriceChange(symbol),
      oi:         this.getOI(symbol),
      oiChg1h:    this.getOIChange(symbol),
      funding:    this.getFunding(symbol),
      liq1h:      this.getLiq1h(symbol),
      volRatio:   this.getVolRatio(symbol),
      flashCrash: this.isFlashCrash(symbol),
      stale:      Date.now() - (this.updatedAt[symbol] || 0) > 10000
    };
  }

  // ─── TOP MOVERS ─────────────────────────────────────────────
  getTopByOI(n = 5) {
    return Object.keys(this.oiData)
      .map(s => ({ symbol: s, oiChg: Math.abs(this.getOIChange(s)) }))
      .sort((a,b) => b.oiChg - a.oiChg)
      .slice(0, n);
  }

  getSummary() {
    const syms = Object.keys(this.prices);
    return {
      tracked: syms.length,
      topMovers: syms.map(s => ({ symbol:s, chg: this.getPriceChange(s) }))
        .sort((a,b) => Math.abs(b.chg)-Math.abs(a.chg)).slice(0,3),
      highLiq: syms.filter(s => this.getLiq1h(s) > 1000000)
        .map(s => ({ symbol:s, liq: this.getLiq1h(s) }))
        .sort((a,b) => b.liq-a.liq).slice(0,3)
    };
  }
}

module.exports = new MarketTracker();
