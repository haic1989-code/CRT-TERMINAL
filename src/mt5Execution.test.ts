import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./bridgeEndpoint', () => ({
  bridgeFetch: vi.fn(),
  resolveBridgeEndpoint: vi.fn(),
}))

import { bridgeFetch, resolveBridgeEndpoint } from './bridgeEndpoint'
import { classifyPendingOrder, ExecutionBackendError, executionBackendError, executionStatus, isExecutionRequestNotFound, prepareExecution, readExecution, sendExecution } from './mt5Execution'

const endpoint = { url: 'http://127.0.0.1:54321', instance: 'instance-a', owner: 'owner-a', protocol_version: 5, execution_token: 'private-session-token' }

afterEach(() => vi.resetAllMocks())

describe('execution handshake diagnostics', () => {
  it('shows the backend error code and its actual hint', () => {
    expect(executionBackendError({ detail: { error: 'TRADING_DISABLED', hint: 'Sprawdź Algo Trading.' } }, 403))
      .toBe('Backend HTTP 403 · TRADING_DISABLED: Sprawdź Algo Trading.')
  })

  it('preserves string details and reports when the backend supplied no detail', () => {
    expect(executionBackendError({ detail: 'Terminal is not connected' }, 503)).toBe('Backend HTTP 503: Terminal is not connected')
    expect(executionBackendError({ detail: [{ loc: ['body', 'volume'], msg: 'Field required' }] }, 422)).toBe('Backend HTTP 422: body.volume: Field required')
    expect(executionBackendError(null, 502)).toBe('Backend zwrócił HTTP 502 bez czytelnego szczegółu.')
  })

  it('surfaces a backend handshake rejection through executionStatus', async () => {
    vi.mocked(resolveBridgeEndpoint).mockResolvedValue(endpoint)
    vi.mocked(bridgeFetch).mockResolvedValue(new Response(JSON.stringify({ detail: { error: 'EXECUTION_TOKEN_INVALID', hint: 'Sesja mostu wygasła.' } }), { status: 403 }))
    await expect(executionStatus()).rejects.toThrow('Backend HTTP 403 · EXECUTION_TOKEN_INVALID: Sesja mostu wygasła.')
  })

  it('types a missing journal request so orphan recovery cannot rely on display-text parsing', async () => {
    vi.mocked(resolveBridgeEndpoint).mockResolvedValue(endpoint)
    vi.mocked(bridgeFetch).mockResolvedValue(new Response(JSON.stringify({ detail: { error: 'REQUEST_NOT_FOUND', hint: 'Nie znalazłam tego zlecenia w dzienniku. Niczego nie ponawiam.' } }), { status: 404 }))
    const error = await readExecution('orphaned-local-id').catch(value => value)
    expect(error).toBeInstanceOf(ExecutionBackendError)
    expect(error).toMatchObject({ status: 404, code: 'REQUEST_NOT_FOUND' })
    expect(isExecutionRequestNotFound(error)).toBe(true)
    expect(isExecutionRequestNotFound(new ExecutionBackendError('other missing resource', 404, 'OTHER'))).toBe(false)
  })

  it('keeps a concrete bridge protocol failure instead of relabeling it as unavailable', async () => {
    vi.mocked(resolveBridgeEndpoint).mockResolvedValue(endpoint)
    vi.mocked(bridgeFetch).mockRejectedValue(new Error('Nie potwierdziłam wersji i sesji mostu MT5. Uruchom ponownie aktualny terminal.'))
    await expect(executionStatus()).rejects.toThrow('Nie potwierdziłam wersji i sesji mostu MT5.')
  })

  it('keeps ambiguous transport failures explicit without implying an order was sent', async () => {
    vi.mocked(resolveBridgeEndpoint).mockResolvedValue(endpoint)
    vi.mocked(bridgeFetch).mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(executionStatus()).rejects.toThrow('Transport mostu MT5: Failed to fetch')
  })
})


describe('pending order classification', () => {
  const bid = 100
  const ask = 101

  it.each([
    ['buy', 100.5, 'buy_limit'],
    ['buy', 101.5, 'buy_stop'],
    ['sell', 101.5, 'sell_limit'],
    ['sell', 99.5, 'sell_stop'],
  ] as const)('%s entry %s classifies as %s', (side, entry, kind) => {
    expect(classifyPendingOrder(side, entry, bid, ask)).toBe(kind)
  })

  it('keeps the preview unavailable for an equal or invalid price without authorizing execution', () => {
    expect(classifyPendingOrder('buy', ask, bid, ask)).toBeNull()
    expect(classifyPendingOrder('sell', bid, bid, ask)).toBeNull()
    expect(classifyPendingOrder('buy', Number.NaN, bid, ask)).toBeNull()
    expect(classifyPendingOrder('buy', 100, 0, ask)).toBeNull()
    expect(classifyPendingOrder('sell', 100, bid, bid - 1)).toBeNull()
  })
})

describe('backend execution authority', () => {
  const account = { login: 1, server: 'Demo', terminal: 'MT5' }
  const record = { clientRequestId: 'request-a', state: 'PREPARED', kind: 'buy_stop', account,
    confirmationToken: 'confirmed-plan', expiresAt: 1,
    request: { symbol: 'XAUUSD', volume: .01, type: 4, price: 101.5, sl: 100, tp: 103, deviation: 20 },
    risk: { loss: 1, riskPercent: .01, margin: 1, currency: 'USD' }, message: 'BUY STOP' }

  it('submits pending intent without a client quote, clock or final type and returns the backend type', async () => {
    vi.mocked(resolveBridgeEndpoint).mockResolvedValue(endpoint)
    vi.mocked(bridgeFetch).mockResolvedValue(new Response(JSON.stringify(record)))
    const plan = { clientRequestId: 'request-a', accountLogin: 1, accountServer: 'Demo', symbol: 'XAUUSD',
      side: 'buy' as const, kind: 'pending' as const, volume: .01, entry: 101.5, sl: 100, tp: 103, deviationPoints: 20 }
    const prepared = await prepareExecution(plan)
    expect(prepared.kind).toBe('buy_stop')
    expect(JSON.parse(String(vi.mocked(bridgeFetch).mock.calls[0][1]?.body))).toEqual(plan)
    expect(vi.mocked(bridgeFetch).mock.calls[0][1]?.headers).toMatchObject({ 'X-CRT-Execution': endpoint.execution_token })
    vi.mocked(bridgeFetch).mockResolvedValue(new Response(JSON.stringify({ ...record, kind: 'buy_limit', request: { ...record.request, type: 2 }, state: 'RECONCILED' })))
    const result = await sendExecution(prepared)
    expect(result.kind).toBe('buy_limit')
    expect(JSON.parse(String(vi.mocked(bridgeFetch).mock.calls[1][1]?.body))).toEqual({
      clientRequestId: prepared.clientRequestId, confirmationToken: prepared.confirmationToken,
    })
  })

  it('rejects an unowned or unauthenticated bridge before issuing any execution request', async () => {
    for (const invalid of [{ ...endpoint, owner: 'manual' }, { ...endpoint, execution_token: '' }]) {
      vi.mocked(resolveBridgeEndpoint).mockResolvedValue(invalid)
      await expect(executionStatus()).rejects.toThrow('własnego mostu MT5')
    }
    expect(bridgeFetch).not.toHaveBeenCalled()
  })
})
