// ============================================================
// AXOM — Live Market Tracker
// Tracks real-time prices, OI, funding, liquidations
// ============================================================

class MarketTracker {
  constructor() {
    this.prices = {};          // symbol → price
    this.prevPrices = {};      // for % change calc
    this.oiData = {};          // symbol → { current, prev, change }
    this.fundingData = {};     // symbol → rate
    this.liquidations = {};    // symbol → USD in last hour
    this.liqTimestamps = {};   // symbol → [{ time, value }]
    this.volumeData = {};      // symbol → { current, avg }
    this.priceHistory = {};    // symbol → last 10 prices (for flash crash)
    this.lastOIUpdate = {};    // symbol → timestamp
  }

  // ─── PRICE ────────────────────────────────────────────────
  updatePrice(symbol, price) {
    this.prevPrices[symbol] = this.prices[symbol] || price;
    this.prices[symbol] = price;

    // Track price history for flash crash detection
    if (!this.priceHistory[symbol]) this.priceHistory[symbol] = [];
    this.priceHistory[symbol].push({ price, time: Date.now() });
    if (this.priceHistory[symbol].length > 20) this.priceHistory[symbol].shift();
  }

  getPrice(symbol) { return this.prices[symbol] || null; }

  getPriceChange(symbol) {
    const cur = this.prices[symbol];
    const prev = this.prevPrices[symbol];
    if (!cur || !prev) return 0;
    return ((cur - prev) / prev) * 100;
  }

  // Flash crash: price moved > 1.5% in last 10 seconds
  isFlashCrash(symbol) {
    const hist = this.priceHistory[symbol];
    if (!hist || hist.length < 2) return false;
    const now = Date.now();
    const recent = hist.filter(h => now - h.time < 10000);
    if (recent.length < 2) return false;
    const oldest = recent[0].price;
    const newest = recent[recent.length - 1].price;
    return Math.abs((newest - oldest) / oldest) * 100 > 1.5;
  }

  // ─── OI ───────────────────────────────────────────────────
  updateOI(symbol, currentOI) {
    const prev = this.oiData[symbol]?.current || currentOI;
    const change = prev > 0 ? ((currentOI - prev) / prev) * 100 : 0;
    this.oiData[symbol] = { current: currentOI, prev, change, updatedAt: Date.now() };
  }

  getOIChange(symbol) { return this.oiData[symbol]?.change || 0; }
  getOI(symbol) { return this.oiData[symbol]?.current || 0; }

  // ─── FUNDING ──────────────────────────────────────────────
  updateFunding(symbol, rate) { this.fundingData[symbol] = { rate, updatedAt: Date.now() }; }
  getFunding(symbol) { return this.fundingData[symbol]?.rate || 0; }

  isFundingDangerous(symbol, direction) {
    const rate = this.getFunding(symbol);
    if (direction === 'LONG' && rate > 0.001) return true;
    if (direction === 'SHORT' && rate < -0.0008) return true;
    return false;
  }

  // ─── LIQUIDATIONS ─────────────────────────────────────────
  addLiquidation(symbol, value) {
    if (!this.liquidations[symbol]) this.liquidations[symbol] = 0;
    if (!this.liqTimestamps[symbol]) this.liqTimestamps[symbol] = [];

    this.liquidations[symbol] += value;
    this.liqTimestamps[symbol].push({ time: Date.now(), value });

    // Cleanup old liquidations (> 1 hour)
    const oneHourAgo = Date.now() - 3600000;
    this.liqTimestamps[symbol] = this.liqTimestamps[symbol].filter(l => l.time > oneHourAgo);
    this.liquidations[symbol] = this.liqTimestamps[symbol].reduce((s, l) => s + l.value, 0);
  }

  getLiquidations1h(symbol) { return this.liquidations[symbol] || 0; }

  // ─── VOLUME ───────────────────────────────────────────────
  updateVolume(symbol, current, avg) {
    this.volumeData[symbol] = { current, avg, ratio: avg > 0 ? current / avg : 1 };
  }

  getVolumeRatio(symbol) { return this.volumeData[symbol]?.ratio || 1; }

  // ─── SNAPSHOT for analysis ────────────────────────────────
  getSnapshot(symbol) {
    return {
      symbol,
      price: this.prices[symbol] || 0,
      priceChange: this.getPriceChange(symbol),
      oi: this.getOI(symbol),
      oiChange: this.getOIChange(symbol),
      funding: this.getFunding(symbol),
      liq1h: this.getLiquidations1h(symbol),
      volRatio: this.getVolumeRatio(symbol),
      flashCrash: this.isFlashCrash(symbol),
      timestamp: new Date().toISOString()
    };
  }

  // ─── ALL PRICES ───────────────────────────────────────────
  getAllPrices() { return { ...this.prices }; }

  // ─── MARKET SUMMARY ───────────────────────────────────────
  getSummary() {
    const symbols = Object.keys(this.prices);
    const topMovers = symbols
      .map(s => ({ symbol: s, change: this.getPriceChange(s) }))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 5);

    const highLiquidations = symbols
      .filter(s => this.getLiquidations1h(s) > 500000)
      .map(s => ({ symbol: s, liq: this.getLiquidations1h(s) }))
      .sort((a, b) => b.liq - a.liq)
      .slice(0, 3);

    return {
      trackedSymbols: symbols.length,
      topMovers,
      highLiquidations,
      timestamp: new Date().toISOString()
    };
  }
}

// Singleton
const tracker = new MarketTracker();
module.exports = tracker;
