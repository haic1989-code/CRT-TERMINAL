import { afterEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_ID, BRIDGE_PROTOCOL_VERSION } from './bridgeEndpoint'
import { isMt5BridgeReady } from './bridgeStartup'

afterEach(() => vi.unstubAllGlobals())

const health = { ok: true, read_only: true, bridge: BRIDGE_ID, protocol_version: BRIDGE_PROTOCOL_VERSION, instance: 'instance-a', owner: 'owner-a', terminal: { connected: true } }
const healthResponse = (payload: typeof health) => new Response(JSON.stringify(payload), { headers: { 'X-CRT-Protocol': String(BRIDGE_PROTOCOL_VERSION), 'X-CRT-Instance': payload.instance } })

describe('startup bridge readiness', () => {
  it('requires a healthy read-only MT5 bridge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse(health)))
    await expect(isMt5BridgeReady()).resolves.toBe(true)
  })

  it('does not report a missing or incompatible bridge as ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse({ ...health, read_only: false })) )
    await expect(isMt5BridgeReady()).resolves.toBe(false)
  })
})
