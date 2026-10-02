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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (new URL(window.location.href).searchParams.get('startup-test') === '1') return
    try {
      window.sessionStorage.setItem('smartflow-x:startup-ready:v1', 'complete')
    } catch {
      // Visual tests exercise the terminal underneath the startup screen.
    }
  })
})

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

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
}

async function routeFixture(route: Route) {
  const url = new URL(route.request().url())
  const symbol = url.searchParams.get('symbol') || url.searchParams.get('requested') || 'XAUUSD'
  const account = accountSnapshot()

  if (url.pathname === '/v1/bars') {
    const timeframe = url.searchParams.get('timeframe') || 'M15'
    const values = barsFor(symbol, timeframe)
    return fulfillJson(route, { source: 'MT5', symbol, timeframe, requested_bars: 5000, loaded_bars: values.length, values, tick: tickFor(symbol), account, symbol_info: symbolInfo(symbol) })
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
  if (url.pathname === '/v1/health') return fulfillJson(route, { ok: true, read_only: true, bridge: 'SMARTFLOW_X_VISUAL_FIXTURE', terminal: { name: 'Visual Fixture', company: 'SmartFlow', path: null, connected: true, build: 0, version: 'visual' }, symbol: 'XAUUSD', account })
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
  await page.route('http://127.0.0.1:8765/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/v1/calculate') marginQueries.push(url.searchParams.toString())
    return routeFixture(route)
  })
  await page.goto('/?ui=legacy')
  await expect(page.locator('.sf-app')).toBeVisible()
  return { pageErrors, browserErrors }
}

test('startup gate initializes, waits for input and opens the terminal', async ({ page }) => {
  await page.goto('/?startup-test=1')

  const startup = page.getByRole('dialog', { name: 'POWERSHELL INITIALIZATION' })
  await expect(startup).toBeVisible()
  await expect(startup.locator('.sf-startup-status--0')).toBeVisible({ timeout: 5000 })
  const continueButton = startup.getByRole('button', { name: /TERMINAL READY.*PRESS ENTER TO CONTINUE/ })
  await expect(continueButton).toBeVisible({ timeout: 5000 })
  await page.keyboard.press('Enter')
  await expect(startup).toHaveCount(0)
  await expect(page.locator('.sf-app')).toBeVisible()
})

test('capture the approved Main Shell and module states for visual review', async ({ page }) => {
  const marginQueries: string[] = []
  const { pageErrors, browserErrors } = await prepareVisualPage(page, marginQueries)
  await expect(page.locator('[data-market-profile-overlay="tpo"]')).toBeVisible()
  await expect(page.locator('.sf-large-drawer')).toHaveCount(0)
  await expect(page.locator('.sf-command-scrim')).toHaveCount(0)
  await expect(page.locator('.sf-bottom-panel')).not.toHaveClass(/expanded/)
  await expect(page.locator('.sf-top-right')).toContainText('MT5 · LIVE', { timeout: 10000 })
  await expect(page.locator('.sf-account-metrics')).toContainText('WIN RATE DZIENNY')
  await expect(page.locator('.sf-metric').filter({ hasText: 'WIN RATE DZIENNY' }).locator('strong')).toHaveText('66.7%')
  const candleMetric = page.locator('.sf-metric').filter({ hasText: 'DO ŚWIECY' }).locator('strong')
  await expect(candleMetric).not.toHaveText('—')
  await expect(page.locator('.sf-metric').filter({ hasText: 'SERVER (UTC)' }).locator('strong')).toContainText('UTC')
  await expect(page.locator('.sf-chart-canvas canvas').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zarządzaj rysunkami' })).toHaveCount(0)
  await expect(page.locator('.market-chart')).toHaveAttribute('data-indicator-series-count', '0')
  await expect(page.locator('.sf-planner-card .dragon-target-selector')).toHaveCount(0)
  await page.locator('.sf-side-buttons .long').click()
  const chart = page.locator('.market-chart')
  await expect(chart).toHaveClass(/market-chart--placing/)
  const chartBox = await chart.boundingBox()
  if (!chartBox) throw new Error('Market chart is missing from the visual test viewport.')
  await chart.click({ position: { x: Math.round(chartBox.width * 0.56), y: Math.round(chartBox.height * 0.48) } })
  await expect(chart).not.toHaveClass(/market-chart--placing/)
  await expect(page.locator('.sf-planner-card .dragon-target-selector')).toBeVisible()
  await expect(chart).toHaveAttribute('data-planner-tp-label', 'FULL TP')
  for (const target of ['TP1', 'TP2', 'TP3']) await expect(page.locator('.sf-planner-card').getByRole('button', { name: target, exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-planner-target="tp2"], [data-planner-target="tp3"]')).toHaveCount(0)
  await expect(page.locator('.dragon-planner-risk-profit span').filter({ hasText: 'PROFIT' }).locator('b')).toContainText(/\+\d/)
  await expect(page.locator('.dragon-planner-risk-profit')).toContainText('PROFIT')
  await expect.poll(() => marginQueries.filter((query) => query.includes('action=margin')).length, { timeout: 10000 }).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.sf-chart-canvas')).toHaveAttribute('data-target-profit-full', /\+\d/)
  await expect(page.locator('.dragon-planner-risk-profit span').filter({ hasText: 'PROFIT' }).locator('b')).toContainText(/\+\d/)
  await expect(page.locator('.sf-risk-card')).toHaveClass(/\b(safe|warning)\b/, { timeout: 10000 })
  await expect(page.locator('.sf-toast')).toHaveCount(0, { timeout: 5000 })

  const capture = async (name: string) => {
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false, animations: 'disabled' })
  }
  const openDrawer = async (action: () => Promise<unknown>, file: string) => {
    const chartFrameBefore = await page.locator('.sf-chart-box').boundingBox()
    if (!chartFrameBefore) throw new Error('Chart frame is missing before opening a module.')
    await action()
    await expect(page.locator('.sf-large-drawer')).toBeVisible()
    await expect(page.locator('.sf-large-drawer')).toHaveCount(1)
    const chartFrameAfter = await page.locator('.sf-chart-box').boundingBox()
    if (!chartFrameAfter) throw new Error('Chart frame is missing while a module is open.')
    expect(chartFrameAfter).toEqual(chartFrameBefore)
    if (file === '02_risk_guard') {
      await expect(page.locator('.sf-risk-hero')).toBeVisible()
      await expect(page.locator('.sf-risk-usage-row')).toHaveCount(3)
    }
    if (file === '03_fx_context_engine') await expect(page.locator('.sf-fx-panel')).toHaveCount(6)
    if (file === '07_alert_engine') await expect(page.locator('.sf-alert-table-head')).toBeVisible()
    await capture(file)
    await page.locator('.sf-close').click()
    await expect(page.locator('.sf-large-drawer')).toHaveCount(0)
  }

  await capture('00_main_shell')
  await openDrawer(() => page.locator('.sf-planner-card .sf-panel-title button').click(), '01_trade_planner_pro')
  await page.locator('.sf-planner-card .sf-panel-title button').click()
  const plannerControls = page.locator('.sf-drawer-planner')
  await expect(plannerControls.locator('.sf-planner-summary > div').nth(1).locator('b')).toContainText(/\+\d/)
  for (const target of ['TP1', 'TP2', 'TP3']) await plannerControls.getByRole('button', { name: target, exact: true }).click()
  await expect(plannerControls.locator('input[type="range"]')).toHaveCount(4)
  await expect(plannerControls.getByLabel('TP1 lotów do zamknięcia')).toBeVisible()
  await expect(plannerControls.getByLabel('TP2 lotów do zamknięcia')).toBeVisible()
  await expect(plannerControls.getByLabel('TP3 lotów do zamknięcia')).toBeVisible()
  await expect(page.locator('.sf-chart-canvas')).toHaveAttribute('data-target-profit-tp1', '')
  await expect(page.locator('.sf-chart-canvas')).toHaveAttribute('data-target-profit-tp2', /\+\d/)
  await expect(page.locator('.sf-chart-canvas')).toHaveAttribute('data-target-profit-tp3', /\+\d/)
  await page.locator('.sf-close').click()
  const chartForTargetPick = page.locator('.market-chart')
  await expect(chartForTargetPick).toHaveAttribute('data-planner-level-request', 'tp3')
  await chartForTargetPick.click({ position: { x: 640, y: 250 } })
  await expect(chartForTargetPick).toHaveAttribute('data-planner-level-request', 'none')
  const fullTpBeforeTargets = await chartForTargetPick.getAttribute('data-planner-tp')
  const tp1Button = page.locator('.sf-planner-card').getByRole('button', { name: 'TP1', exact: true })
  await tp1Button.click()
  await expect(chartForTargetPick).toHaveAttribute('data-planner-level-request', 'tp1')
  await chartForTargetPick.click({ position: { x: 640, y: 390 } })
  await expect(chartForTargetPick).toHaveAttribute('data-planner-level-request', 'none')
  await expect(page.locator('[data-planner-target="tp1"]')).toBeVisible()
  await expect(chartForTargetPick).toHaveAttribute('data-planner-tp-label', 'FULL TP')
  await expect(chartForTargetPick).toHaveAttribute('data-planner-tp', fullTpBeforeTargets!)
  await expect(page.locator('.sf-chart-canvas')).toHaveAttribute('data-target-profit-tp1', /\+\d/)
  const tp2Line = page.locator('[data-planner-target="tp2"]')
  await expect(tp2Line).toBeVisible()
  const tp2Before = await tp2Line.getAttribute('data-price')
  const tp2Box = await tp2Line.boundingBox()
  if (!tp2Before || !tp2Box) throw new Error('Optional TP2 is missing from planner geometry.')
  await page.mouse.move(tp2Box.x + tp2Box.width / 2, tp2Box.y + tp2Box.height / 2)
  await page.mouse.down()
  await page.mouse.move(tp2Box.x + tp2Box.width / 2, tp2Box.y + tp2Box.height / 2 + 18, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => tp2Line.getAttribute('data-price')).not.toBe(tp2Before)
  const tp3Line = page.locator('[data-planner-target="tp3"]')
  await expect(tp3Line).toBeVisible()
  const tp3Before = await tp3Line.getAttribute('data-price')
  const tp3Box = await tp3Line.boundingBox()
  if (!tp3Before || !tp3Box) throw new Error('Optional TP3 is missing from planner geometry.')
  await page.mouse.move(tp3Box.x + tp3Box.width / 2, tp3Box.y + tp3Box.height / 2)
  await page.mouse.down()
  await page.mouse.move(tp3Box.x + tp3Box.width / 2, tp3Box.y + tp3Box.height / 2 + 14, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => tp3Line.getAttribute('data-price')).not.toBe(tp3Before)
  const beLine = page.locator('[data-planner-target="be"]')
  await expect(beLine).toBeVisible()
  const beBefore = await beLine.getAttribute('data-price')
  const beBox = await beLine.boundingBox()
  if (!beBefore || !beBox) throw new Error('Break-even geometry is missing.')
  await page.mouse.move(beBox.x + beBox.width / 2, beBox.y + beBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(beBox.x + beBox.width / 2, beBox.y + beBox.height / 2 - 12, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => beLine.getAttribute('data-price')).not.toBe(beBefore)
  await expect(page.getByRole('button', { name: 'ANULUJ PLAN', exact: true })).toBeVisible()
  await expect(page.locator('.sf-drawer-planner .sf-danger-button')).toHaveCount(0)
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Anulować edytowany plan')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: 'ANULUJ PLAN', exact: true }).click()
  await expect(page.locator('[data-planner-target="tp2"]')).toBeVisible()
  await openDrawer(() => page.locator('.sf-risk-card .sf-panel-title button').click(), '02_risk_guard')
  await page.locator('.sf-risk-card .sf-panel-title button').click()
  await expect(page.getByRole('dialog', { name: 'RISK GUARD' })).toBeVisible()
  await page.locator('.sf-planner-card .sf-panel-title button').click()
  await expect(page.locator('.sf-large-drawer')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'TRADE PLANNER PRO' })).toBeVisible()
  await page.locator('.sf-close').click()
  await openDrawer(() => page.locator('.sf-context-title').click(), '03_fx_context_engine')

  await page.locator('.sf-chart-actions button[title="Market Profile · show/hide"]').click()
  await expect(page.locator('[data-market-profile-overlay="tpo"]')).toHaveCount(0)
  await page.locator('.sf-chart-actions button[title="Market Profile · show/hide"]').click()
  await expect(page.locator('[data-market-profile-overlay="tpo"]')).toBeVisible()
  await page.getByRole('button', { name: 'Market Profile settings' }).click()
  await expect(page.locator('.sf-large-drawer')).toBeVisible()
  await expect(page.locator('.sf-profile-summary > div')).toHaveCount(5)
  const profileSettingsBox = await page.locator('.sf-profile-settings').boundingBox()
  const profileDrawerBox = await page.locator('.sf-large-drawer').boundingBox()
  if (!profileSettingsBox || !profileDrawerBox) throw new Error('Market Profile settings rail is missing.')
  expect(profileSettingsBox.width / profileDrawerBox.width).toBeGreaterThanOrEqual(0.27)
  expect(profileSettingsBox.width / profileDrawerBox.width).toBeLessThanOrEqual(0.31)
  const profilePeriod = page.locator('.sf-large-drawer .sf-field').filter({ hasText: 'OKRES' }).locator('b')
  await expect(profilePeriod).toHaveText('OSTATNIE 24 GODZINY')
  await page.getByRole('button', { name: 'TYGODNIOWY' }).click()
  await expect(profilePeriod).toHaveText('OSTATNIE 7 DNI')
  await page.getByRole('button', { name: 'DZIENNY' }).click()
  await capture('04_market_profile')
  await page.getByRole('button', { name: 'CUSTOM' }).click()
  const toLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  await page.getByLabel('Market Profile od').fill(toLocalInput(new Date(Date.now() - 3 * 60 * 60 * 1000)))
  await page.getByLabel('Market Profile do').fill(toLocalInput(new Date()))
  await expect(page.locator('.sf-large-drawer')).toContainText('POC')
  await page.getByLabel('Gęstość profilu').fill('3')
  await page.getByLabel('Szerokość profilu').fill('24')
  await page.getByLabel('Pozycja profilu').selectOption('left')
  await page.getByLabel('Pokaż Value Area').uncheck()
  await page.getByLabel('Pokaż Value Area').check()
  await expect(page.getByRole('button', { name: /Apply/i })).toHaveCount(0)
  await page.locator('.sf-close').click()
  await expect(page.locator('[data-market-profile-overlay="tpo"]')).toBeVisible()

  await page.locator('.sf-quick-draw').nth(1).click()
  await expect(page.locator('.sf-quick-draw.active')).toHaveCount(1)
  await openDrawer(() => page.locator('.sf-chart-actions button').nth(0).click(), '05_drawing_tools')
  await page.locator('.sf-chart-actions button').nth(0).click()
  const drawingDrawerBox = await page.locator('.sf-large-drawer').boundingBox()
  const drawingFrameBox = await page.locator('.sf-chart-box').boundingBox()
  if (!drawingDrawerBox || !drawingFrameBox) throw new Error('Drawing tool rail is missing.')
  expect(drawingDrawerBox.width / drawingFrameBox.width).toBeGreaterThanOrEqual(0.28)
  expect(drawingDrawerBox.width / drawingFrameBox.width).toBeLessThanOrEqual(0.34)
  await page.getByRole('button', { name: /Linia pionowa/ }).click()
  await expect(page.locator('.sf-large-drawer')).toHaveCount(0)
  const drawingChart = page.locator('.market-chart')
  const drawingChartBox = await drawingChart.boundingBox()
  if (!drawingChartBox) throw new Error('Market chart is missing before vertical-line placement.')
  await drawingChart.click({ position: { x: Math.round(drawingChartBox.width * 0.62), y: Math.round(drawingChartBox.height * 0.35) } })
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind="vertical"]')).toHaveCount(1)
  await page.locator('.sf-chart-actions button').nth(0).click()
  const noteInput = page.getByRole('textbox', { name: 'Treść notatki na wykresie' })
  await noteInput.fill('Strefa obserwacji')
  await page.getByRole('button', { name: 'UZBRÓJ NOTATKĘ' }).click()
  await expect(page.locator('.sf-large-drawer')).toHaveCount(0)
  await drawingChart.click({ position: { x: Math.round(drawingChartBox.width * 0.47), y: Math.round(drawingChartBox.height * 0.42) } })
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind="text"]')).toHaveText('Strefa obserwacji')

  await page.locator('.sf-quick-draw').first().click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.sf-quick-draw.active')).toHaveCount(0)

  const armDrawingTool = async (name: RegExp) => {
    await page.locator('.sf-chart-actions button').nth(0).click()
    await page.getByRole('button', { name }).click()
  }
  const chartClick = async (x: number, y: number) => {
    const box = await drawingChart.boundingBox()
    if (!box) throw new Error('Market chart is missing while placing a drawing.')
    await drawingChart.click({ position: { x: Math.round(box.width * x), y: Math.round(box.height * y) } })
  }
  const placeDrawing = async (name: RegExp, points: Array<[number, number]>) => {
    await armDrawingTool(name)
    for (const [x, y] of points) await chartClick(x, y)
  }

  await placeDrawing(/Linia pozioma/, [[0.42, 0.29]])
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind="horizontal"]')).toHaveCount(1)
  await armDrawingTool(/Wybierz \/ usuń rysunek/)
  await page.getByRole('button',{name:'Usuń rysunek 3',exact:true}).click()
  await page.getByRole('button',{name:'Zamknij listę rysunków'}).click()
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind="horizontal"]')).toHaveCount(0)
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind="vertical"]')).toHaveCount(1)
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind="text"]')).toHaveCount(1)

  await placeDrawing(/Linia trendu/, [[0.34, 0.44], [0.61, 0.35]])
  await placeDrawing(/Promień/, [[0.38, 0.55], [0.57, 0.46]])
  await placeDrawing(/Prostokąt \/ strefa/, [[0.32, 0.26], [0.49, 0.38]])
  await placeDrawing(/Kanał/, [[0.37, 0.62], [0.58, 0.52], [0.58, 0.42]])
  await placeDrawing(/Pomiar/, [[0.48, 0.66], [0.65, 0.58]])
  await placeDrawing(/Fibonacci/, [[0.40, 0.72], [0.66, 0.57]])
  for (const kind of ['trend', 'ray', 'rectangle', 'channel', 'measure', 'fib']) {
    await expect(page.locator(`.market-chart__drawing-overlay [data-drawing-kind="${kind}"]`)).toHaveCount(1)
  }
  await armDrawingTool(/Wyczyść rysunki/)
  await page.getByRole('button',{name:'Tak, wyczyść',exact:true}).click()
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind]')).toHaveCount(0)

  await placeDrawing(/Linia pionowa/, [[0.62, 0.35]])
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind="vertical"]')).toHaveCount(1)
  const originalTimeframe = (await page.locator('.sf-timeframes button.active').innerText()).trim()
  const alternateTimeframe = originalTimeframe === 'M5' ? 'M15' : 'M5'
  await page.locator('.sf-timeframes button').filter({ hasText: alternateTimeframe }).click()
  await expect.poll(() => page.locator('.market-chart__drawing-overlay [data-drawing-kind="vertical"]').count()).toBe(0)
  await page.locator('.sf-timeframes button').filter({ hasText: originalTimeframe }).click()
  await expect.poll(() => page.locator('.market-chart__drawing-overlay [data-drawing-kind="vertical"]').count()).toBe(1)
  await expect.poll(() => page.evaluate(() => {
    const timeframe = document.querySelector('.sf-timeframes button.active')?.textContent?.trim()
    const store = JSON.parse(localStorage.getItem('smartflow-x:drawings:v1') || '{}')
    return store[`XAUUSD|${timeframe}`]?.length ?? 0
  })).toBe(1)
  await page.reload()
  await expect(page.locator('.sf-app')).toBeVisible()
  await expect(page.locator('.market-chart__drawing-overlay [data-drawing-kind="vertical"]')).toHaveCount(1)
  await page.locator('.sf-symbol-trigger').click()
  await page.locator('.sf-quick-symbols button').filter({ hasText: 'BTCUSD' }).click()
  await expect(page.locator('.sf-symbol-trigger')).toContainText('BTCUSD')
  await expect.poll(() => page.locator('.market-chart__drawing-overlay [data-drawing-kind="vertical"]').count()).toBe(0)
  await page.locator('.sf-symbol-trigger').click()
  await page.locator('.sf-quick-symbols button').filter({ hasText: 'XAUUSD' }).click()
  await expect(page.locator('.sf-symbol-trigger')).toContainText('XAUUSD')
  await expect.poll(() => page.locator('.market-chart__drawing-overlay [data-drawing-kind="vertical"]').count()).toBe(1)
  await armDrawingTool(/Wyczyść rysunki/)
  await page.getByRole('button',{name:'Tak, wyczyść',exact:true}).click()
  await page.locator('.sf-chart-actions button').nth(1).click()
  await expect(page.locator('.sf-large-drawer')).toBeVisible()
  const indicatorSearch = page.getByRole('textbox', { name: 'Szukaj wskaźników' })
  await indicatorSearch.fill('SMA')
  await page.getByRole('button', { name: 'Dodaj SMA 20' }).click()
  const activeSma = page.locator('[data-indicator-name="SMA 20"]')
  await expect(activeSma).toBeVisible()
  await expect(page.locator('.market-chart')).toHaveAttribute('data-indicator-pane-count', '0')
  await expect(page.locator('.market-chart')).toHaveAttribute('data-indicator-series-count', '1')
  const smaVisibility = page.getByRole('checkbox', { name: 'Widoczność SMA 20' })
  await smaVisibility.uncheck()
  await expect(smaVisibility).not.toBeChecked()
  await expect(page.locator('.market-chart')).toHaveAttribute('data-indicator-series-count', '0')
  await smaVisibility.check()
  await expect(page.locator('.market-chart')).toHaveAttribute('data-indicator-series-count', '1')
  const smaPeriod = page.getByRole('spinbutton', { name: 'Okres SMA 20' })
  await smaPeriod.fill('34')
  await expect(smaPeriod).toHaveValue('34')
  await indicatorSearch.fill('')
  await capture('06_indicators_browser')
  await page.getByRole('button', { name: 'Usuń SMA 20' }).click()
  await expect(activeSma).toHaveCount(0)
  await expect(page.locator('.market-chart')).toHaveAttribute('data-indicator-series-count', '0')

  await indicatorSearch.fill('RSI')
  await page.getByRole('button', { name: 'Dodaj RSI' }).click()
  const activeRsi = page.locator('[data-indicator-name="RSI"]')
  await expect(activeRsi).toHaveAttribute('data-indicator-placement', 'pane')
  await expect.poll(() => page.locator('.market-chart').getAttribute('data-indicator-pane-count')).toBe('1')
  await expect.poll(() => page.locator('.market-chart').getAttribute('data-indicator-pane-scale-count')).toBe('1')
  const rsiVisibility = page.getByRole('checkbox', { name: 'Widoczność RSI' })
  const rsiPeriod = page.getByRole('spinbutton', { name: 'Okres RSI' })
  await rsiPeriod.fill('9')
  await rsiVisibility.uncheck()
  await expect.poll(() => page.locator('.market-chart').getAttribute('data-indicator-pane-count')).toBe('0')
  await page.reload()
  await expect(page.locator('.sf-app')).toBeVisible()
  await expect(page.locator('.sf-top-right')).toContainText('MT5 · LIVE', { timeout: 10000 })
  await expect(page.locator('.market-chart')).toHaveAttribute('data-indicator-series-count', '0')
  await page.locator('.sf-chart-actions button').nth(1).click()
  const persistedRsi = page.locator('[data-indicator-name="RSI"]')
  await expect(persistedRsi).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Okres RSI' })).toHaveValue('9')
  await expect(page.getByRole('checkbox', { name: 'Widoczność RSI' })).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Widoczność RSI' }).check()
  await expect.poll(() => page.locator('.market-chart').getAttribute('data-indicator-pane-count')).toBe('1')
  await page.getByRole('button', { name: 'Usuń RSI' }).click()
  await expect(persistedRsi).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.sf-app')).toBeVisible()
  await expect(page.locator('.sf-top-right')).toContainText('MT5 · LIVE', { timeout: 10000 })
  await page.locator('.sf-chart-actions button').nth(1).click()
  await expect(page.locator('[data-indicator-name="RSI"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Dodaj RSI' })).toBeEnabled()
  await page.locator('.sf-close').click()

  await page.locator('.sf-chart-actions button').nth(2).click()
  await expect(page.locator('.sf-large-drawer')).toBeVisible()
  const visibleAlertLevel = Number(tickFor('XAUUSD').mid.toFixed(2))
  await page.locator('.sf-alert-create input[type="number"]').fill(String(visibleAlertLevel))
  await page.locator('.sf-alert-create select').selectOption('above')
  await page.getByRole('button', { name: 'UTWÓRZ ALERT' }).click()
  await expect(page.locator('.sf-alert-row')).toBeVisible()
  await capture('07_alert_engine')
  const alertId = await page.locator('.sf-alert-row[data-alert-id]').first().getAttribute('data-alert-id')
  if (!alertId) throw new Error('Created alert has no id.')
  await page.locator('.sf-close').click()
  const alertHit = page.locator(`[data-alert-hit="${alertId}"]`)
  await expect(alertHit).toBeVisible()
  await alertHit.click()
  await expect(page.locator('.sf-large-drawer')).toBeVisible()
  await expect(page.locator(`[data-alert-id="${alertId}"]`)).toHaveClass(/is-focused/)
  await expect(page.locator('.sf-alert-create input[type="number"]')).toHaveValue(String(visibleAlertLevel))
  const alertToggle = page.locator(`[data-alert-id="${alertId}"] input[type="checkbox"]`)
  await alertToggle.uncheck()
  await expect(page.locator(`[data-alert-hit="${alertId}"]`)).toHaveCount(0)
  await alertToggle.check()
  await expect(page.locator(`[data-alert-hit="${alertId}"]`)).toBeVisible()
  await page.locator('.sf-close').click()

  await page.locator('.sf-symbol-trigger').click()
  await expect(page.locator('.sf-large-drawer')).toBeVisible()
  await page.locator('.sf-large-drawer input.sf-search-field').fill('USD')
  await expect(page.locator('.sf-symbol-results button').first()).toBeVisible()
  const selectorBox = await page.locator('.sf-large-drawer').boundingBox()
  const selectorFrameBox = await page.locator('.sf-chart-box').boundingBox()
  if (!selectorBox || !selectorFrameBox) throw new Error('Instrument selector flyout is missing.')
  expect(selectorBox.width / selectorFrameBox.width).toBeGreaterThanOrEqual(0.6)
  expect(selectorBox.width / selectorFrameBox.width).toBeLessThanOrEqual(0.68)
  await capture('08_instrument_selector')
  const selectorPin = page.getByRole('checkbox', { name: 'PIN Instrument Selector' })
  await selectorPin.check()
  await page.locator('.sf-quick-symbols button').filter({ hasText: 'BTCUSD' }).click()
  await expect(page.locator('.sf-large-drawer')).toBeVisible()
  await expect(page.locator('.sf-symbol-trigger')).toContainText('BTCUSD')
  await selectorPin.uncheck()
  await page.locator('.sf-quick-symbols button').filter({ hasText: 'DJ30' }).click()
  await expect(page.locator('.sf-large-drawer')).toHaveCount(0)

  await page.locator('.sf-bottom-tabs button').nth(0).click()
  await expect(page.locator('.sf-bottom-workspace [data-bottom-section]')).toHaveCount(3)
  await expect(page.locator('[data-bottom-section="positions"]')).toBeVisible()
  await expect(page.locator('[data-bottom-section="orders"]')).toBeVisible()
  await expect(page.locator('[data-bottom-section="account"]')).toContainText('FLOATING P&L')
  const terminalBox = await page.locator('.sf-bottom-panel').boundingBox()
  const centerBox = await page.locator('.sf-center-column').boundingBox()
  if (!terminalBox || !centerBox) throw new Error('Expanded terminal or chart column is missing.')
  expect(terminalBox.height / centerBox.height).toBeGreaterThanOrEqual(0.55)
  expect(terminalBox.height / centerBox.height).toBeLessThanOrEqual(0.65)
  await capture('09_positions_orders_account')
  await page.locator('[data-position-ticket="8114021"]').click()
  await expect(page.locator('.sf-large-drawer')).toContainText('MANAGE POSITION')
  await expect(page.locator('[data-managed-position="8114021"]')).toBeVisible()
  await page.locator('.sf-close').click()
  await page.locator('[data-position-ticket="8114086"]').click()
  await expect(page.locator('.sf-symbol-trigger')).toContainText('BTCUSD')
  await expect(page.locator('[data-managed-position="8114086"]')).toBeVisible()
  await page.locator('.sf-close').click()
  await page.locator('.sf-watch-row').filter({ hasText: 'XAUUSD' }).click()
  await page.locator('.sf-bottom-tabs button').nth(1).click()
  await capture('09_orders')
  await page.locator('[data-order-ticket="8115117"]').click()
  await expect(page.locator('.sf-symbol-trigger')).toContainText('EURUSD')
  await expect(page.locator('[data-managed-order="8115117"]')).toBeVisible()
  await page.locator('.sf-watch-row').filter({ hasText: 'XAUUSD' }).click()
  await page.locator('.sf-bottom-tabs button').nth(2).click()
  await capture('09_account')
  const bottomPanel = page.locator('.sf-bottom-panel')
  const resizeHandle = page.getByRole('button', { name: 'Zmień wysokość dolnego panelu' })
  const resizeBox = await resizeHandle.boundingBox()
  if (!resizeBox) throw new Error('Bottom panel resize handle is missing.')
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + 3)
  await page.mouse.down()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y - 45, { steps: 4 })
  await page.mouse.up()
  await expect(bottomPanel).toHaveClass(/expanded/)
  const persistedPanel = await page.evaluate(() => JSON.parse(localStorage.getItem('smartflow-x:bottom-panel:v1') || 'null'))
  expect(persistedPanel.tab).toBe('account')
  expect(persistedPanel.expanded).toBe(true)
  expect(persistedPanel.height).toBeGreaterThan(230)
  const persistedHeight = persistedPanel.height
  await page.reload()
  await expect(page.locator('.sf-top-right')).toContainText('MT5 · LIVE', { timeout: 10000 })
  await expect(page.locator('.sf-bottom-tabs button').nth(2)).toHaveClass(/active/)
  await expect(page.locator('.sf-bottom-panel')).toHaveClass(/expanded/)
  await expect.poll(() => page.locator('.sf-bottom-panel').getAttribute('data-bottom-height')).toBe(String(persistedHeight))
  expect(pageErrors, pageErrors.join('\n')).toEqual([])
  expect(browserErrors, browserErrors.join('\n')).toEqual([])
})

test('exercise MTF context from a clean shell', async ({ page }) => {
  const { pageErrors, browserErrors } = await prepareVisualPage(page)
  await expect(page.locator('.sf-top-right')).toContainText(/MT5.*LIVE/, { timeout: 10000 })
  await expect(page.locator('.sf-chart-canvas canvas').first()).toBeVisible()
  await page.locator('.sf-bottom-tabs button').nth(2).click()
  const bottomPanel = page.locator('.sf-bottom-panel')
  const resizeHandle = page.locator('.sf-bottom-resize')
  const resizeBox = await resizeHandle.boundingBox()
  if (!resizeBox) throw new Error('Bottom panel resize handle is missing.')
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + 3)
  await page.mouse.down()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y - 45, { steps: 4 })
  await page.mouse.up()
  await expect(bottomPanel).toHaveClass(/expanded/)
  const capture = async (name: string) => {
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false, animations: 'disabled' })
  }
  await expect(page.locator('.sf-top-right .sf-icon-button')).toHaveCount(0)
  await page.locator('.sf-timeframes button').filter({ hasText: 'M15' }).click()
  await page.locator('.sf-mtf-card').nth(3).click()
  await expect(page.locator('.sf-large-drawer')).toBeVisible()
  await expect(page.locator('.sf-context-quote')).toBeVisible()
  await expect(page.locator('.sf-context-grid > *')).toHaveCount(3)
  await expect(page.locator('.sf-large-drawer')).toContainText('CONTEXT H1')
  await expect(page.locator('.sf-large-drawer')).toContainText('H1')
  await expect(page.locator('.sf-timeframes button.active')).toHaveText('M15')
  await expect(page.locator('.sf-large-drawer .sf-field').filter({ hasText: 'STRUKTURA' }).locator('b')).toHaveText('BEARISH')
  await capture('11_context_panel')
  await page.locator('.sf-bottom-tabs button').nth(0).click()
  await expect(page.locator('.sf-bottom-panel')).toHaveClass(/expanded/)
  await expect(page.locator('.sf-large-drawer')).toBeVisible()
  await expect(page.locator('.sf-bottom-panel')).toHaveClass(/expanded/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.sf-large-drawer')).toHaveCount(0)
  await expect(page.locator('.sf-bottom-panel')).toHaveClass(/expanded/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.sf-bottom-panel')).not.toHaveClass(/expanded/)

  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(pageErrors, pageErrors.join('\n')).toEqual([])
  expect(browserErrors, browserErrors.join('\n')).toEqual([])
})


async function unlockTextDeck(page: Page) {
  await page.emulateMedia({reducedMotion:'reduce'})
  const answer=page.getByRole('textbox',{name:'Odpowiedź yes'})
  await answer.fill('yes'); await answer.press('Enter')
  await expect(page.locator('.matrix-command-deck .session')).toHaveText('welcome back admin :)')
}

test('matrix artwork stays behind the chart and navigation remains read only',async({page})=>{
 const {pageErrors}=await prepareVisualPage(page)
 await page.goto('/');await unlockTextDeck(page)
 await expect(page.locator('.matrix-agent-art img')).toHaveAttribute('src','/assets/agent-terminal-hq.webp')
 await expect.poll(()=>page.locator('.matrix-agent-art img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===1122&&img.naturalHeight===1402)).toBe(true)
 await expect(page.locator('.matrix-agent-art')).toHaveCSS('pointer-events','none')
 const chart=page.locator('.market-chart'), box=await chart.boundingBox()
 expect(box!.width).toBeGreaterThan(2560*.5)
 for(const [name,attribute] of [['Auto scroll','data-auto-scroll'],['Chart shift','data-chart-shift']] as const){
  const button=page.getByRole('button',{name});await button.click();await expect(chart).toHaveAttribute(attribute,'false');await button.click();await expect(chart).toHaveAttribute(attribute,'true')
 }
 await page.keyboard.press('Control+K');await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Otwórz paletę poleceń'})).toHaveCount(0)
 expect(pageErrors).toEqual([])
})

test('dragon terminal reports missing bridge without invented quotes or news', async ({ page }) => {
  await mkdir(output, {recursive:true})
  await page.addInitScript(() => localStorage.setItem('smartflow-x:bottom-panel:v1', JSON.stringify({expanded:true,tab:'account',height:900})))
  await page.route('http://127.0.0.1:8765/**', route => route.abort())
  await page.goto('/'); await unlockTextDeck(page)
  await expect(page.locator('.dragon-terminal-log')).toContainText(/FEED (ERROR|OFFLINE)/, {timeout:15000})
  await expect(page.locator('.matrix-command-deck')).toContainText('Plan podglądowy · zlecenia wyłączone')
  await expect(page.locator('.dragon-terminal-log')).not.toContainText('HIGH IMPACT')
  await expect(page.locator('.matrix-command-deck')).toContainText('N/A')
  await page.setViewportSize({width:2048,height:1020})
  await expect(page.locator('.sf-bottom-panel')).toHaveCount(0)
  const offlineChart = await page.locator('.market-chart').boundingBox()
  expect(offlineChart!.height).toBeGreaterThan(850)
  const deck = await page.locator('.sf-right-column').boundingBox()
  expect(deck).toBeTruthy()
  await expect(page.locator('.dragon-modules')).toHaveCount(0)
  await page.screenshot({path:output + '/dragon-terminal-offline-frames.png'})
  await expect(page.locator('.dragon-telemetry')).toHaveCount(0)
})

test('dragon drawing supports drag, click preview, future space and scope cancellation', async ({ page }) => {
  const { pageErrors } = await prepareVisualPage(page)
  await page.goto('/'); await unlockTextDeck(page)
  await expect(page.locator('.dragon-clock')).toContainText('MT5 LIVE')
  await expect(page.locator('.sf-bottom-panel')).toHaveCount(0)
  await expect(page.locator('.market-chart')).toHaveAttribute('data-key-level-count','0')
  await expect(page.getByRole('button',{name:'Najbliższe wsparcie i opór'})).toHaveCount(0)
  await expect(page.locator('[data-terminal-status="account"]')).toContainText('EQUITY')
  await expect(page.locator('[data-terminal-status="position"]')).toHaveCount(3)
  await expect(page.locator('[data-terminal-status="order"]')).toHaveCount(1)
  const chart = page.locator('.market-chart')
  const box = await chart.boundingBox()
  if (!box) throw Error('No chart')
  const start = {x:box.x + box.width*.36, y:box.y + box.height*.3}
  const end = {x:box.x + box.width*.65, y:box.y + box.height*.46}
  await page.locator('.matrix-command-deck').getByRole('button',{name:'Trend'}).click()
  await page.mouse.move(start.x,start.y)
  await page.mouse.down()
  await page.mouse.move(end.x,end.y,{steps:12})
  await expect(page.locator('.market-chart__draft [data-drawing-kind="trend"]')).toHaveCount(1)
  await page.mouse.up()
  await expect(chart).toHaveAttribute('data-drawing-armed','none')
  await expect(page.locator('.matrix-command-deck').getByRole('button',{name:'Trend'})).toHaveAttribute('aria-pressed','false')
  const line = page.locator('[data-drawing-kind="trend"]')
  await expect(line).toHaveCount(1)
  const trendLabel = page.locator('.drawing-terminal-label')
  await expect(trendLabel).toHaveAttribute('data-drawing-label', 'trendline')
  const labelAnchor = await trendLabel.evaluate(el => [
    Number(el.getAttribute('data-label-anchor-x')),
    Number(el.getAttribute('data-label-anchor-y')),
  ])
  const xy = await line.evaluate(el => ['x1','y1','x2','y2'].map(key => Number(el.getAttribute(key))))
  expect(Math.abs(xy[0] - box.width*.36)).toBeLessThan(8)
  expect(Math.abs(xy[1] - box.height*.3)).toBeLessThan(3)
  expect(Math.abs(xy[2] - box.width*.65)).toBeLessThan(8)
  expect(Math.abs(xy[3] - box.height*.46)).toBeLessThan(3)
  expect(Math.abs(labelAnchor[0] - xy[2])).toBeLessThan(.01)
  expect(Math.abs(labelAnchor[1] - xy[3])).toBeLessThan(.01)
  await page.locator('.matrix-command-deck').getByRole('button',{name:'Fibo'}).click()
  await chart.click({position:{x:box.width*.88,y:box.height*.3}})
  await page.mouse.move(box.x + box.width*.92,box.y + box.height*.5)
  await expect(page.locator('.market-chart__draft [data-drawing-kind="fib"]')).toHaveCount(1)
  await chart.click({position:{x:box.width*.92,y:box.height*.5}})
  await expect(chart).toHaveAttribute('data-drawing-armed','none')
  await expect(page.locator('[data-drawing-kind="fib"] line')).toHaveCount(7)
  const fibWidth = await page.locator('[data-drawing-kind="fib"] line').first().evaluate(el => Number(el.getAttribute('x2')) - Number(el.getAttribute('x1')))
  expect(fibWidth).toBeGreaterThan(box.width*.03)
  await page.locator('.matrix-command-deck').getByRole('button',{name:'Strefa'}).click()
  await chart.click({position:{x:box.width*.3,y:box.height*.3}})
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5)
  await expect(page.locator('.market-chart__draft')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.market-chart__draft')).toHaveCount(0)
  await expect(chart).toHaveAttribute('data-drawing-armed','none')
  await page.locator('.matrix-command-deck').getByRole('button',{name:'Strefa'}).click()
  await chart.click({position:{x:box.width*.3,y:box.height*.3}})
  await page.locator('.sf-timeframes').getByRole('button',{name:'H1',exact:true}).click()
  await expect(chart).toHaveAttribute('data-drawing-armed','none')
  await expect(page.locator('.market-chart__draft')).toHaveCount(0)
  await expect(page.locator('[data-drawing-kind="trend"]')).toHaveCount(0)
  await page.locator('.sf-timeframes').getByRole('button',{name:'M15',exact:true}).click()
  await expect(page.locator('[data-drawing-kind="trend"]')).toHaveCount(1)
  await page.setViewportSize({width:1440,height:900})
  await expect(page.locator('[data-drawing-kind="trend"]')).toHaveCount(1)
  await page.setViewportSize({width:2560,height:1440})
  await expect(chart).toHaveAttribute('data-key-level-count','0')
  const dailyLevelToggle=page.getByRole('button',{name:'DZIŚ · D-H / D-L',exact:true})
  await dailyLevelToggle.click()
  await expect(chart).toHaveAttribute('data-reference-level-count','2')
  await dailyLevelToggle.click()
  await expect(chart).toHaveAttribute('data-reference-level-count','0')
  await expect(page.locator('[data-terminal-status="order"]')).toHaveCount(1)
  await expect(page.locator('[data-terminal-status="position"]')).toHaveCount(3)
  await expect(chart).toHaveAttribute('data-volume-visible','false')
  await page.getByRole('button',{name:'Tick Volume',exact:true}).click()
  await expect(chart).toHaveAttribute('data-volume-visible','true')
  await page.getByRole('button',{name:'Tick Volume',exact:true}).click()
  const accountBox = await page.locator('.dragon-account-terminal').boundingBox()
  const plotBox = await chart.boundingBox()
  expect(accountBox!.y).toBeGreaterThan(plotBox!.y + plotBox!.height*.8)
  await expect(page.locator('.dragon-terminal-log [data-terminal-status="account"]')).toHaveCount(0)
  await expect(page.locator('[data-drawing-kind="fib"] [data-fib-ratio="0"] text')).toContainText('0.0%')
  await expect(page.locator('[data-drawing-kind="fib"] [data-fib-ratio="1"] text')).toContainText('100.0%')
  await expect(page.locator('.drawing-terminal-label')).toContainText('TRENDLINE_01')
  await expect(page.locator('.market-chart__hud--right')).toHaveCount(0)
  await page.screenshot({path:output + '/dragon-terminal-status-drawings.png'})
  const trendXY = await line.evaluate(el => ['x1','y1','x2','y2'].map(key => Number(el.getAttribute(key))))
  await page.mouse.click(plotBox!.x + (trendXY[0]+trendXY[2])/2, plotBox!.y + (trendXY[1]+trendXY[3])/2)
  await expect(page.getByRole('button',{name:'Zarządzaj rysunkami'})).toHaveAttribute('aria-expanded','true')
  await expect(page.getByRole('button',{name:'01 / TRENDLINE',exact:true})).toHaveAttribute('aria-pressed','true')
  await page.keyboard.press('Delete')
  await expect(page.locator('[data-drawing-kind="trend"]')).toHaveCount(0)
  await expect(page.locator('[data-drawing-kind="fib"]')).toHaveCount(1)
  await page.reload(); await unlockTextDeck(page)
  await expect(page.locator('.dragon-clock')).toContainText('MT5 LIVE')
  await expect(chart).toHaveAttribute('data-volume-visible','false')
  await expect(page.locator('[data-drawing-kind="trend"]')).toHaveCount(0)
  await expect(page.locator('[data-drawing-kind="fib"]')).toHaveCount(1)
  await page.getByRole('button',{name:'Zarządzaj rysunkami'}).click()
  await page.getByRole('button',{name:'Wyczyść wszystkie rysunki',exact:true}).click()
  await page.getByRole('button',{name:'Anuluj',exact:true}).click()
  await expect(page.locator('[data-drawing-kind="fib"]')).toHaveCount(1)
  await page.getByRole('button',{name:'Wyczyść wszystkie rysunki',exact:true}).click()
  await page.getByRole('button',{name:'Tak, wyczyść',exact:true}).click()
  await expect(page.locator('[data-drawing-kind="fib"]')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Zarządzaj rysunkami'})).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('dragon chart recovers when MT5 bridge starts after initial history request', async ({ page }) => {
  let historyAttempts = 0
  let bridgeStarted = false
  await page.route('http://127.0.0.1:8765/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/v1/bars' && url.searchParams.get('count') === '5000') {
      historyAttempts++
      if (!bridgeStarted) return route.abort()
    }
    return routeFixture(route)
  })
  await page.goto('/'); await unlockTextDeck(page)
  await expect(page.locator('.dragon-terminal-log')).toContainText('ERROR')
  bridgeStarted = true
  await expect(page.locator('.dragon-clock')).toContainText('MT5 LIVE',{timeout:10000})
  expect(historyAttempts).toBeGreaterThanOrEqual(2)
})

test('dragon planner keeps simple draggable levels and cancels gestures across scopes', async ({ page }) => {
  test.setTimeout(30000)
  const {pageErrors} = await prepareVisualPage(page, [])
  await page.goto('/'); await unlockTextDeck(page)
  await expect(page.locator('.dragon-clock')).toContainText('MT5 LIVE')
  const chart = page.locator('.market-chart')
  const box = await chart.boundingBox()
  if (!box) throw Error('Chart missing')
  const state = () => chart.evaluate(el => Object.fromEntries(['entry','tp','sl','start','end'].map(key => [key, Number(el.getAttribute('data-planner-'+key))])))
  const geometry = async () => { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); return page.locator('[data-planner-geometry="main"]').evaluate(el => Object.fromEntries(['x','y','width','height','data-entry-y','data-tp-y','data-sl-y','data-handle-y'].map(key => [key, Number(el.getAttribute(key))]))) }
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(box.x+x,box.y+y); await page.mouse.down()
    await page.mouse.move(box.x+x+dx,box.y+y+dy,{steps:10}); await page.mouse.up()
  }
  await page.getByRole('button',{name:'Plan LONG',exact:true}).click()
  await chart.click({position:{x:box.width*.61,y:box.height*.52}})
  await expect(chart).toHaveAttribute('data-planner-side','long')
  await expect(chart).toHaveAttribute('data-planner-be','off')
  await expect(page.locator('[data-planner-target="be"]')).toHaveCount(0)
  let before = await state(); let g = await geometry()
  expect(g.width).toBeGreaterThan(179)
  const pricePerPixel = (before.tp-before.entry)/(g['data-tp-y']-g['data-entry-y'])
  // Grab slightly below Entry: preserve the offset instead of snapping to cursor.
  await drag(g.x+40,g['data-entry-y']+5,0,12)
  let after = await state()
  expect(Math.abs(after.entry - (before.entry+pricePerPixel*12))).toBeLessThan(.021)
  expect(after.tp).toBe(before.tp); expect(after.sl).toBe(before.sl)
  // Whole-plan drag moves every price equally and preserves time width and R:R.
  before=await state(); g=await geometry()
  await drag(g.x+35,g['data-handle-y'],30,-20)
  after=await state()
  const delta=after.entry-before.entry
  expect(Math.abs((after.tp-before.tp)-delta)).toBeLessThan(.021)
  expect(Math.abs((after.sl-before.sl)-delta)).toBeLessThan(.021)
  expect(Math.abs((after.end-after.start)-(before.end-before.start))).toBeLessThan(.001)
  expect(after.start).toBeGreaterThan(before.start)
  // Dragging an empty gap moves the plan; no box resize controls are exposed.
  before=await state(); g=await geometry()
  await drag(g.x+g.width-4,g['data-handle-y'],35,0)
  after=await state()
  expect(after.entry).toBe(before.entry)
  expect(after.start).toBeGreaterThan(before.start)
  expect(Math.abs((after.end-after.start)-(before.end-before.start))).toBeLessThan(.001)
  expect(Math.abs((after.tp-before.tp)-(after.entry-before.entry))).toBeLessThan(.021)
  expect(Math.abs((after.sl-before.sl)-(after.entry-before.entry))).toBeLessThan(.021)
  // TP line remains a direct price handle.
  before=await state(); g=await geometry()
  await drag(g.x+1,g['data-tp-y'],0,-15)
  after=await state()
  expect(after.tp).toBeGreaterThan(before.tp)
  expect(after.start).toBe(before.start); expect(after.end).toBe(before.end)
  expect(after.entry).toBe(before.entry); expect(after.sl).toBe(before.sl)
  // Escape restores the complete pre-grab state and releases chart navigation.
  before=await state(); g=await geometry()
  await page.mouse.move(box.x+g.x+35,box.y+g['data-handle-y']); await page.mouse.down()
  await page.mouse.move(box.x+g.x+65,box.y+g['data-handle-y']-20,{steps:5})
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await state()).toEqual(before)
  await expect(chart).not.toHaveClass(/planner-moving/)
  await expect(page.locator('.sf-planner-card .sf-panel-title button')).toHaveCount(0)
  await page.screenshot({path:output+'/dragon-planner-interactions.png'})
  before=await state(); g=await geometry()
  const xBeforeWheel=g.x
  await page.mouse.move(box.x+180,box.y+180); await page.mouse.wheel(0,100)
  await expect.poll(async () => (await geometry()).x).not.toBe(xBeforeWheel)
  expect(await state()).toEqual(before)
  // Changing timeframe while pointer remains pressed cannot resurrect old plan.
  g=await geometry()
  await page.mouse.move(box.x+g.x+35,box.y+g['data-handle-y']); await page.mouse.down()
  await page.mouse.move(box.x+g.x+55,box.y+g['data-handle-y']-10)
  await page.locator('.sf-timeframes').getByRole('button',{name:'H1',exact:true}).evaluate((el: HTMLButtonElement) => el.click())
  await expect(chart).toHaveAttribute('data-planner-side','none')
  await page.mouse.move(box.x+g.x+80,box.y+g['data-handle-y']-30); await page.mouse.up()
  await expect(chart).toHaveAttribute('data-planner-side','none')
  await expect(chart).not.toHaveClass(/planner-moving/)
  await page.getByRole('button',{name:'Plan SHORT',exact:true}).click()
  await chart.click({position:{x:box.width*.61,y:box.height*.52}})
  await expect(chart).toHaveAttribute('data-planner-side','short')
  before=await state(); g=await geometry()
  expect(before.sl).toBeGreaterThan(before.entry); expect(before.tp).toBeLessThan(before.entry)
  await drag(g.x+1,g['data-sl-y'],0,200)
  after=await state()
  expect(after.sl).toBeGreaterThan(after.entry)
  expect(after.tp).toBe(before.tp); expect(after.entry).toBe(before.entry)
  expect(after.start).toBe(before.start); expect(after.end).toBe(before.end)
  expect(pageErrors).toEqual([])
})

test('text deck keeps settings inline across reloads without module drawers',async({page})=>{
 const {pageErrors}=await prepareVisualPage(page)
 await page.goto('/');await unlockTextDeck(page)
 const deck=page.locator('.matrix-command-deck'),rsi=deck.getByRole('button',{name:'RSI',exact:true})
 await rsi.click();await deck.getByRole('spinbutton',{name:'Okres RSI'}).fill('9')
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await page.reload();await unlockTextDeck(page)
 await expect(rsi).toHaveAttribute('aria-pressed','true')
 await expect(deck.getByRole('spinbutton',{name:'Okres RSI'})).toHaveValue('9')
 await rsi.click();await expect(page.locator('.market-chart')).toHaveAttribute('data-indicator-pane-count','0')
 expect(pageErrors).toEqual([])
})

test('live history retains completed candles across successive MT5 bar opens', async ({ page }) => {
  const {pageErrors} = await prepareVisualPage(page)
  const initial = barsFor('XAUUSD')
  const finalTime = initial[initial.length-1].time
  let nextTime = finalTime
  await page.route('http://127.0.0.1:8765/v1/snapshot**', async route => {
    const tick = tickFor('XAUUSD')
    return fulfillJson(route,{source:'MT5',symbol:'XAUUSD',tick:{...tick,time:nextTime,time_msc:nextTime*1000},account:accountSnapshot(),symbol_info:symbolInfo('XAUUSD')})
  })
  await page.goto('/'); await unlockTextDeck(page)
  const chart = page.locator('.market-chart')
  await expect(chart).toHaveAttribute('data-live-bar-count','520')
  nextTime = finalTime+900
  await expect(chart).toHaveAttribute('data-live-bar-count','521')
  nextTime = finalTime+1800
  await expect(chart).toHaveAttribute('data-live-bar-count','522')
  await page.locator('.matrix-command-deck').getByRole('button',{name:'VWAP',exact:true}).click()
  await expect(chart).toHaveAttribute('data-indicator-series-count','1')
  await page.locator('.matrix-command-deck').getByRole('button',{name:'EMA 50',exact:true}).click()
  await expect(chart).toHaveAttribute('data-indicator-series-count','2')
  await page.locator('.sf-timeframes').getByRole('button',{name:'H1',exact:true}).click()
  await expect(chart).toHaveAttribute('data-live-bar-count','520')
  expect(pageErrors).toEqual([])
})

test('TP1, TP2 and TP3 buttons arm click-to-set chart placement', async ({ page }) => {
  test.setTimeout(30000)
  const {pageErrors} = await prepareVisualPage(page, [])
  await page.goto('/'); await unlockTextDeck(page)
  await expect(page.locator('.dragon-clock')).toContainText('MT5 LIVE')
  const chart = page.locator('.market-chart')
  const box = await chart.boundingBox()
  if (!box) throw new Error('Market chart is missing before TP placement.')
  await page.getByRole('button',{name:'Plan LONG',exact:true}).click()
  await chart.click({position:{x:box.width*.58,y:box.height*.52}})
  await expect(chart).toHaveAttribute('data-planner-side','long')

  const fullTpBeforeTargets = await chart.getAttribute('data-planner-tp')
  const getPrice = async (target: 'TP1' | 'TP2' | 'TP3') =>
    await page.locator(`[data-planner-target="${target.toLowerCase()}"]`).count()
      ? await page.locator(`[data-planner-target="${target.toLowerCase()}"]`).first().getAttribute('data-price')
      : null
  for (const [target, yRatio] of [['TP1',.39],['TP2',.29],['TP3',.19]] as const) {
    const button = page.locator('.matrix-command-deck').getByRole('button',{name:'Cel '+target,exact:true})
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed','true')
    await expect(chart).toHaveAttribute('data-planner-level-request',target.toLowerCase())
    await expect(page.locator('.market-chart__placement-banner')).toContainText(`${target} · KLIKNIJ WYKRES`)
    const before = await getPrice(target)
    if (target !== 'TP1' && !before) throw new Error(`${target} price is not available before placement.`)
    await chart.click({position:{x:box.width*.68,y:box.height*yRatio}})
    await expect(chart).toHaveAttribute('data-planner-level-request','none')
    await expect.poll(() => getPrice(target)).toBeTruthy()
    if (target !== 'TP1') await expect.poll(() => getPrice(target)).not.toBe(before)
    await expect(chart).toHaveAttribute('data-planner-tp', fullTpBeforeTargets!)
    await expect(chart).toHaveAttribute('data-planner-tp-label', 'FULL TP')
  }
  for (const level of ['full-tp', 'entry', 'sl', 'tp1', 'tp2', 'tp3']) {
    await expect(page.locator(`[data-planner-level-extension^="${level}-"]`)).toHaveCount(2)
  }
  await page.screenshot({path:output + '/matrix-crt-tp-controls.png'})
  expect(pageErrors).toEqual([])
})

test('text deck levels persist and the local model stays retired',async({page})=>{
 const {pageErrors}=await prepareVisualPage(page),writes:string[]=[]
 page.on('request',r=>{if(new URL(r.url()).port==='8765'&&r.method()!=='GET')writes.push(r.url())})
 await page.goto('/');await unlockTextDeck(page)
 const today=page.getByRole('button',{name:'DZIŚ · D-H / D-L',exact:true}), yesterday=page.getByRole('button',{name:'POPRZEDNI DZIEŃ · PDH / PDL',exact:true})
 await today.click();await yesterday.click()
 await expect(page.locator('.market-chart')).toHaveAttribute('data-reference-level-count','4')
 await page.reload();await unlockTextDeck(page)
 await expect(today).toHaveAttribute('aria-pressed','true');await expect(yesterday).toHaveAttribute('aria-pressed','true')
 await expect(page.locator('.dragon-agent-actions,.dragon-advice-glass')).toHaveCount(0)
 await expect(page.getByRole('button',{name:/ASK AGENT/})).toHaveCount(0)
 await expect(page.getByRole('dialog')).toHaveCount(0)
 expect(writes).toEqual([]);expect(pageErrors).toEqual([])
})
