-- ============================================
-- AXOM BOT — Complete Database Schema v2.0
-- Run in Supabase SQL Editor
-- ============================================

-- 1. SETTINGS
CREATE TABLE IF NOT EXISTS settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT DEFAULT 'default' UNIQUE,
  mode TEXT DEFAULT 'PAPER' CHECK (mode IN ('PAPER','REAL')),
  daily_capital DECIMAL(10,2) DEFAULT 10.00,
  daily_stop_percent DECIMAL(5,2) DEFAULT 60.00,
  paper_balance DECIMAL(10,2) DEFAULT 1000.00,
  binance_api_key TEXT DEFAULT '',
  binance_secret TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT false,
  max_concurrent_trades INTEGER DEFAULT 3,
  max_daily_trades INTEGER DEFAULT 15,
  min_score_entry INTEGER DEFAULT 75,
  allowed_symbols TEXT[] DEFAULT ARRAY['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. DAILY SESSIONS
CREATE TABLE IF NOT EXISTS daily_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE DEFAULT CURRENT_DATE UNIQUE,
  start_capital DECIMAL(10,2) NOT NULL,
  daily_stop_amount DECIMAL(10,2) NOT NULL,
  current_balance DECIMAL(10,2) NOT NULL,
  daily_high DECIMAL(10,2) NOT NULL,
  total_pnl DECIMAL(10,4) DEFAULT 0,
  total_fees DECIMAL(10,4) DEFAULT 0,
  net_pnl DECIMAL(10,4) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  status TEXT DEFAULT 'WAITING' CHECK (status IN ('WAITING','ACTIVE','PAUSED','STOPPED','COMPLETED')),
  stop_reason TEXT,
  mode TEXT DEFAULT 'PAPER',
  permission_given_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TRADES
CREATE TABLE IF NOT EXISTS trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES daily_sessions(id),
  symbol TEXT NOT NULL,
  mode TEXT DEFAULT 'PAPER' CHECK (mode IN ('PAPER','REAL')),
  direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
  wave_type TEXT DEFAULT 'RIDER' CHECK (wave_type IN ('RIDER','SURFER','CATCHER')),
  entry_price DECIMAL(20,8) NOT NULL,
  current_price DECIMAL(20,8),
  stop_loss DECIMAL(20,8) NOT NULL,
  original_sl DECIMAL(20,8) NOT NULL,
  tp1 DECIMAL(20,8) NOT NULL,
  tp2 DECIMAL(20,8) NOT NULL,
  tp3 DECIMAL(20,8),
  leverage INTEGER NOT NULL,
  risk_amount DECIMAL(10,4) NOT NULL,
  position_size DECIMAL(20,8),
  position_value DECIMAL(10,4),
  margin_used DECIMAL(10,4),
  fee_open DECIMAL(10,6) DEFAULT 0,
  fee_close DECIMAL(10,6) DEFAULT 0,
  total_fees DECIMAL(10,6) DEFAULT 0,
  status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
  tp1_hit BOOLEAN DEFAULT false,
  tp2_hit BOOLEAN DEFAULT false,
  tp3_hit BOOLEAN DEFAULT false,
  tp1_pnl DECIMAL(10,4),
  tp2_pnl DECIMAL(10,4),
  tp3_pnl DECIMAL(10,4),
  close_price DECIMAL(20,8),
  pnl DECIMAL(10,4),
  pnl_after_fees DECIMAL(10,4),
  pnl_percent DECIMAL(8,4),
  close_reason TEXT,
  binance_order_id TEXT,
  sl_order_id TEXT,
  score INTEGER,
  ict_score INTEGER,
  smt_detected BOOLEAN DEFAULT false,
  slippage_hunt BOOLEAN DEFAULT false,
  kill_zone TEXT,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

-- 4. SIGNALS
CREATE TABLE IF NOT EXISTS signals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  total_score INTEGER DEFAULT 0,
  htf_score INTEGER DEFAULT 0,
  structure_score INTEGER DEFAULT 0,
  sweep_score INTEGER DEFAULT 0,
  sms_score INTEGER DEFAULT 0,
  displacement_score INTEGER DEFAULT 0,
  fvg_score INTEGER DEFAULT 0,
  kill_zone_score INTEGER DEFAULT 0,
  smt_score INTEGER DEFAULT 0,
  oi_bonus INTEGER DEFAULT 0,
  volume_bonus INTEGER DEFAULT 0,
  funding_bonus INTEGER DEFAULT 0,
  penalties INTEGER DEFAULT 0,
  decision TEXT CHECK (decision IN ('APPROVE','REJECT')),
  direction TEXT CHECK (direction IN ('LONG','SHORT')),
  entry_price DECIMAL(20,8),
  stop_loss DECIMAL(20,8),
  tp1 DECIMAL(20,8),
  tp2 DECIMAL(20,8),
  leverage INTEGER,
  reject_reason TEXT,
  gemini_analysis TEXT,
  liquidity_momentum_score DECIMAL(5,2) DEFAULT 0,
  kill_zone TEXT,
  smt_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. MARKET SNAPSHOTS
CREATE TABLE IF NOT EXISTS market_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  price DECIMAL(20,8),
  oi DECIMAL(20,2),
  oi_change_1h DECIMAL(8,4),
  funding_rate DECIMAL(10,6),
  volume_ratio DECIMAL(8,4),
  liquidations_1h DECIMAL(20,2) DEFAULT 0,
  long_short_ratio DECIMAL(8,4),
  atr_percent DECIMAL(8,4),
  liquidity_momentum_score DECIMAL(5,2),
  htf_bias TEXT
);

-- 6. DAILY STATS
CREATE TABLE IF NOT EXISTS daily_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE DEFAULT CURRENT_DATE UNIQUE,
  mode TEXT DEFAULT 'PAPER',
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,
  total_pnl DECIMAL(10,4) DEFAULT 0,
  total_fees DECIMAL(10,4) DEFAULT 0,
  net_pnl DECIMAL(10,4) DEFAULT 0,
  best_trade_pnl DECIMAL(10,4) DEFAULT 0,
  worst_trade_pnl DECIMAL(10,4) DEFAULT 0,
  max_consecutive_wins INTEGER DEFAULT 0,
  max_consecutive_losses INTEGER DEFAULT 0,
  sniper_trades INTEGER DEFAULT 0,
  sniper_wins INTEGER DEFAULT 0,
  scalper_trades INTEGER DEFAULT 0,
  scalper_wins INTEGER DEFAULT 0,
  best_symbol TEXT,
  avg_score DECIMAL(5,2) DEFAULT 0,
  avg_leverage DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. BOT LOGS
CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  level TEXT CHECK (level IN ('INFO','WARN','ERROR','DEBUG')),
  category TEXT CHECK (category IN ('TRADE','RISK','API','SYSTEM','ANALYSIS','SCAN')),
  message TEXT NOT NULL,
  details JSONB,
  resolved BOOLEAN DEFAULT false
);

-- 8. ERROR ALERTS
CREATE TABLE IF NOT EXISTS error_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL,
  source TEXT CHECK (source IN ('BINANCE','GEMINI','SUPABASE','SYSTEM','RISK','WS')),
  message TEXT NOT NULL,
  details JSONB,
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ
);

-- 9. NEWS EVENTS
CREATE TABLE IF NOT EXISTS news_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_time TIMESTAMPTZ NOT NULL,
  currency TEXT,
  title TEXT,
  impact TEXT CHECK (impact IN ('HIGH','MEDIUM','LOW')),
  is_blackout_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. CHAT HISTORY
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  role TEXT CHECK (role IN ('USER','BOT')),
  message TEXT NOT NULL,
  context_data JSONB
);

-- ============================================
-- DEFAULT SETTINGS
-- ============================================
INSERT INTO settings (user_id, mode, daily_capital, daily_stop_percent, paper_balance)
VALUES ('default', 'PAPER', 10.00, 60.00, 1000.00)
ON CONFLICT (user_id) DO NOTHING;

-- ============================================
-- PERFORMANCE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(session_id);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_decision ON signals(decision);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_symbol ON market_snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_time ON market_snapshots(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON bot_logs(level);
CREATE INDEX IF NOT EXISTS idx_bot_logs_time ON bot_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_alerts_resolved ON error_alerts(is_resolved);
CREATE INDEX IF NOT EXISTS idx_daily_sessions_date ON daily_sessions(date DESC);
