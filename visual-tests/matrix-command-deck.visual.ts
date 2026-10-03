import { expect, test, type Page, type Route } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const output = path.join(process.cwd(), 'artifacts', 'screenshots')
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

async function routeFixture(route: Route) {
  const url = new URL(route.request().url())
  const symbol = url.searchParams.get('symbol') || url.searchParams.get('requested') || 'XAUUSD'
  const account = accountSnapshot()

  if (url.pathname === '/v1/bars') {
    const timeframe = url.searchParams.get('timeframe') || 'M15'
    const values = barsFor(symbol, timeframe)
    return fulfillJson(route, { source: 'MT5', symbol, timeframe, requested_bars: 5000, loaded_bars: values.length, values, tick: tickFor(symbol), account, symbol_info: symbolInfo(symbol), market_session: { available: false, state: 'unknown', quote_open: null, trade_open: null } })
  }
  if (url.pathname === '/v1/snapshot') return fulfillJson(route, { source: 'MT5', symbol, tick: tickFor(symbol), account, symbol_info: symbolInfo(symbol) })
  if (url.pathname === '/v1/positions') return fulfillJson(route, {
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

async function prepareVisualPage(page: Page, marginQueries: string[] = []) {
  const pageErrors: string[] = []
  const browserErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await mkdir(output, { recursive: true })
  await page.setViewportSize({ width: 2560, height: 1440 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('http://127.0.0.1:8765/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/v1/calculate') marginQueries.push(url.searchParams.toString())
    return routeFixture(route)
  })
  await gotoTerminal(page, '/?ui=legacy')
  await expect(page.locator('.sf-app')).toBeVisible()
  return { pageErrors, browserErrors }
}

async function continueThroughStartup(page: Page) {
  const startup = page.getByRole('dialog', { name: 'LUNA URUCHAMIA TERMINAL_' })
  if (!(await startup.count())) return
  const continueButton = startup.getByRole('button', { name: /Jestem gotowa.*Naciśnij Enter/ })
  await expect(continueButton).toBeVisible({ timeout: 30000 })
  await continueButton.click()
  await expect(startup).toHaveCount(0, { timeout: 10000 })
}

async function gotoTerminal(page: Page, url = '/') {
  await page.goto(url)
  await continueThroughStartup(page)
}

async function reloadTerminal(page: Page) {
  await page.reload()
  await continueThroughStartup(page)
}

async function unlockTextDeck(page: Page) {
  const answer = page.getByRole('textbox', { name: 'Wpisz odpowiedź tak' })
  await answer.fill('tak')
  await answer.press('Enter')
  await expect(page.locator('.matrix-command-deck .session')).toHaveText('Luna › Witaj ponownie, admin :)')
}

test('approved text deck integrates the complete introduction, controls and manual lots',async({page})=>{
  const marginQueries:string[]=[]
  const {pageErrors,browserErrors}=await prepareVisualPage(page,marginQueries)
  const writes:string[]=[]
  page.on('request',r=>{if(new URL(r.url()).port==='8765'&&r.method()!=='GET')writes.push(r.url())})
  await gotoTerminal(page)
  const deck=page.locator('.matrix-command-deck'),chart=page.locator('.market-chart')
  await expect(deck.getByText('Wchodzimy razem do terminalu?',{exact:false})).toBeVisible()
  await expect(deck.locator('.ps-prefix')).toHaveText('User')
  await expect(deck.locator('.hint em')).toContainText('Napisz TAK, a otworzę narzędzia')
  const answer=deck.getByRole('textbox',{name:'Wpisz odpowiedź tak'})
  await answer.focus()
  await expect(answer).toHaveCSS('outline-width','0px')
  await expect(answer).toHaveCSS('border-top-width','0px')
  await page.screenshot({path:path.join(output,'matrix-text-deck-intro-qhd.png')})
  await answer.fill('tak');await answer.press('Enter')
  await expect(deck).toHaveAttribute('data-motion-phase','restored',{timeout:20000})
  await expect(deck.locator('.session')).toHaveText('Luna › Witaj ponownie, admin :)')
  await expect(deck).not.toContainText('command deck online')
  await expect(deck.locator('section')).toHaveCount(6)
  await expect(page.locator('.sf-right-column')).toHaveCSS('border-top-width','0px')
  await expect(deck.getByRole('slider',{name:'Ryzyko na transakcję'})).toHaveCount(0)
  const context=deck.getByRole('button',{name:/Kontekst H1:/})
  await context.click();await expect(context).toHaveAttribute('aria-pressed','true')
  await expect(page.locator('.sf-timeframes').getByRole('button',{name:'M15',exact:true})).toHaveClass(/active/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await deck.getByRole('button',{name:'RSI',exact:true}).click()
  await expect(chart).toHaveAttribute('data-indicator-pane-count','1')
  await deck.getByRole('spinbutton',{name:'Okres RSI'}).fill('9')
  await expect(deck.getByRole('spinbutton',{name:'Okres RSI'})).toHaveValue('9')
  await deck.getByRole('button',{name:'DZIŚ · D-H / D-L',exact:true}).click()
  await expect(chart).toHaveAttribute('data-reference-level-count','2')
  await deck.getByRole('button',{name:'Poziom',exact:true}).click()
  const box=await chart.boundingBox();if(!box)throw Error('missing chart')
  await chart.click({position:{x:box.width*.6,y:box.height*.45}})
  await expect(page.locator('[data-drawing-kind="horizontal"]')).toHaveCount(1)
  await deck.getByRole('button',{name:'Ustaw pozycję długą',exact:true}).click()
  await chart.click({position:{x:box.width*.58,y:box.height*.52}})
  await expect(chart).toHaveAttribute('data-planner-side','long')
  const lots=deck.getByRole('slider',{name:'Wielkość pozycji w lotach'})
  await lots.focus();await lots.press('Home');await lots.press('ArrowRight')
  await expect(lots).toHaveValue('0.02')
  await expect(deck.locator('.lot-heading output')).toHaveText('0.02 lota')
  await expect.poll(()=>marginQueries.some(q=>new URLSearchParams(q).get('volume')==='0.02')).toBe(true)
  const tp=deck.getByRole('button',{name:'Cel TP1',exact:true});await tp.click()
  await expect(chart).toHaveAttribute('data-planner-level-request','tp1')
  await chart.click({position:{x:box.width*.67,y:box.height*.38}})
  await expect(chart).toHaveAttribute('data-planner-level-request','none')
  await expect(deck.getByRole('slider',{name:'TP1 lotów do zamknięcia'})).toHaveValue('0.02')
  await expect(page.locator('.sf-chart-canvas')).toHaveAttribute('data-target-profit-tp1',/\+\d/)
  await deck.getByText('Ustawienia efektów',{exact:true}).click()
  for(const [preset,profile] of [['Spokojny','chill'],['Normalny','normal'],['Mocny','power']] as const){await deck.getByRole('button',{name:preset,exact:true}).click();await expect(deck).toHaveAttribute('data-profile',profile)}
  await expect(deck.locator('h3').first()).toHaveCSS('animation-name','none')
  await page.screenshot({path:path.join(output,'matrix-text-deck-qhd.png')})
  await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(output,'matrix-text-deck-1440.png')})
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:path.join(output,'matrix-text-deck-390.png')})
  await page.emulateMedia({reducedMotion:'reduce'});await reloadTerminal(page);await deck.getByRole('textbox',{name:'Wpisz odpowiedź tak'}).fill('tak');await deck.getByRole('textbox',{name:'Wpisz odpowiedź tak'}).press('Enter')
  await expect(deck.getByRole('button',{name:'RSI',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(deck.getByRole('spinbutton',{name:'Okres RSI'})).toHaveValue('9')
  await expect(deck).toHaveAttribute('data-profile','power')
  expect(writes).toEqual([]);expect(pageErrors).toEqual([]);expect(browserErrors).toEqual([])
})

test('text deck effects restore each glyph, rewrite words and cancel cleanly',async({page})=>{
  const {pageErrors}=await prepareVisualPage(page)
  await gotoTerminal(page)
  const deck=page.locator('.matrix-command-deck')
  await deck.getByRole('textbox',{name:'Wpisz odpowiedź tak'}).fill('tak');await deck.getByRole('textbox',{name:'Wpisz odpowiedź tak'}).press('Enter')
  await expect(deck).toHaveAttribute('data-motion-phase','restored',{timeout:20000})
  await deck.getByText('Ustawienia efektów',{exact:true}).click()
  const fall=deck.getByRole('button',{name:/Opad/}),rewrite=deck.getByRole('button',{name:/Pisanie/})
  const strength=deck.getByRole('slider',{name:'Natężenie opadu Matrix'});await strength.focus();await strength.press('End')
  await fall.click();await expect(deck).toHaveAttribute('data-motion-phase','blank')
  expect(await deck.locator('[data-deck-text]').evaluateAll(els=>els.every(el=>(el as HTMLElement).style.visibility==='hidden'))).toBe(true)
  await expect(deck).toHaveAttribute('data-motion-phase','falling')
  await expect(deck).toHaveAttribute('data-motion-phase','restored',{timeout:15000})
  expect(await deck.locator('[data-deck-text]').evaluateAll(els=>els.every(el=>(el as HTMLElement).style.visibility!== 'hidden'))).toBe(true)
  await fall.click()
  await deck.getByRole('slider',{name:'Natężenie pisania terminalu'}).focus();await page.keyboard.press('End')
  await rewrite.click();await expect(deck).toHaveAttribute('data-motion-phase','blank')
  await expect(deck).toHaveAttribute('data-motion-phase','typing')
  await page.screenshot({path:path.join(output,'matrix-text-deck-rewrite.png')})
  await expect(deck).toHaveAttribute('data-motion-phase','restored',{timeout:20000})
  await fall.click();await expect(rewrite).toHaveAttribute('aria-pressed','false')
  await expect(deck).toHaveAttribute('data-motion-phase','blank')
  await page.getByRole('button',{name:'Zatrzymaj animacje interfejsu'}).click()
  await expect(deck).toHaveAttribute('data-motion-phase','restored')
  await expect(deck.locator('h3').first()).toHaveCSS('animation-play-state','paused')
  await page.getByRole('button',{name:'Wznów animacje interfejsu'}).click()
  await page.emulateMedia({reducedMotion:'reduce'})
  await expect(deck.locator('h3').first()).toHaveCSS('animation-name','none')
  expect(await deck.locator('[data-deck-text]').evaluateAll(els=>els.every(el=>(el as HTMLElement).style.visibility!=='hidden'))).toBe(true)
  await reloadTerminal(page);await unlockTextDeck(page);await deck.getByText('Ustawienia efektów',{exact:true}).click();await expect(fall).toHaveAttribute('aria-pressed','true')
  expect(pageErrors).toEqual([])
})


test('real startup exposes continue after a fast bridge connection and accepts Polish confirmation',async({page})=>{
  await prepareVisualPage(page)
  await page.route('http://127.0.0.1:8765/**', routeFixture)
  await page.goto('/?startup-test=1')
  const startup=page.getByRole('dialog',{name:'LUNA URUCHAMIA TERMINAL_'})
  await expect(startup.locator('.crt-boot-log')).toContainText('Potwierdziłam zgodny most MT5', {timeout:30000})
  const continueButton=startup.getByRole('button',{name:/Jestem gotowa.*Naciśnij Enter/})
  await expect(continueButton).toBeVisible({timeout:30000})
  await continueButton.click()
  await expect(startup).toHaveCount(0,{timeout:10000})
  const answer=page.getByRole('textbox',{name:'Wpisz odpowiedź tak'})
  await answer.focus()
  const entry=page.locator('.ps-entry')
  expect(await entry.evaluate(el=>getComputedStyle(el,'::after').content)).toContain('▌')
  expect(await entry.evaluate(el=>getComputedStyle(el,'::after').left)).toBe('0px')
  await answer.fill('tak');await answer.press('Enter')
  await expect(page.locator('.matrix-command-deck .session')).toHaveText('Luna › Witaj ponownie, admin :)')
})

test('Exit unmounts the terminal, stops its feed and confirms bridge shutdown',async({page})=>{
  const {pageErrors}=await prepareVisualPage(page)
  let stopped=false,shutdownCalls=0
  const requestsAfterStop:string[]=[]
  page.on('request',request=>{if(stopped&&request.url().includes(':8765'))requestsAfterStop.push(new URL(request.url()).pathname)})
  await page.route('**/v1/runtime',route=>stopped?route.abort():fulfillJson(route,{instance:'test-instance',shutdown_token:'test-token',closing:false,bridge:'CRT_TERMINAL_MT5',protocol_version:5,owner:'manual'}))
  await page.route('**/v1/shutdown',async route=>{
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['x-crt-terminal-shutdown']).toBe('test-token')
    shutdownCalls++;stopped=true;await fulfillJson(route,{accepted:true,instance:'test-instance',bridge:'CRT_TERMINAL_MT5',protocol_version:5,owner:'manual'})
  })
  await gotoTerminal(page)
  await page.getByRole('button',{name:'Zamknij terminal i most MT5'}).click()
  const closing=page.getByRole('dialog',{name:'ZAMYKANIE TERMINALU'})
  await expect(closing).toBeVisible();await expect(page.locator('.sf-app')).toHaveCount(0)
  await expect(closing).toContainText('Do zobaczenia, admin!',{timeout:10000})
  for(const line of ['Wyłączam wskaźniki','Zamykam strumień wykresu','Zamykam terminal','Rozłączam MT5'])await expect(closing).toContainText(line)
  await expect(closing).toContainText('MOST MT5 ZATRZYMANY')
  expect(shutdownCalls).toBe(1)
  expect(requestsAfterStop.every(path=>path==='/v1/runtime')).toBe(true)
  expect(pageErrors).toEqual([])
  await page.screenshot({path:path.join(output,'matrix-terminal-shutdown-qhd.png')})
})

test('shutdown failure stays visible and retry can finish closing',async({page})=>{
  await prepareVisualPage(page)
  let runtimeCalls=0,stopped=false
  await page.route('**/v1/runtime',route=>{
    runtimeCalls++
    if(runtimeCalls===1)return fulfillJson(route,{detail:{error:'old bridge'}},404)
    if(stopped)return route.abort()
    return fulfillJson(route,{instance:'test-instance',shutdown_token:'test-token',closing:false,bridge:'CRT_TERMINAL_MT5',protocol_version:5,owner:'manual'})
  })
  await page.route('**/v1/shutdown',route=>{stopped=true;return fulfillJson(route,{accepted:true,instance:'test-instance',bridge:'CRT_TERMINAL_MT5',protocol_version:5,owner:'manual'})})
  await gotoTerminal(page);await page.getByRole('button',{name:'Zamknij terminal i most MT5'}).click()
  await expect(page.getByRole('alert')).toContainText('HTTP 404')
  await expect(page.getByText('Do zobaczenia, admin!',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'PONÓW ZAMYKANIE MOSTU'}).click()
  await expect(page.getByText('Do zobaczenia, admin!',{exact:true})).toBeVisible({timeout:10000})
})
