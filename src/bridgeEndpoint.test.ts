import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }))

import { invoke } from '@tauri-apps/api/core'
import { BRIDGE_PROTOCOL_VERSION, bridgeFetch } from './bridgeEndpoint'

afterEach(() => vi.unstubAllGlobals())

describe('execution bridge handshake', () => {
  it('fails closed and identifies an incompatible bridge protocol', async () => {
    vi.mocked(invoke).mockResolvedValue({
      url: 'http://127.0.0.1:54321', instance: 'instance-a', owner: 'owner-a',
      protocol_version: BRIDGE_PROTOCOL_VERSION, execution_token: 'private-session-token',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'X-CRT-Protocol': String(BRIDGE_PROTOCOL_VERSION - 1), 'X-CRT-Instance': 'instance-a' },
    })))

    await expect(bridgeFetch('/v1/execution/status'))
      .rejects.toThrow('Nie potwierdziłam wersji i sesji mostu MT5.')
  })
})
