import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./bridgeEndpoint', () => ({
  bridgeFetch: vi.fn(),
  resolveBridgeEndpoint: vi.fn(),
}))

import { bridgeFetch, resolveBridgeEndpoint } from './bridgeEndpoint'
import { executionBackendError, executionStatus } from './mt5Execution'

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
