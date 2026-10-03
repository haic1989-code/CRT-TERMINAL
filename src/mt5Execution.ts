import { bridgeFetch, resolveBridgeEndpoint } from './bridgeEndpoint'

export type ExecutionState = 'PREPARED' | 'INTENT' | 'SUBMITTING' | 'ACKNOWLEDGED' | 'UNKNOWN' | 'REJECTED' | 'RECONCILED'
export type ExecutionRecord = {
  clientRequestId: string; state: ExecutionState; confirmationToken: string; expiresAt: number; kind: 'market' | 'pending'
  account: { login: number; server: string; terminal: string }
  request: { symbol: string; volume: number; type: number; price: number; sl: number; tp: number; deviation: number }
  risk: { loss: number; riskPercent: number; margin: number; currency: string }
  message: string; result?: { retcode?: number; order?: number; deal?: number; filledVolume?: number }
}
export type ExecutionStatus = { mode: 'DEMO_ONLY'; enabled: boolean; reason?: string; account: ExecutionRecord['account']; unresolved: Array<{ clientRequestId: string; state: ExecutionState }> }
export type ExecutionPlan = {
  clientRequestId: string; accountLogin: number; accountServer: string; symbol: string; side: 'buy' | 'sell'
  kind: 'market' | 'pending'; volume: number; entry: number; sl: number; tp: number; quote: number; deviationPoints: number
}
async function call<T>(path: string, body?: unknown): Promise<T> {
  const endpoint = await resolveBridgeEndpoint()
  if (!endpoint.execution_token || !endpoint.instance || endpoint.owner === 'manual') throw new Error('Mogę wysyłać zlecenia tylko z zainstalowanego terminalu i jego własnego mostu MT5.')
  let response: Response
  try { response = await bridgeFetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-CRT-Instance': endpoint.instance, 'X-CRT-Execution': endpoint.execution_token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) } catch { throw new Error('Straciłam połączenie z mostem. Sprawdzę zapisany wynik, bez ponawiania wysyłki.') }
  let data
  try { data = await response.json() } catch { throw new Error('Nie rozpoznałam odpowiedzi mostu. Nie traktuję jej jako potwierdzenia zlecenia.') }
  if (!response.ok) throw new Error(data?.detail?.hint || 'Nie mogę potwierdzić odpowiedzi mostu. Sprawdźmy stan zlecenia przed dalszą pracą.')
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  const accountValid = data?.account && finite(data.account.login) && typeof data.account.server === 'string' && typeof data.account.terminal === 'string'
  const valid = path.endsWith('/status')
    ? data?.mode === 'DEMO_ONLY' && typeof data.enabled === 'boolean' && accountValid && Array.isArray(data.unresolved) && data.unresolved.every((item: { clientRequestId?: unknown }) => typeof item.clientRequestId === 'string')
    : accountValid && typeof data.clientRequestId === 'string' && typeof data.confirmationToken === 'string' && finite(data.expiresAt)
      && ['PREPARED', 'INTENT', 'SUBMITTING', 'ACKNOWLEDGED', 'UNKNOWN', 'REJECTED', 'RECONCILED'].includes(data.state)
      && ['market', 'pending'].includes(data.kind) && typeof data.message === 'string' && typeof data.request?.symbol === 'string'
      && ['volume', 'type', 'price', 'sl', 'tp', 'deviation'].every(field => finite(data.request?.[field]))
      && ['loss', 'riskPercent', 'margin'].every(field => finite(data.risk?.[field])) && typeof data.risk?.currency === 'string'
  if (!valid) throw new Error('Odpowiedź mostu jest niekompletna. Nie potwierdzam wysyłki; sprawdźmy dziennik MT5.')
  return data as T
}
export const executionStatus = () => call<ExecutionStatus>('/v1/execution/status')
export const prepareExecution = (plan: ExecutionPlan) => call<ExecutionRecord>('/v1/execution/prepare', plan)
export const sendExecution = (record: ExecutionRecord) => call<ExecutionRecord>('/v1/execution/execute', { clientRequestId: record.clientRequestId, confirmationToken: record.confirmationToken })
export const readExecution = (id: string) => call<ExecutionRecord>(`/v1/execution/requests/${encodeURIComponent(id)}`)
export const unresolvedExecution = (record: ExecutionRecord) => ['INTENT', 'SUBMITTING', 'ACKNOWLEDGED', 'UNKNOWN'].includes(record.state)
