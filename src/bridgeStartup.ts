import { MT5_BRIDGE_URL } from './mt5Client'

export async function isMt5BridgeReady(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${MT5_BRIDGE_URL}/v1/health`, {
      cache: 'no-store',
      signal: signal ?? AbortSignal.timeout(2500),
      targetAddressSpace: 'loopback',
    } as RequestInit)
    if (!response.ok) return false
    const payload = await response.json() as { ok?: boolean; read_only?: boolean }
    return payload.ok === true && payload.read_only === true
  } catch {
    return false
  }
}
