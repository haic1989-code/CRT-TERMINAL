import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./bridgeEndpoint', () => ({
  bridgeFetch: vi.fn(),
  resolveBridgeEndpoint: vi.fn(),
}))

import { bridgeFetch, resolveBridgeEndpoint } from './bridgeEndpoint'
import { classifyPendingOrder, ExecutionBackendError, executionBackendError, executionStatus, isExecutionRequestNotFound, isFreshExecutionQuote, readExecution } from './mt5Execution'

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

  it('fails closed at the quote, with invalid prices, or without a fresh live Bid/Ask', () => {
    expect(classifyPendingOrder('buy', ask, bid, ask)).toBeNull()
    expect(classifyPendingOrder('sell', bid, bid, ask)).toBeNull()
    expect(classifyPendingOrder('buy', Number.NaN, bid, ask)).toBeNull()
    expect(isFreshExecutionQuote({ status: 'stale', lastTickAt: 1000, bid, ask }, 1000)).toBe(false)
    expect(isFreshExecutionQuote({ status: 'live', lastTickAt: 0, bid, ask }, 16001)).toBe(false)
    expect(isFreshExecutionQuote({ status: 'live', lastTickAt: 1000, bid: undefined, ask }, 1000)).toBe(false)
  })
})
