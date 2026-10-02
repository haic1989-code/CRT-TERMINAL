import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMt5BridgeReady } from './bridgeStartup'

afterEach(() => vi.unstubAllGlobals())

describe('startup bridge readiness', () => {
  it('requires a healthy read-only MT5 bridge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, read_only: true }))))
    await expect(isMt5BridgeReady()).resolves.toBe(true)
  })

  it('does not report a missing or incompatible bridge as ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, read_only: false }))))
    await expect(isMt5BridgeReady()).resolves.toBe(false)
  })
})
