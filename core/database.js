const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ─── SETTINGS ─────────────────────────────────────────────────
async function getSettings() {
  const { data,error } = await sb.from('settings').select('*').eq('user_id','default').single();
  if (error) throw new Error(`DB settings: ${error.message}`);
  return data;
}
async function updateSettings(u) {
  const { data,error } = await sb.from('settings').update({...u,updated_at:new Date().toISOString()}).eq('user_id','default').select().single();
  if (error) throw new Error(`DB updateSettings: ${error.message}`);
  return data;
}

// ─── SESSIONS ─────────────────────────────────────────────────
async function createSession(capital, stopPct, mode) {
  const today = new Date().toISOString().split('T')[0];
  await sb.from('daily_sessions').delete().eq('date',today);
  const { data,error } = await sb.from('daily_sessions').insert({
    date:today, start_capital:capital,
    daily_stop_amount:parseFloat((capital*stopPct/100).toFixed(4)),
    current_balance:capital, daily_high:capital,
    status:'ACTIVE', mode:mode||'PAPER',
    permission_given_at:new Date().toISOString()
  }).select().single();
  if (error) throw new Error(`DB createSession: ${error.message}`);
  return data;
}
async function getActiveSession() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb.from('daily_sessions').select('*').eq('date',today).eq('status','ACTIVE').single();
  return data||null;
}
async function updateSession(id,u) {
  const { data,error } = await sb.from('daily_sessions').update(u).eq('id',id).select().single();
  if (error) throw new Error(`DB updateSession: ${error.message}`);
  return data;
}
async function getTodaySession() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb.from('daily_sessions').select('*').eq('date',today).single();
  return data||null;
}

// ─── TRADES ──────────────────────────────────────────────────
async function saveTrade(t) {
  const { data,error } = await sb.from('trades').insert(t).select().single();
  if (error) throw new Error(`DB saveTrade: ${error.message}`);
  return data;
}
async function updateTrade(id,u) {
  const { data,error } = await sb.from('trades').update(u).eq('id',id).select().single();
  if (error) throw new Error(`DB updateTrade: ${error.message}`);
  return data;
}
async function getOpenTrades() {
  const { data,error } = await sb.from('trades').select('*').eq('status','OPEN');
  if (error) throw new Error(`DB getOpenTrades: ${error.message}`);
  return data||[];
}
async function getTodayTrades() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb.from('trades').select('*').gte('opened_at',today).order('opened_at',{ascending:false});
  return data||[];
}
async function getRecentTrades(n=10) {
  const { data } = await sb.from('trades').select('*').eq('status','CLOSED').order('closed_at',{ascending:false}).limit(n);
  return data||[];
}

// ─── SIGNALS ─────────────────────────────────────────────────
async function saveSignal(s) {
  const { data,error } = await sb.from('signals').insert(s).select().single();
  if (error) console.error(`DB saveSignal: ${error.message}`);
  return data;
}
async function getRecentSignals(n=20) {
  const { data } = await sb.from('signals').select('*').order('created_at',{ascending:false}).limit(n);
  return data||[];
}

// ─── SUGGESTIONS (manual proposals) ─────────────────────────
async function saveSuggestion(s) {
  const { data,error } = await sb.from('suggestions').insert(s).select().single();
  if (error) console.error(`DB saveSuggestion: ${error.message}`);
  return data;
}
async function getPendingSuggestions() {
  const { data } = await sb.from('suggestions').select('*').eq('status','PENDING').order('score',{ascending:false});
  return data||[];
}
async function updateSuggestion(id,u) {
  await sb.from('suggestions').update(u).eq('id',id);
}

// ─── STATS ───────────────────────────────────────────────────
async function upsertStats(s) {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await sb.from('daily_stats').upsert({...s,date:today},{onConflict:'date'});
  if (error) console.error(`DB upsertStats: ${error.message}`);
}
async function getDailyStats(n=7) {
  const { data } = await sb.from('daily_stats').select('*').order('date',{ascending:false}).limit(n);
  return data||[];
}
async function getWeeklyStats() {
  const d = new Date(Date.now()-7*86400000).toISOString().split('T')[0];
  const { data } = await sb.from('daily_stats').select('*').gte('date',d).order('date',{ascending:true});
  return data||[];
}

// ─── LOGS ────────────────────────────────────────────────────
async function saveLog(level,category,message,details=null) {
  const { error } = await sb.from('bot_logs').insert({level,category,message,details});
  if (error) console.error(`DB saveLog: ${error.message}`);
}
async function getRecentLogs(n=20) {
  const { data } = await sb.from('bot_logs').select('*').order('timestamp',{ascending:false}).limit(n);
  return data||[];
}

// ─── ERRORS ──────────────────────────────────────────────────
async function saveError(type,source,message,details=null) {
  const { error } = await sb.from('error_alerts').insert({type,source,message,details});
  if (error) console.error(`DB saveError: ${error.message}`);
}
async function getUnresolvedErrors(n=5) {
  const { data } = await sb.from('error_alerts').select('*').eq('is_resolved',false).order('timestamp',{ascending:false}).limit(n);
  return data||[];
}
async function resolveError(id) {
  await sb.from('error_alerts').update({is_resolved:true,resolved_at:new Date().toISOString()}).eq('id',id);
}

// ─── CHAT ────────────────────────────────────────────────────
async function saveChat(role,message,ctx=null) {
  const { error } = await sb.from('chat_history').insert({role,message,context_data:ctx});
  if (error) console.error(`DB saveChat: ${error.message}`);
}
async function getChatHistory(n=8) {
  const { data } = await sb.from('chat_history').select('*').order('timestamp',{ascending:false}).limit(n);
  return (data||[]).reverse();
}

module.exports = {
  getSettings, updateSettings,
  createSession, getActiveSession, updateSession, getTodaySession,
  saveTrade, updateTrade, getOpenTrades, getTodayTrades, getRecentTrades,
  saveSignal, getRecentSignals,
  saveSuggestion, getPendingSuggestions, updateSuggestion,
  upsertStats, getDailyStats, getWeeklyStats,
  saveLog, getRecentLogs,
  saveError, getUnresolvedErrors, resolveError,
  saveChat, getChatHistory
};
