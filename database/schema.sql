-- AXOM v3 — Complete Database Schema
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT DEFAULT 'default' UNIQUE,
  mode TEXT DEFAULT 'PAPER' CHECK (mode IN ('PAPER','DEMO','REAL')),
  daily_capital DECIMAL(10,2) DEFAULT 10,
  daily_stop_percent DECIMAL(5,2) DEFAULT 60,
  paper_balance DECIMAL(10,2) DEFAULT 1000,
  max_concurrent_trades INTEGER DEFAULT 3,
  max_daily_trades INTEGER DEFAULT 15,
  min_score_entry INTEGER DEFAULT 75,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE DEFAULT CURRENT_DATE UNIQUE,
  start_capital DECIMAL(10,2) NOT NULL,
  daily_stop_amount DECIMAL(10,4) NOT NULL,
  current_balance DECIMAL(10,4) NOT NULL,
  daily_high DECIMAL(10,4) NOT NULL,
  total_pnl DECIMAL(10,4) DEFAULT 0,
  total_fees DECIMAL(10,4) DEFAULT 0,
  net_pnl DECIMAL(10,4) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('WAITING','ACTIVE','PAUSED','STOPPED','COMPLETED')),
  mode TEXT DEFAULT 'PAPER',
  stop_reason TEXT,
  permission_given_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES daily_sessions(id),
  symbol TEXT NOT NULL,
  mode TEXT DEFAULT 'PAPER',
  direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
  wave_type TEXT DEFAULT 'RIDER',
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
  close_price DECIMAL(20,8),
  pnl DECIMAL(10,4),
  pnl_after_fees DECIMAL(10,4),
  pnl_percent DECIMAL(8,4),
  close_reason TEXT,
  bingx_order_id TEXT,
  score INTEGER,
  kill_zone TEXT,
  smt_detected BOOLEAN DEFAULT false,
  slippage_hunt BOOLEAN DEFAULT false,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS signals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  total_score INTEGER DEFAULT 0,
  decision TEXT CHECK (decision IN ('APPROVE','REJECT')),
  direction TEXT CHECK (direction IN ('LONG','SHORT')),
  entry_price DECIMAL(20,8),
  stop_loss DECIMAL(20,8),
  tp1 DECIMAL(20,8),
  tp2 DECIMAL(20,8),
  leverage INTEGER,
  reject_reason TEXT,
  gemini_summary TEXT,
  liquidity_score DECIMAL(5,2) DEFAULT 0,
  kill_zone TEXT,
  smt_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Suggestions = manual proposals user approves/rejects
CREATE TABLE IF NOT EXISTS suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  score INTEGER NOT NULL,
  direction TEXT CHECK (direction IN ('LONG','SHORT')),
  entry_price DECIMAL(20,8),
  stop_loss DECIMAL(20,8),
  tp1 DECIMAL(20,8),
  tp2 DECIMAL(20,8),
  leverage INTEGER,
  summary TEXT,
  confidence TEXT,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS daily_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE UNIQUE,
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
  avg_score DECIMAL(5,2) DEFAULT 0,
  avg_leverage DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  level TEXT CHECK (level IN ('DEBUG','INFO','WARN','ERROR')),
  category TEXT,
  message TEXT NOT NULL,
  details JSONB
);

CREATE TABLE IF NOT EXISTS error_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  type TEXT,
  source TEXT,
  message TEXT NOT NULL,
  details JSONB,
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  role TEXT CHECK (role IN ('USER','BOT')),
  message TEXT NOT NULL,
  context_data JSONB
);

-- Default settings
INSERT INTO settings (user_id) VALUES ('default') ON CONFLICT (user_id) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trades_status   ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol   ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_opened   ON trades(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_time    ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_logs_time       ON bot_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_resolved ON error_alerts(is_resolved);
