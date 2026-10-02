import { MT5_BRIDGE_URL } from './mt5Client'

function bridgeRequest(path: string, init: RequestInit = {}) { return fetch(`${MT5_BRIDGE_URL}${path}`, {cache:'no-store', ...init, targetAddressSpace:'loopback'} as RequestInit) }

type Runtime = { instance: string; shutdown_token: string; closing: boolean }
// The bridge token belongs to this process and never enters persistent storage.
export async function stopMt5Bridge(options: { allowUnavailable?: boolean } = {}): Promise<void> {
  let runtimeResponse: Response
  try {
    runtimeResponse=await bridgeRequest('/v1/runtime',{cache:'no-store',signal:AbortSignal.timeout(5000)})
  } catch(error) {
    // A desktop app must still be closable if bootstrap failed before the bridge
    // opened its listener. HTTP/CORS responses remain errors and are not hidden.
    if(options.allowUnavailable && error instanceof TypeError)return
    throw error
  }
  if(!runtimeResponse.ok)throw new Error(`Bridge runtime HTTP ${runtimeResponse.status}. Uruchom aktualny most.`)
  const runtime=await runtimeResponse.json() as Runtime
  if(!runtime.instance||!runtime.shutdown_token)throw new Error('Most nie obsługuje zamykania terminalu.')
  const response=await bridgeRequest('/v1/shutdown',{method:'POST',headers:{'X-SmartFlow-Shutdown':runtime.shutdown_token},signal:AbortSignal.timeout(5000)})
  if(!response.ok)throw new Error(`Bridge shutdown HTTP ${response.status}`)
  const accepted=await response.json() as {accepted:boolean;instance:string}
  if(!accepted.accepted||accepted.instance!==runtime.instance)throw new Error('Most nie potwierdził żądania zamknięcia.')
  const deadline=Date.now()+10000
  while(Date.now()<deadline){
    await new Promise(resolve=>window.setTimeout(resolve,250))
    let state:Response
    try { state=await bridgeRequest('/v1/runtime',{cache:'no-store',signal:AbortSignal.timeout(1000)}) } catch(error) { if(error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)) continue; return }
    if(state.ok){const next=await state.json() as Runtime;if(next.instance!==runtime.instance)throw new Error('Uruchomiono nowy most podczas zamykania.')}
  }
  throw new Error('Most nadal działa. Zamknięcie nie zostało zakończone.')
}
