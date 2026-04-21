const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── SETTINGS ────────────────────────────────────────────────
async function getSettings() {
  const { data, error } = await supabase.from('settings').select('*').eq('user_id','default').single();
  if (error) throw new Error(`DB getSettings: ${error.message}`);
  return data;
}
async function updateSettings(updates) {
  const { data, error } = await supabase.from('settings').update({ ...updates, updated_at: new Date().toISOString() }).eq('user_id','default').select().single();
  if (error) throw new Error(`DB updateSettings: ${error.message}`);
  return data;
}

// ─── DAILY SESSIONS ──────────────────────────────────────────
async function createDailySession(capital, stopPercent, mode) {
  const today = new Date().toISOString().split('T')[0];
  // Delete existing for today if any
  await supabase.from('daily_sessions').delete().eq('date', today);
  const stopAmount = parseFloat(((capital * stopPercent) / 100).toFixed(4));
  const { data, error } = await supabase.from('daily_sessions').insert({
    date: today,
    start_capital: capital,
    daily_stop_amount: stopAmount,
    current_balance: capital,
    daily_high: capital,
    status: 'ACTIVE',
    mode: mode || process.env.BOT_MODE || 'PAPER',
    permission_given_at: new Date().toISOString()
  }).select().single();
  if (error) throw new Error(`DB createSession: ${error.message}`);
  return data;
}
async function getActiveSession() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase.from('daily_sessions').select('*').eq('date', today).eq('status','ACTIVE').single();
  return data || null;
}
async function updateSession(id, updates) {
  const { data, error } = await supabase.from('daily_sessions').update(updates).eq('id', id).select().single();
  if (error) throw new Error(`DB updateSession: ${error.message}`);
  return data;
}
async function getTodaySession() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase.from('daily_sessions').select('*').eq('date', today).single();
  return data || null;
}

// ─── TRADES ──────────────────────────────────────────────────
async function saveTrade(tradeData) {
  const { data, error } = await supabase.from('trades').insert(tradeData).select().single();
  if (error) throw new Error(`DB saveTrade: ${error.message}`);
  return data;
}
async function updateTrade(id, updates) {
  const { data, error } = await supabase.from('trades').update(updates).eq('id', id).select().single();
  if (error) throw new Error(`DB updateTrade: ${error.message}`);
  return data;
}
async function getOpenTrades() {
  const { data, error } = await supabase.from('trades').select('*').eq('status','OPEN').order('opened_at', { ascending: false });
  if (error) throw new Error(`DB getOpenTrades: ${error.message}`);
  return data || [];
}
async function getTodayTrades() {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('trades').select('*').gte('opened_at', today).order('opened_at', { ascending: false });
  if (error) throw new Error(`DB getTodayTrades: ${error.message}`);
  return data || [];
}
async function getRecentTrades(limit = 10) {
  const { data, error } = await supabase.from('trades').select('*').eq('status','CLOSED').order('closed_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`DB getRecentTrades: ${error.message}`);
  return data || [];
}

// ─── SIGNALS ─────────────────────────────────────────────────
async function saveSignal(signalData) {
  const { data, error } = await supabase.from('signals').insert(signalData).select().single();
  if (error) console.error(`DB saveSignal: ${error.message}`);
  return data;
}
async function getRecentSignals(limit = 20) {
  const { data } = await supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

// ─── MARKET SNAPSHOTS ────────────────────────────────────────
async function saveMarketSnapshot(snapshotData) {
  const { error } = await supabase.from('market_snapshots').insert(snapshotData);
  if (error) console.error(`DB saveSnapshot: ${error.message}`);
}

// ─── DAILY STATS ─────────────────────────────────────────────
async function upsertDailyStats(statsData) {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase.from('daily_stats').upsert({ ...statsData, date: today }, { onConflict: 'date' });
  if (error) console.error(`DB upsertStats: ${error.message}`);
}
async function getDailyStats(days = 7) {
  const { data } = await supabase.from('daily_stats').select('*').order('date', { ascending: false }).limit(days);
  return data || [];
}
async function getWeeklyStats() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data } = await supabase.from('daily_stats').select('*').gte('date', sevenDaysAgo).order('date', { ascending: true });
  return data || [];
}

// ─── LOGS ────────────────────────────────────────────────────
async function saveLog(level, category, message, details = null) {
  const { error } = await supabase.from('bot_logs').insert({ level, category, message, details });
  if (error) console.error(`DB saveLog: ${error.message}`);
}

// ─── ERRORS ──────────────────────────────────────────────────
async function saveError(type, source, message, details = null) {
  const { error } = await supabase.from('error_alerts').insert({ type, source, message, details });
  if (error) console.error(`DB saveError: ${error.message}`);
}
async function getUnresolvedErrors(limit = 5) {
  const { data } = await supabase.from('error_alerts').select('*').eq('is_resolved', false).order('timestamp', { ascending: false }).limit(limit);
  return data || [];
}
async function resolveError(id) {
  await supabase.from('error_alerts').update({ is_resolved: true, resolved_at: new Date().toISOString() }).eq('id', id);
}

// ─── CHAT ────────────────────────────────────────────────────
async function saveChatMessage(role, message, contextData = null) {
  const { error } = await supabase.from('chat_history').insert({ role, message, context_data: contextData });
  if (error) console.error(`DB saveChat: ${error.message}`);
}
async function getChatHistory(limit = 8) {
  const { data } = await supabase.from('chat_history').select('*').order('timestamp', { ascending: false }).limit(limit);
  return (data || []).reverse();
}

module.exports = {
  supabase,
  getSettings, updateSettings,
  createDailySession, getActiveSession, updateSession, getTodaySession,
  saveTrade, updateTrade, getOpenTrades, getTodayTrades, getRecentTrades,
  saveSignal, getRecentSignals,
  saveMarketSnapshot,
  upsertDailyStats, getDailyStats, getWeeklyStats,
  saveLog,
  saveError, getUnresolvedErrors, resolveError,
  saveChatMessage, getChatHistory
};
