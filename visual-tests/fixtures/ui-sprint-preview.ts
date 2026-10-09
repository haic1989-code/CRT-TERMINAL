import { laboratory } from '../support/replay-fixture'
import type { Route } from '@playwright/test'
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (url.port !== '8765') return originalFetch(input, options)
  // Only this isolated preview page intercepts bridge requests; no real MT5 writes.
  let response: Response | undefined
  const request = { url: () => url.href, method: () => options?.method || 'GET' }
  await laboratory({ request: () => request, fulfill: async (data: { body: string; status?: number; headers?: Record<string,string>; contentType?: string }) => {
    response = new Response(data.body, { status: data.status || 200, headers: { 'Content-Type': data.contentType || 'application/json', ...data.headers } })
  } } as unknown as Route)
  return response || new Response('{"detail":"Unsupported preview request"}', { status: 404 })
}
await import('../../src/main')
const banner = document.createElement('div')
banner.textContent = 'PODGLĄD UI · DANE TESTOWE · BRAK POŁĄCZENIA Z MT5'
banner.style.cssText = 'position:fixed;bottom:6px;left:12px;z-index:2000;color:#e4c58b;background:#06100eee;padding:5px 8px;font:10px Consolas,monospace;border:1px solid #39726066;pointer-events:none'
document.body.append(banner)
