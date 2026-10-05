import { bridgeFetch } from './bridgeEndpoint'

export const MT5_BRIDGE_URL =
  (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8765'

export type Mt5Account = {
  login: number
  server: string
  name: string
  company: string
  currency: string
  leverage: number
  balance: number
  equity: number
  profit: number
  margin: number
  margin_free: number
  margin_level: number | null
  trade_allowed: boolean
  trade_expert: boolean
  margin_mode: number
  trade_mode?: number
  day_pnl?: number
  daily_win_rate?: number | null
  observed_at?: number
}

export type Mt5SymbolInfo = {
  symbol: string
  description: string
  path: string
  digits: number
  point: number
  spread: number
  trade_tick_size: number
  trade_tick_value: number
  trade_tick_value_profit: number
  trade_tick_value_loss: number
  trade_contract_size: number
  volume_min: number
  volume_max: number
  volume_step: number
  currency_base: string
  currency_profit: string
  currency_margin: string
  trade_mode: number
  visible: boolean
  chart_mode?: number
}

export type Mt5Tick = {
  symbol: string
  time: number
  time_msc: number
  bid: number
  ask: number
  last: number
  mid: number
  volume: number
  volume_real: number
  flags: number
  observed_at?: number
  quote_age_ms?: number
  freshness?: 'fresh' | 'stale'
}

export type Mt5Bar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  tick_volume: number
  spread: number
  real_volume: number
}

export type Mt5BarsResponse = {
  source: 'MT5'
  symbol: string
  timeframe: string
  requested_bars: number
  loaded_bars: number
  values: Mt5Bar[]
  tick: Mt5Tick
  account: Mt5Account
  market_session: Mt5MarketSession
  symbol_info: Mt5SymbolInfo
}

export type Mt5MarketSession = {
  available: boolean
  quote_open: boolean | null
  trade_open: boolean | null
  state: 'open' | 'closed' | 'unknown'
  broker_weekday?: number
  broker_seconds?: number
  observed_at?: number
  source?: 'MT5_SYMBOL_SESSIONS'
}

export type Mt5Position = { ticket: number; symbol: string; type: 'buy' | 'sell'; volume: number; price_open: number; sl: number; tp: number; profit: number; swap: number; commission: number; time: number }
export type Mt5Order = { ticket: number; symbol: string; type: string; volume_initial: number; price_open: number; sl: number; tp: number; price_current: number; time_setup: number }
export type Mt5SymbolItem = Pick<Mt5SymbolInfo, 'symbol' | 'description' | 'path' | 'digits' | 'visible' | 'trade_mode'>

export type Mt5SnapshotResponse = {
  source: 'MT5'
  symbol: string
  tick: Mt5Tick
  account: Mt5Account
  symbol_info: Mt5SymbolInfo
}

type LocalFetchInit = RequestInit & {
  targetAddressSpace?: 'loopback' | 'local'
}

async function localFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
  return localRequest<T>(path, { method: 'GET', cache: 'no-store', signal })
}

async function localRequest<T>(path: string, request: RequestInit = {}): Promise<T> {
  const init: LocalFetchInit = {
    method: 'GET',
    cache: 'no-store',
    targetAddressSpace: 'loopback',
    ...request,
  }

  let response: Response
  try {
    response = await bridgeFetch(path, init)
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `MT5 Local Bridge niedostępny: ${error.message}`
        : 'MT5 Local Bridge niedostępny'
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail?: unknown }).detail
        : payload

    const message =
      detail && typeof detail === 'object' && 'hint' in detail
        ? String((detail as { hint?: unknown }).hint)
        : detail && typeof detail === 'object' && 'error' in detail
          ? String((detail as { error?: unknown }).error)
          : `HTTP ${response.status}`

    throw new Error(message)
  }
  validateResponse(path, payload)
  return payload as T
}

function validateResponse(path: string, payload: unknown): void {
  const fail = () => { throw new Error('Most MT5 zwrócił nieprawidłowe dane. Odczyt odrzucony.') }
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const numbers = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
  const validBar = (value: unknown) => object(value) && numbers(value, ['time', 'open', 'high', 'low', 'close', 'tick_volume']) && Number(value.time) > 0 && Number(value.low) <= Math.min(Number(value.open), Number(value.close)) && Number(value.high) >= Math.max(Number(value.open), Number(value.close)) && Number(value.low) > 0
  if (!object(payload)) return fail()
  const endpoint = path.split('?')[0]
  if (endpoint === '/v1/bars' || endpoint === '/v1/snapshot') {
    if (payload.source !== 'MT5' || typeof payload.symbol !== 'string' || !object(payload.tick) || !object(payload.account) || !object(payload.symbol_info)) return fail()
    if (payload.tick.symbol !== payload.symbol || payload.symbol_info.symbol !== payload.symbol
      || !numbers(payload.tick, ['time', 'time_msc', 'bid', 'ask', 'last', 'mid'])
      || !numbers(payload.account, ['login', 'equity', 'margin_free', 'observed_at'])
      || typeof payload.account.server !== 'string' || typeof payload.account.currency !== 'string'
      || !numbers(payload.symbol_info, ['point', 'trade_tick_size', 'volume_step', 'volume_min', 'volume_max', 'chart_mode'])) return fail()
    if (![0, 1].includes(Number(payload.symbol_info.chart_mode))) return fail()
    if (endpoint === '/v1/bars') {
      const session = payload.market_session
      if (!object(session) || typeof session.available !== 'boolean'
        || !['open', 'closed', 'unknown'].includes(String(session.state))
        || ![true, false, null].includes(session.quote_open as boolean | null)
        || ![true, false, null].includes(session.trade_open as boolean | null)
        || (session.available && (session.state === 'unknown' || !numbers(session, ['broker_weekday', 'broker_seconds', 'observed_at']) || session.source !== 'MT5_SYMBOL_SESSIONS'))
        || (!session.available && (session.state !== 'unknown' || session.quote_open !== null || session.trade_open !== null))) return fail()
    }
    const chartPrice = payload.symbol_info.chart_mode === 1 ? payload.tick.last : payload.tick.bid
    if (!(Number(chartPrice) > 0)) return fail()
    if (endpoint === '/v1/bars') {
      const requestedTimeframe = new URLSearchParams(path.split('?')[1]).get('timeframe')
      if (payload.timeframe !== requestedTimeframe || !Array.isArray(payload.values) || !payload.values.length || !payload.values.every(validBar)) return fail()
      if (payload.values.some((bar, index, bars) => index > 0 && Number(bar.time) <= Number(bars[index - 1].time))) return fail()
    }
  }
  if (endpoint === '/v1/positions' || endpoint === '/v1/orders') {
    if (!numbers(payload, ['observed_at']) || !Array.isArray(payload.values)) return fail()
    const keys = endpoint === '/v1/positions' ? ['ticket', 'volume', 'price_open', 'sl', 'tp', 'profit'] : ['ticket', 'volume_initial', 'price_open', 'sl', 'tp']
    if (!payload.values.every(value => object(value) && typeof value.symbol === 'string' && numbers(value, keys))) return fail()
  }
  if (endpoint === '/v1/calculate' && !numbers(payload, ['value'])) return fail()
  if (endpoint === '/v1/context-bars' || endpoint === '/v1/fx-bars') {
    if (!object(payload.values) || !Object.values(payload.values).every(value => Array.isArray(value) && value.every(validBar))) return fail()
  }
  if (endpoint.startsWith('/v1/replay/')) {
    if (endpoint === '/v1/replay/archives' && (!Array.isArray(payload.values) || typeof payload.database !== 'string')) return fail()
    if (endpoint.endsWith('/ticks')) {
      if (!numbers(payload, ['offset', 'limit', 'total']) || !Array.isArray(payload.values)) return fail()
      const validTick = (value: unknown) => object(value)
        && numbers(value, ['time_msc', 'bid', 'ask', 'last', 'volume', 'volume_real', 'flags'])
        && Number(value.time_msc) > 0
        && Math.min(Number(value.bid), Number(value.ask), Number(value.last), Number(value.volume), Number(value.volume_real)) >= 0
        && !(Number(value.bid) > 0 && Number(value.ask) > 0 && Number(value.ask) < Number(value.bid))
      if (!payload.values.every(validTick)) return fail()
    }
  }
}

export function fetchMt5Bars(
  timeframe: string,
  count = 5000,
  signal?: AbortSignal,
  symbol = 'XAUUSD'
): Promise<Mt5BarsResponse> {
  return localFetch<Mt5BarsResponse>(
    `/v1/bars?timeframe=${encodeURIComponent(timeframe)}&count=${count}&symbol=${encodeURIComponent(symbol)}`,
    signal
  )
}

export function fetchMt5Snapshot(signal?: AbortSignal, symbol = 'XAUUSD'): Promise<Mt5SnapshotResponse> {
  return localFetch<Mt5SnapshotResponse>(`/v1/snapshot?symbol=${encodeURIComponent(symbol)}`, signal)
}

export const fetchMt5Positions = (signal?: AbortSignal) => localFetch<{ observed_at: number; values: Mt5Position[] }>('/v1/positions', signal)
export const fetchMt5Orders = (signal?: AbortSignal) => localFetch<{ observed_at: number; values: Mt5Order[] }>('/v1/orders', signal)
export const fetchMt5Symbols = (query = '', signal?: AbortSignal) => localFetch<{ values: Mt5SymbolItem[] }>(`/v1/search-symbols?q=${encodeURIComponent(query)}`, signal)
export const fetchMt5SymbolInfo = (symbol: string, signal?: AbortSignal) => localFetch<Mt5SymbolInfo>(`/v1/symbol?requested=${encodeURIComponent(symbol)}`, signal)
export const fetchMt5FxBars = (timeframe = 'H1', signal?: AbortSignal) => localFetch<{ values: Record<string, Mt5Bar[]> }>('/v1/fx-bars?timeframe='+encodeURIComponent(timeframe), signal)
export const fetchMt5ContextBars = (symbol: string, signal?: AbortSignal) => localFetch<{ values: Record<string, Mt5Bar[]> }>(`/v1/context-bars?symbol=${encodeURIComponent(symbol)}`, signal)
export const fetchMt5Calculation = (payload: { action: 'profit' | 'margin'; symbol: string; side: 'buy' | 'sell'; volume: number; price: number; stop?: number }, signal?: AbortSignal) => {
  const query = new URLSearchParams({ action: payload.action, symbol: payload.symbol, side: payload.side, volume: String(payload.volume), price: String(payload.price) })
  if (payload.stop !== undefined) query.set('stop', String(payload.stop))
  return localFetch<{ value: number; currency?: string; symbol?: string }>(`/v1/calculate?${query.toString()}`, signal)
}

export function fetchMt5Health(signal?: AbortSignal) {
  return localFetch<{
    ok: boolean
    read_only: boolean
    bridge: string
    terminal: {
      name: string | null
      company: string | null
      path: string | null
      connected: boolean
      build: number | null
      version: string | null
    }
    symbol: string
    account: Mt5Account
  }>('/v1/health', signal)
}

export type ReplayArchive = {
  id: string
  status: 'importing' | 'complete' | 'failed' | 'cancelled' | 'interrupted'
  requested_symbol: string
  symbol: string
  broker: string
  server: string
  from_ms: number
  to_ms: number
  tick_count: number
  sha256: string | null
  manifest: Record<string, unknown>
  error: string | null
  created_at: string
  updated_at: string
}

export type ReplayImportJob = {
  id: string
  archive_id: string
  status: 'starting' | 'importing' | 'complete' | 'failed' | 'cancelled'
  symbol: string
  from_ms: number
  to_ms: number
  completed_through_ms: number
  tick_count: number
  progress: number
  error: string | null
  archive: ReplayArchive | null
}

export type ReplayTick = Pick<Mt5Tick, 'time_msc' | 'bid' | 'ask' | 'last' | 'volume' | 'volume_real' | 'flags'> & { sequence: number }

export type ReplayStrategy = { id: string; name: string; sha256: string; api_version: number; created_at: string; updated_at: string }
export type ReplayRunEvent = { sequence: number; tick_sequence: number | null; kind: string; time_msc: number; [key: string]: unknown }
export type ReplayRun = {
  id: string; archive_id: string; strategy_id: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  params: Record<string, unknown>; report: Record<string, unknown> | null; error: string | null;
  progress_ticks: number; total_ticks: number; created_at: string; updated_at: string;
}

export function startReplayImport(request: { symbol: string; fromMs: number; toMs: number }, signal?: AbortSignal) {
  return localRequest<ReplayImportJob>('/v1/replay/imports', {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: request.symbol, from_ms: request.fromMs, to_ms: request.toMs }),
  })
}

export function fetchReplayImport(jobId: string, signal?: AbortSignal) {
  return localFetch<ReplayImportJob>(`/v1/replay/imports/${encodeURIComponent(jobId)}`, signal)
}

export function cancelReplayImport(jobId: string, signal?: AbortSignal) {
  return localRequest<ReplayImportJob>(`/v1/replay/imports/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST', cache: 'no-store', signal,
  })
}

export function fetchReplayArchives(signal?: AbortSignal) {
  return localFetch<{ database: string; values: ReplayArchive[] }>('/v1/replay/archives', signal)
}

export function fetchReplayArchive(archiveId: string, signal?: AbortSignal) {
  return localFetch<ReplayArchive>(`/v1/replay/archives/${encodeURIComponent(archiveId)}`, signal)
}

export function fetchReplayTicks(archiveId: string, offset = 0, limit = 10_000, signal?: AbortSignal) {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  return localFetch<{ offset: number; limit: number; total: number; values: ReplayTick[] }>(
    `/v1/replay/archives/${encodeURIComponent(archiveId)}/ticks?${query.toString()}`,
    signal,
  )
}

export function fetchReplayStrategies(signal?: AbortSignal) {
  return localFetch<{ api_version: number; values: ReplayStrategy[] }>('/v1/replay/strategies', signal)
}

export function saveReplayStrategy(name: string, source: string, signal?: AbortSignal) {
  return localRequest<ReplayStrategy>('/v1/replay/strategies', {
    method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, source }),
  })
}

export function startReplayRun(request: { archiveId: string; strategyId: string; params?: Record<string, unknown> }, signal?: AbortSignal) {
  return localRequest<ReplayRun>('/v1/replay/runs', {
    method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archive_id: request.archiveId, strategy_id: request.strategyId, params: request.params ?? {} }),
  })
}

export function fetchReplayRun(runId: string, signal?: AbortSignal) {
  return localFetch<ReplayRun>(`/v1/replay/runs/${encodeURIComponent(runId)}`, signal)
}

export function cancelReplayRun(runId: string, signal?: AbortSignal) {
  return localRequest<ReplayRun>(`/v1/replay/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', cache: 'no-store', signal })
}

export function fetchReplayRunEvents(runId: string, offset = 0, limit = 500, signal?: AbortSignal) {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  return localFetch<{ offset: number; limit: number; total: number; values: ReplayRunEvent[] }>(
    `/v1/replay/runs/${encodeURIComponent(runId)}/events?${query.toString()}`,
    signal,
  )
}
