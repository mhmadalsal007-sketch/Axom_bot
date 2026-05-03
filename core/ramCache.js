// ============================================================
// AXOM v3 — RAM Cache Engine
// Zero-latency in-memory store for all market data
// Pre-fetches candles for top symbols continuously
// Uses Map + typed structure for max read speed
// ============================================================
const bingx  = require('./bingx');
const logger = require('../utils/logger');

// ─── CONSTANTS ────────────────────────────────────────────────
const TIMEFRAMES  = ['1m','5m','15m','1h'];
const CANDLE_LIMITS = { '1m':60, '5m':60, '15m':30, '1h':30 };
const REFRESH_MS  = {  '1m':30000, '5m':60000, '15m':120000, '1h':300000 };
const MAX_SYMBOLS = 25;

// ─── CACHE STORE (Map for O(1) access) ────────────────────────
// Structure: cache.get(symbol) → { '1m': [...], '5m': [...], ... }
const candleCache  = new Map();   // candle data per symbol+tf
const cacheAge     = new Map();   // last refresh timestamp
const symbolList   = new Set();   // currently tracked symbols
const refreshLocks = new Map();   // prevent duplicate refresh

// ─── STATS ────────────────────────────────────────────────────
let hits = 0, misses = 0, refreshCount = 0;

// ─── CACHE KEY ───────────────────────────────────────────────
const key = (sym, tf) => `${sym}:${tf}`;

// ─── SET CANDLES ──────────────────────────────────────────────
function setCandles(symbol, tf, candles) {
  if (!candles || !candles.length) return;
  candleCache.set(key(symbol, tf), candles);
  cacheAge.set(key(symbol, tf), Date.now());
}

// ─── GET CANDLES (instant from RAM) ───────────────────────────
function getCandles(symbol, tf) {
  const data = candleCache.get(key(symbol, tf));
  if (data && data.length) {
    hits++;
    return data;
  }
  misses++;
  return null;
}

// ─── CHECK IF STALE ───────────────────────────────────────────
function isStale(symbol, tf) {
  const age = cacheAge.get(key(symbol, tf));
  if (!age) return true;
  return (Date.now() - age) > REFRESH_MS[tf];
}

// ─── REFRESH ONE SYMBOL (all timeframes) ──────────────────────
async function refreshSymbol(symbol) {
  const lockKey = `lock:${symbol}`;
  if (refreshLocks.get(lockKey)) return; // already refreshing
  refreshLocks.set(lockKey, true);

  try {
    // Fetch all 4 timeframes in parallel (server has power — use it)
    const results = await Promise.allSettled(
      TIMEFRAMES.map(tf => bingx.getKlines(symbol, tf, CANDLE_LIMITS[tf]))
    );

    TIMEFRAMES.forEach((tf, i) => {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value?.length) {
        setCandles(symbol, tf, r.value);
      }
    });

    refreshCount++;
    logger.info('CACHE', `Refreshed ${symbol} (${TIMEFRAMES.length} TFs) — total refreshes: ${refreshCount}`);
  } catch (e) {
    logger.warn('CACHE', `Refresh ${symbol}: ${e.message}`);
  } finally {
    refreshLocks.delete(lockKey);
  }
}

// ─── WARM CACHE for a symbol (ensures all TFs loaded) ─────────
async function warmSymbol(symbol) {
  symbolList.add(symbol);
  const missing = TIMEFRAMES.filter(tf => !getCandles(symbol, tf));
  if (missing.length === 0) return; // already warm

  logger.info('CACHE', `Warming ${symbol} (missing: ${missing.join(',')})...`);
  await refreshSymbol(symbol);
}

// ─── GET ALL TFs AT ONCE (for scorer) ─────────────────────────
// Returns { c1m, c5m, c15m, c1h } — all from RAM, zero API calls
async function getFullData(symbol) {
  // Auto-warm if not in cache
  const allPresent = TIMEFRAMES.every(tf => getCandles(symbol, tf));
  if (!allPresent) {
    await warmSymbol(symbol);
  }

  return {
    c1m:  getCandles(symbol, '1m')  || [],
    c5m:  getCandles(symbol, '5m')  || [],
    c15m: getCandles(symbol, '15m') || [],
    c1h:  getCandles(symbol, '1h')  || [],
  };
}

// ─── SET TRACKED SYMBOLS ─────────────────────────────────────
function setTrackedSymbols(symbols) {
  const top = symbols.slice(0, MAX_SYMBOLS);
  
  // Remove symbols no longer tracked
  for (const s of symbolList) {
    if (!top.includes(s)) {
      symbolList.delete(s);
      TIMEFRAMES.forEach(tf => {
        candleCache.delete(key(s, tf));
        cacheAge.delete(key(s, tf));
      });
    }
  }

  // Add new symbols
  top.forEach(s => symbolList.add(s));
}

// ─── BACKGROUND REFRESH LOOP ─────────────────────────────────
// Continuously keeps cache fresh without blocking main loop
async function backgroundRefreshLoop() {
  while (true) {
    const symbols = [...symbolList];
    if (symbols.length === 0) {
      await bingx.sleep(5000);
      continue;
    }

    for (const sym of symbols) {
      // Check which TFs need refresh
      const stale = TIMEFRAMES.filter(tf => isStale(sym, tf));
      if (stale.length > 0) {
        await refreshSymbol(sym);
        await bingx.sleep(200); // tiny delay between symbols
      }
    }

    await bingx.sleep(15000); // full cycle every 15s
  }
}

// ─── LATEST CANDLE (for quick price check) ───────────────────
function getLatestCandle(symbol, tf = '1m') {
  const candles = getCandles(symbol, tf);
  return candles ? candles.at(-1) : null;
}

// ─── CACHE STATS ─────────────────────────────────────────────
function getStats() {
  const total = hits + misses;
  return {
    symbols:   symbolList.size,
    entries:   candleCache.size,
    hits,
    misses,
    hitRate:   total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : 'N/A',
    refreshes: refreshCount,
    memKB:     Math.round(process.memoryUsage().heapUsed / 1024),
  };
}

// ─── INIT ────────────────────────────────────────────────────
function init() {
  logger.info('CACHE', '🚀 RAM Cache Engine starting...');
  // Start background refresh (non-blocking)
  backgroundRefreshLoop().catch(e => logger.error('CACHE', `BG loop crash: ${e.message}`));
  logger.info('CACHE', '✅ RAM Cache Engine active — all data served from memory');
}

module.exports = {
  init,
  getCandles,
  getFullData,
  warmSymbol,
  setTrackedSymbols,
  getLatestCandle,
  refreshSymbol,
  getStats,
  setCandles, // for WSS price updates
};

