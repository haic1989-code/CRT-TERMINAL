import { bridgeFetch, resolveBridgeEndpoint } from './bridgeEndpoint'

export type ExecutionState = 'PREPARED' | 'INTENT' | 'SUBMITTING' | 'ACKNOWLEDGED' | 'UNKNOWN' | 'REJECTED' | 'RECONCILED'
export type ExecutionRecord = {
  clientRequestId: string; state: ExecutionState; confirmationToken: string; expiresAt: number; kind: 'market' | PendingExecutionKind | 'pending'
  account: { login: number; server: string; terminal: string }
  request: { symbol: string; volume: number; type: number; price: number; sl: number; tp: number; deviation: number }
  risk: { loss: number; riskPercent: number; margin: number; currency: string }
  message: string; result?: { retcode?: number; order?: number; deal?: number; filledVolume?: number }
}
export type ExecutionStatus = { mode: 'DEMO_ONLY'; enabled: boolean; reason?: string; account: ExecutionRecord['account']; unresolved: Array<{ clientRequestId: string; state: ExecutionState }> }
export type PendingExecutionKind = 'buy_limit' | 'buy_stop' | 'sell_limit' | 'sell_stop'
/** Display preview only. MT5 preflight owns the final type and freshness decision. */
export function classifyPendingOrder(side: 'buy' | 'sell', entry: number, bid: number, ask: number): PendingExecutionKind | null {
  if (![entry, bid, ask].every(Number.isFinite) || bid <= 0 || ask < bid) return null
  if (side === 'buy') return entry < ask ? 'buy_limit' : entry > ask ? 'buy_stop' : null
  return entry > bid ? 'sell_limit' : entry < bid ? 'sell_stop' : null
}

export type ExecutionPlan = {
  clientRequestId: string; accountLogin: number; accountServer: string; symbol: string; side: 'buy' | 'sell'
  kind: 'market' | 'pending'; volume: number; entry: number; sl: number; tp: number; deviationPoints: number
}

type ErrorPayload = { detail?: unknown; error?: unknown; hint?: unknown; message?: unknown }
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export class ExecutionBackendError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ExecutionBackendError'
    this.status = status
    this.code = code
  }
}

function executionBackendCode(payload: unknown): string | undefined {
  const root = isObject(payload) ? payload as ErrorPayload : undefined
  const detail = root && 'detail' in root ? root.detail : payload
  if (isObject(detail) && typeof detail.error === 'string' && detail.error.trim()) return detail.error.trim()
  if (root && typeof root.error === 'string' && root.error.trim()) return root.error.trim()
  return undefined
}

export function isExecutionRequestNotFound(error: unknown): boolean {
  return error instanceof ExecutionBackendError && error.status === 404 && error.code === 'REQUEST_NOT_FOUND'
}

/** Keep the bridge's actual diagnostic visible while retaining the HTTP status. */
export function executionBackendError(payload: unknown, status: number): string {
  const root = isObject(payload) ? payload as ErrorPayload : undefined
  const detail = root && 'detail' in root ? root.detail : payload
  if (typeof detail === 'string' && detail.trim()) return `Backend HTTP ${status}: ${detail.trim()}`
  if (Array.isArray(detail)) {
    const problems = detail.slice(0, 5).map(item => {
      if (!isObject(item)) return ''
      const location = Array.isArray(item.loc) ? item.loc.map(String).join('.') : ''
      const message = typeof item.msg === 'string' ? item.msg : ''
      return [location, message].filter(Boolean).join(': ')
    }).filter(Boolean)
    if (problems.length) return `Backend HTTP ${status}: ${problems.join(' · ')}`
  }
  if (isObject(detail)) {
    const code = typeof detail.error === 'string' && detail.error.trim() ? detail.error.trim() : ''
    const hint = typeof detail.hint === 'string' && detail.hint.trim() ? detail.hint.trim() : ''
    const backendMessage = typeof detail.message === 'string' && detail.message.trim() ? detail.message.trim() : ''
    const explanation = hint || backendMessage
    if (code || explanation) return `Backend HTTP ${status}${code ? ` · ${code}` : ''}${explanation ? `: ${explanation}` : ''}`
  }
  if (root) {
    const code = typeof root.error === 'string' && root.error.trim() ? root.error.trim() : ''
    const explanation = typeof root.hint === 'string' && root.hint.trim() ? root.hint.trim()
      : typeof root.message === 'string' && root.message.trim() ? root.message.trim() : ''
    if (code || explanation) return `Backend HTTP ${status}${code ? ` · ${code}` : ''}${explanation ? `: ${explanation}` : ''}`
  }
  return `Backend zwrócił HTTP ${status} bez czytelnego szczegółu.`
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const endpoint = await resolveBridgeEndpoint()
  if (!endpoint.execution_token || !endpoint.instance || endpoint.owner === 'manual') throw new Error('Mogę wysyłać zlecenia tylko z zainstalowanego terminalu i jego własnego mostu MT5.')
  let response: Response
  try { response = await bridgeFetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-CRT-Instance': endpoint.instance, 'X-CRT-Execution': endpoint.execution_token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) } catch (error) {
    if (error instanceof Error && error.message.trim()) {
      if (error.name === 'TypeError') throw new Error(`Transport mostu MT5: ${error.message}`)
      throw error
    }
    throw new Error('Transport mostu MT5 przerwał się bez szczegółu. Sprawdźmy zapisany wynik, bez ponawiania wysyłki.')
  }
  let data: unknown
  try {
    const raw = await response.text()
    data = raw ? JSON.parse(raw) : null
  } catch {
    if (!response.ok) throw new Error(`Backend HTTP ${response.status}: odpowiedź nie zawiera poprawnego JSON.`)
    throw new Error('Odpowiedź mostu nie zawiera poprawnego JSON. Nie traktuję jej jako potwierdzenia zlecenia.')
  }
  if (!response.ok) throw new ExecutionBackendError(executionBackendError(data, response.status), response.status, executionBackendCode(data))
  if (!isObject(data)) throw new Error('Odpowiedź mostu jest niekompletna. Nie potwierdzam wysyłki; sprawdźmy dziennik MT5.')
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  const account = data.account
  const request = data.request
  const risk = data.risk
  const accountValid = isObject(account) && finite(account.login) && typeof account.server === 'string' && typeof account.terminal === 'string'
  const valid = path.endsWith('/status')
    ? data.mode === 'DEMO_ONLY' && typeof data.enabled === 'boolean' && accountValid && Array.isArray(data.unresolved) && data.unresolved.every(item => isObject(item) && typeof item.clientRequestId === 'string')
    : accountValid && typeof data.clientRequestId === 'string' && typeof data.confirmationToken === 'string' && finite(data.expiresAt)
      && typeof data.state === 'string' && ['PREPARED', 'INTENT', 'SUBMITTING', 'ACKNOWLEDGED', 'UNKNOWN', 'REJECTED', 'RECONCILED'].includes(data.state)
      && typeof data.kind === 'string' && ['market', 'buy_limit', 'buy_stop', 'sell_limit', 'sell_stop', 'pending'].includes(data.kind) && typeof data.message === 'string' && isObject(request) && typeof request.symbol === 'string'
      && ['volume', 'type', 'price', 'sl', 'tp', 'deviation'].every(field => finite(request[field]))
      && isObject(risk) && ['loss', 'riskPercent', 'margin'].every(field => finite(risk[field])) && typeof risk.currency === 'string'
  if (!valid) throw new Error('Odpowiedź mostu jest niekompletna. Nie potwierdzam wysyłki; sprawdźmy dziennik MT5.')
  return data as T
}
export const executionStatus = () => call<ExecutionStatus>('/v1/execution/status')
export const prepareExecution = (plan: ExecutionPlan) => call<ExecutionRecord>('/v1/execution/prepare', plan)
export const sendExecution = (record: ExecutionRecord) => call<ExecutionRecord>('/v1/execution/execute', { clientRequestId: record.clientRequestId, confirmationToken: record.confirmationToken })
export const readExecution = (id: string) => call<ExecutionRecord>(`/v1/execution/requests/${encodeURIComponent(id)}`)
export const unresolvedExecution = (record: ExecutionRecord) => ['INTENT', 'SUBMITTING', 'ACKNOWLEDGED', 'UNKNOWN'].includes(record.state)
