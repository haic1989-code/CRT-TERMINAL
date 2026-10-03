import { bridgeFetch, resolveBridgeEndpoint, BRIDGE_ID, BRIDGE_PROTOCOL_VERSION } from './bridgeEndpoint'

export async function readMt5BridgeReadiness(signal?: AbortSignal): Promise<{ ready: boolean; message: string }> {
  try {
    const endpoint = await resolveBridgeEndpoint()
    const response = await bridgeFetch('/v1/health', {
      cache: 'no-store',
      signal: signal ?? AbortSignal.timeout(2500),
      targetAddressSpace: 'loopback',
    } as RequestInit)
    if (!response.ok) {
      const error = await response.json() as { detail?: { hint?: string; error?: string } }
      return { ready: false, message: error.detail?.hint || error.detail?.error || `Most MT5: HTTP ${response.status}` }
    }
    const payload = await response.json() as { ok?: boolean; read_only?: boolean; execution_mode?: string; bridge?: string; protocol_version?: number; instance?: string; owner?: string; terminal?: { connected?: boolean } }
    const ready = payload.ok === true && (payload.read_only === true || payload.execution_mode === 'DEMO_ONLY') && payload.bridge === BRIDGE_ID
      && payload.protocol_version === BRIDGE_PROTOCOL_VERSION && payload.terminal?.connected === true
      && (!endpoint.instance || (payload.instance === endpoint.instance && payload.owner === endpoint.owner))
    return { ready, message: ready ? '' : 'Nie potwierdziłam zgodnej sesji mostu i połączenia z brokerem.' }
  } catch (error) {
    return { ready: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function isMt5BridgeReady(signal?: AbortSignal): Promise<boolean> {
  return (await readMt5BridgeReadiness(signal)).ready
}
