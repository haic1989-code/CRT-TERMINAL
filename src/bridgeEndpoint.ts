export const BRIDGE_PROTOCOL_VERSION = 5
export const BRIDGE_ID = 'CRT_TERMINAL_MT5'
type Endpoint = { url: string; instance: string; owner: string; protocol_version: number; execution_token?: string }
let endpoint: Endpoint | undefined

export async function resolveBridgeEndpoint(): Promise<Endpoint> {
  const { isTauri, invoke } = await import('@tauri-apps/api/core')
  if (!isTauri()) {
    return { url: (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || 'http://127.0.0.1:8765', instance: '', owner: 'manual', protocol_version: BRIDGE_PROTOCOL_VERSION }
  }
  if (endpoint) return endpoint
  const value = await invoke<Endpoint>('read_bridge_endpoint')
  if (value.protocol_version !== BRIDGE_PROTOCOL_VERSION || !value.owner || !value.instance || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.url)) {
    throw new Error('Nie rozpoznałam własnego mostu MT5.')
  }
  endpoint = value
  return value
}

export async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const endpoint = await resolveBridgeEndpoint()
  const response = await fetch(`${endpoint.url}${path}`, {
    cache: 'no-store', ...init,
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    targetAddressSpace: 'loopback',
  } as RequestInit)
  if (response.headers.get('X-CRT-Protocol') !== String(BRIDGE_PROTOCOL_VERSION)
    || (endpoint.instance && response.headers.get('X-CRT-Instance') !== endpoint.instance)) {
    throw new Error('Nie potwierdziłam wersji i sesji mostu MT5. Uruchom ponownie aktualny terminal.')
  }
  return response
}
