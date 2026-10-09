import type { Route } from '@playwright/test'

const quickSymbols = ['XAUUSD', 'BTCUSD', 'DJ30']
const activeSymbols = [...quickSymbols, 'EURUSD', 'GBPUSD', 'USDJPY']
const priceBases: Record<string, number> = {
  XAUUSD: 2780,
  BTCUSD: 67400,
  DJ30: 42380,
  EURUSD: 1.084,
  GBPUSD: 1.274,
  USDJPY: 148.5,
  USDCHF: 0.884,
  USDCAD: 1.356,
  AUDUSD: 0.659,
  NZDUSD: 0.612,
  EURGBP: 0.851,
  EURJPY: 161.0,
  GBPJPY: 189.2,
  AUDJPY: 97.8,
  EURCHF: 0.958,
  EURAUD: 1.645,
  GBPAUD: 1.934,
}

function symbolInfo(symbol: string) {
  const fx = symbol.length === 6 && !['XAUUSD', 'BTCUSD'].includes(symbol)
  const digits = symbol === 'DJ30' ? 1 : fx ? (symbol.endsWith('JPY') ? 3 : 5) : 2
  const point = 10 ** -digits
  const base = symbol.slice(0, 3)
  const quote = symbol.slice(3, 6)
  return {
    symbol,
    description: ({ XAUUSD: 'Gold vs US Dollar', BTCUSD: 'Bitcoin vs US Dollar', DJ30: 'Dow Jones 30' } as Record<string, string>)[symbol] || `${base} vs ${quote}`,
    path: fx ? `Forex\\${base}${quote}` : symbol === 'DJ30' ? 'Indices\\US' : 'Metals\\Spot',
    digits,
    point,
    spread: symbol === 'XAUUSD' ? 24 : symbol === 'BTCUSD' ? 180 : symbol === 'DJ30' ? 12 : 8,
    trade_tick_size: point,
    trade_tick_value: fx ? 1 : symbol === 'BTCUSD' ? 0.01 : 1,
    trade_tick_value_profit: fx ? 1 : symbol === 'BTCUSD' ? 0.01 : 1,
    trade_tick_value_loss: fx ? 1 : symbol === 'BTCUSD' ? 0.01 : 1,
    trade_contract_size: fx ? 100000 : symbol === 'XAUUSD' ? 100 : symbol === 'BTCUSD' ? 1 : 1,
    volume_min: 0.01,
    volume_max: 100,
    volume_step: 0.01,
    currency_base: symbol === 'XAUUSD' ? 'XAU' : symbol === 'BTCUSD' ? 'BTC' : symbol === 'DJ30' ? 'USD' : base,
    currency_profit: 'USD',
    currency_margin: 'USD',
    trade_mode: 4,
    visible: true,
    chart_mode: 1,
  }
}

function barsFor(symbol: string, timeframe = 'M15', count = 520) {
  const base = priceBases[symbol] ?? 1.1
  const fx = symbol.length === 6 && !['XAUUSD', 'BTCUSD'].includes(symbol)
  const scale = fx ? 0.0032 : symbol === 'BTCUSD' ? 1150 : symbol === 'DJ30' ? 620 : 18
  const stepSeconds: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800 }
  const step = stepSeconds[timeframe] ?? 900
  const now = Math.floor(Date.now() / 1000)
  const finalBarTime = Math.floor(now / step) * step
  const values: Array<{ time: number; open: number; high: number; low: number; close: number; tick_volume: number; spread: number; real_volume: number }> = []
  let previous = base - scale * 0.16
  for (let index = 0; index < count; index += 1) {
    const wave = Math.sin(index * 0.033) * 0.48 + Math.sin(index * 0.094 + 0.7) * 0.16 + Math.sin(index * 0.009 - 1.1) * 0.32
    const trend = ((index / (count - 1)) - 0.5) * 0.26
    const close = base + scale * (wave + trend)
    const open = previous
    const wick = scale * (0.018 + Math.abs(Math.sin(index * 0.61)) * 0.045)
    values.push({
      time: finalBarTime - (count - index - 1) * step,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      tick_volume: 18 + (index * 37) % 220,
      spread: symbolInfo(symbol).spread,
      real_volume: 0,
    })
    previous = close
  }
  return values
}

function accountSnapshot() {
  return {
    login: 984213,
    server: 'SmartFlow Visual Fixture',
    name: 'Visual QA Account',
    company: 'SmartFlow Test Broker',
    currency: 'USD',
    leverage: 100,
    balance: 12450,
    equity: 12482.6,
    profit: 32.6,
    margin: 1280,
    margin_free: 11202.6,
    margin_level: 975.2,
    trade_allowed: true,
    trade_expert: true,
    margin_mode: 0,
    day_pnl: 45.2,
    daily_win_rate: 66.7,
    observed_at: Date.now(),
  }
}

function tickFor(symbol: string) {
  const info = symbolInfo(symbol)
  const values = barsFor(symbol, 'M15', 2)
  const mid = values[1].close
  const timeMsc = Date.now()
  return {
    symbol,
    time: Math.floor(timeMsc / 1000),
    time_msc: timeMsc,
    bid: mid - info.point * 1.5,
    ask: mid + info.point * 1.5,
    last: mid,
    mid,
    volume: 12,
    volume_real: 0,
    flags: 1,
    observed_at: timeMsc,
    quote_age_ms: 0,
    freshness: 'fresh',
  }
}

function listedSymbols(query: string) {
  const symbols = [...new Set([...activeSymbols, 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURCHF', 'EURAUD', 'GBPAUD'])]
  const needle = query.trim().toUpperCase()
  return symbols
    .filter((symbol) => !needle || `${symbol} ${symbolInfo(symbol).description}`.toUpperCase().includes(needle))
    .map((symbol) => {
      const info = symbolInfo(symbol)
      return { symbol, description: info.description, path: info.path, digits: info.digits, visible: true, trade_mode: 4 }
    })
}

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5173', 'Access-Control-Expose-Headers': 'X-CRT-Protocol, X-CRT-Instance', 'X-CRT-Protocol': '5', 'X-CRT-Instance': 'visual-fixture' }, body: JSON.stringify(payload) })
}

export async function routeFixture(route: Route) {
  const url = new URL(route.request().url())
  const symbol = url.searchParams.get('symbol') || url.searchParams.get('requested') || 'XAUUSD'
  const account = accountSnapshot()

  if (url.pathname === '/v1/bars') {
    const timeframe = url.searchParams.get('timeframe') || 'M15'
    const values = barsFor(symbol, timeframe)
    return fulfillJson(route, { source: 'MT5', symbol, timeframe, requested_bars: 5000, loaded_bars: values.length, values, tick: tickFor(symbol), account, symbol_info: symbolInfo(symbol), market_session: { available: false, state: 'unknown', quote_open: null, trade_open: null } })
  }
  if (url.pathname === '/v1/snapshot') return fulfillJson(route, { source: 'MT5', symbol, tick: tickFor(symbol), account, symbol_info: symbolInfo(symbol) })
  if (url.pathname === '/v1/positions' || url.pathname === '/v1/positions/live') return fulfillJson(route, {
    observed_at: Date.now(),
    values: [
      { ticket: 8114021, symbol: 'XAUUSD', type: 'buy', volume: 0.1, price_open: 2764.2, sl: 2744.2, tp: 2802.2, profit: 18.4, swap: -0.4, commission: -0.8, time: Math.floor(Date.now() / 1000) - 3600 },
      { ticket: 8114086, symbol: 'BTCUSD', type: 'sell', volume: 0.01, price_open: 67700, sl: 68200, tp: 66600, profit: 5.1, swap: -0.1, commission: -0.2, time: Math.floor(Date.now() / 1000) - 7800 },
      { ticket: 8114190, symbol: 'DJ30', type: 'buy', volume: 0.1, price_open: 42320, sl: 42200, tp: 42550, profit: 9.8, swap: -0.2, commission: -0.5, time: Math.floor(Date.now() / 1000) - 12500 },
    ],
  })
  if (url.pathname === '/v1/orders') return fulfillJson(route, {
    observed_at: Date.now(),
    values: [{ ticket: 8115117, symbol: 'EURUSD', type: 'BUY_LIMIT', volume_initial: 0.05, price_open: 1.0792, sl: 1.0762, tp: 1.0852, price_current: priceBases.EURUSD, time_setup: Math.floor(Date.now() / 1000) - 600 }],
  })
  if (url.pathname === '/v1/symbol') return fulfillJson(route, symbolInfo(symbol))
  if (url.pathname === '/v1/search-symbols') return fulfillJson(route, { values: listedSymbols(url.searchParams.get('q') || '') })
  if (url.pathname === '/v1/fx-bars') {
    const pairs = listedSymbols('').filter((item) => item.symbol.length === 6 && !['XAUUSD', 'BTCUSD'].includes(item.symbol))
    return fulfillJson(route, { values: Object.fromEntries(pairs.map((item) => [item.symbol, barsFor(item.symbol, 'H1', 180)]) ) })
  }
  if (url.pathname === '/v1/context-bars') {
    const values = Object.fromEntries(['M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map((timeframe) => [timeframe, barsFor(symbol, timeframe, 220)])) as Record<string, ReturnType<typeof barsFor>>
    const h1 = values.H1
    const base = priceBases[symbol] ?? 1.1
    values.H1 = h1.map((bar, index) => {
      const close = base * (1.01 - index / (h1.length - 1) * 0.022)
      const open = close + base * 0.00005
      return { ...bar, open, close, high: Math.max(open, close) + base * 0.0001, low: Math.min(open, close) - base * 0.0001 }
    })
    return fulfillJson(route, { symbol, values })
  }
  if (url.pathname === '/v1/calculate') {
    const volume = Number(url.searchParams.get('volume') || '0')
    const marginPerLot: Record<string, number> = { XAUUSD: 1800, BTCUSD: 2800, DJ30: 1200, EURUSD: 1080 }
    return fulfillJson(route, { value: volume * (marginPerLot[symbol] ?? 1500), currency: 'USD', symbol })
  }
  if (url.pathname === '/v1/health') return fulfillJson(route, { ok: true, read_only: true, execution_mode: 'READ_ONLY', bridge: 'CRT_TERMINAL_MT5', protocol_version: 5, owner: 'manual', instance: 'visual-fixture', terminal: { name: 'Visual Fixture', company: 'CRT Terminal', path: null, connected: true, build: 0, version: 'visual' }, symbol: 'XAUUSD', account })
  if (url.pathname === '/v1/account') return fulfillJson(route, account)
  return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: { error: 'UNMOCKED_VISUAL_TEST_ENDPOINT', path: url.pathname } }) })
}

