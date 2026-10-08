import { expect, test, type Page } from '@playwright/test'

type Scenario = {
  side?: 'buy' | 'sell'; entry?: number; kind?: string; finalKind?: string
  uncertain?: boolean; rejection?: string; pausePrepare?: Promise<void>; query?: string; owned?: boolean
}
async function fixture(page: Page, scenario: Scenario = {}) {
  const identity = { login: 1, server: 'Demo', terminal: 'MT5' }
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  let record: Record<string, unknown> | undefined
  await page.addInitScript(({ owned }) => {
    Object.defineProperty(window, 'isTauri', { value: owned })
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string) => {
        if (command !== 'read_bridge_endpoint') throw new Error('Unexpected IPC')
        return { url: 'http://127.0.0.1:5173', owner: 'fixture-owner', instance: 'fixture-instance',
          protocol_version: 5, execution_token: 'mock-token' }
      },
    } })
  }, { owned: scenario.owned !== false })
  await page.route('**/v1/execution/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() as Record<string, unknown> : {}
    calls.push({ path, body })
    const reply = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'X-CRT-Protocol': '5', 'X-CRT-Instance': 'fixture-instance' }, body: JSON.stringify(value) })
    if (path.endsWith('/status')) return reply({ mode: 'DEMO_ONLY',
      enabled: record?.state !== 'UNKNOWN', account: identity,
      unresolved: record?.state === 'UNKNOWN' ? [{ clientRequestId: record.clientRequestId, state: 'UNKNOWN' }] : [] })
    if (path.endsWith('/prepare')) {
      expect(route.request().headers()['x-crt-execution']).toBe('mock-token')
      expect(body.kind).toBe('pending')
      expect(body).not.toHaveProperty('quote')
      expect(body).not.toHaveProperty('lastTickAt')
      expect(body).not.toHaveProperty('quoteAgeMs')
      await scenario.pausePrepare
      if (scenario.rejection) return reply({ detail: { error: scenario.rejection, hint: 'MT5 preflight rejected this plan.' } }, 409)
      const kind = scenario.kind || 'buy_limit'
      const types: Record<string, number> = { buy_limit: 2, sell_limit: 3, buy_stop: 4, sell_stop: 5 }
      record = { clientRequestId: body.clientRequestId, state: 'PREPARED', kind,
        account: identity, confirmationToken: 'mock-confirmation', expiresAt: 1,
        request: { symbol: body.symbol, type: types[kind], price: body.entry,
          volume: body.volume, sl: body.sl, tp: body.tp, deviation: 20 },
        risk: { loss: 1, riskPercent: .01, margin: 1, currency: 'USD' }, message: 'Backend plan checked.' }
      return reply(record)
    }
    if (path.endsWith('/execute')) {
      expect(body).toEqual({ clientRequestId: record?.clientRequestId, confirmationToken: 'mock-confirmation' })
      const finalKind = scenario.finalKind || String(record?.kind)
      const finalTypes: Record<string, number> = { buy_limit: 2, sell_limit: 3, buy_stop: 4, sell_stop: 5 }
      record = { ...record, kind: finalKind,
        request: { ...(record?.request as Record<string, unknown>), type: finalTypes[finalKind] },
        state: scenario.uncertain ? 'UNKNOWN' : 'RECONCILED',
        message: scenario.uncertain ? 'Nie ponawiam wysyłki.' : 'Uzgodniono wynik.' }
      return reply(record)
    }
    if (path.includes('/requests/')) {
      if (record) return reply(record)
      return reply({ detail: { error: 'REQUEST_NOT_FOUND', hint: 'Missing request.' } }, 404)
    }
    return route.abort()
  })
  await page.goto('/visual-tests/fixtures/demo-execution.html?' + new URLSearchParams({
    side: scenario.side || 'buy', entry: String(scenario.entry ?? 100),
  }) + (scenario.query || ''))
  return calls
}
const send = (page: Page) => page.getByRole('button', { name: 'Potwierdź pozycję · wyślij DEMO', exact: true })
const count = (calls: Array<{ path: string }>, suffix: string) => calls.filter(call => call.path.endsWith(suffix)).length

for (const [side, entry, kind] of [
  ['buy', 100, 'buy_limit'], ['buy', 101, 'buy_stop'],
  ['sell', 100, 'sell_limit'], ['sell', 99, 'sell_stop'],
] as const) {
  test(kind + ': explicit confirmation uses backend authority even with stale UI telemetry', async ({ page }) => {
    const calls = await fixture(page, { side, entry, kind })
    await expect(send(page)).toBeEnabled()
    expect(count(calls, '/prepare')).toBe(0)
    expect(count(calls, '/execute')).toBe(0)
    await send(page).click()
    await expect(page.getByLabel('Wynik')).toContainText('Uzgodniono wynik.')
    await expect(page.locator('.execution-review strong')).toContainText(kind.toUpperCase().replace('_', ' ') + ' · MT5')
    expect(count(calls, '/prepare')).toBe(1)
    expect(count(calls, '/execute')).toBe(1)
  })
}

test('backend final type replaces the frontend preview and double click sends only once', async ({ page }) => {
  let release!: () => void
  const pausePrepare = new Promise<void>(resolve => { release = resolve })
  const calls = await fixture(page, { kind: 'buy_limit', finalKind: 'buy_stop', pausePrepare })
  await expect(page.locator('.execution-review strong')).toContainText('BUY LIMIT · PODGLĄD')
  await expect(send(page)).toBeEnabled()
  await send(page).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect.poll(() => count(calls, '/prepare')).toBe(1)
  release()
  await expect(page.getByLabel('Wynik')).toContainText('Uzgodniono wynik.')
  await expect(page.locator('.execution-review strong')).toContainText('BUY STOP · MT5')
  await expect(page.getByLabel('Wynik')).toContainText('BUY STOP · Uzgodniono wynik.')
  expect(count(calls, '/execute')).toBe(1)
})

test('an uncertain send remains locked after recovery and never resends', async ({ page }) => {
  const calls = await fixture(page, { uncertain: true })
  await expect(send(page)).toBeEnabled()
  await send(page).click()
  await expect(page.getByRole('button', { name: 'Sprawdź wynik w MT5' })).toBeVisible()
  await expect(send(page)).toBeDisabled()
  await page.reload()
  await expect(send(page)).toBeDisabled()
  await page.getByRole('button', { name: 'Sprawdź wynik w MT5' }).click()
  await expect(page.locator('.luna-trade-confirm')).toContainText('Nie ponawiam wysyłki.')
  expect(count(calls, '/prepare')).toBe(1)
  expect(count(calls, '/execute')).toBe(1)
})

test('a changed Planner during prepare requires another explicit confirmation', async ({ page }) => {
  let release!: () => void
  const pausePrepare = new Promise<void>(resolve => { release = resolve })
  const calls = await fixture(page, { pausePrepare })
  await expect(send(page)).toBeEnabled()
  await send(page).click()
  await expect.poll(() => count(calls, '/prepare')).toBe(1)
  await page.getByRole('button', { name: 'Przesuń Planner' }).click()
  release()
  await expect(page.locator('.luna-trade-confirm')).toContainText('Plan zmienił się podczas kontroli')
  expect(count(calls, '/execute')).toBe(0)
})

for (const rejection of ['STALE_QUOTE', 'QUOTE_UNAVAILABLE', 'QUOTE_INVALID', 'PENDING_AT_QUOTE']) {
  test(rejection + ': backend rejection is shown and never calls execute', async ({ page }) => {
    const calls = await fixture(page, { rejection })
    await expect(send(page)).toBeEnabled()
    await send(page).click()
    await expect(page.locator('.execution-luna[role="status"]')).toContainText(rejection)
    expect(count(calls, '/execute')).toBe(0)
  })
}

for (const query of ['&noPlanner', '&noVolume', '&noAccount']) {
  test(query + ': missing required input stays blocked', async ({ page }) => {
    const calls = await fixture(page, { query })
    if (query === '&noPlanner') await expect(send(page)).toHaveCount(0)
    else await expect(send(page)).toBeDisabled()
    expect(count(calls, '/prepare')).toBe(0)
  })
}
test('an unowned bridge stays blocked', async ({ page }) => {
  const calls = await fixture(page, { owned: false })
  await expect(send(page)).toBeDisabled()
  await expect(page.locator('.luna-trade-confirm')).toContainText('własnego mostu MT5')
  expect(count(calls, '/prepare')).toBe(0)
})

test('an authorized backend supplies a tick even when the chart cache has no quote', async ({ page }) => {
  const calls = await fixture(page, { query: '&noQuote&feedError', kind: 'buy_stop' })
  await expect(page.locator('.execution-review strong')).toContainText('TYP USTALI MT5')
  await expect(send(page)).toBeEnabled()
  await send(page).click()
  await expect(page.getByLabel('Wynik')).toContainText('BUY STOP')
  expect(count(calls, '/execute')).toBe(1)
})
