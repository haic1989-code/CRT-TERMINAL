// Browser fixture for the real panel/transport. All MT5 responses are intercepted by Playwright.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DemoExecutionPanel } from '../../src/DemoExecutionPanel'
import type { MarketFeedState, PlannerSnapshot } from '../../src/MarketChart'

const query = new URLSearchParams(location.search)
const side = query.get('side') === 'sell' ? 'short' : 'long'
const entry = Number(query.get('entry') || 100)
const account = { login: 1, server: 'Demo', name: 'Fixture', company: 'Fixture', currency: 'USD',
  leverage: 100, balance: 10000, equity: 10000, profit: 0, margin: 0, margin_free: 10000,
  margin_level: null, trade_allowed: true, trade_expert: true, margin_mode: 0, trade_mode: 0 }
const feed: MarketFeedState = { source: 'MT5', mode: 'local', status: query.has('feedError') ? 'error' : 'stale',
  lastTickAt: 1, quoteAgeMs: 9000000, symbol: 'XAUUSD.a',
  account: query.has('noAccount') ? undefined : account,
  bid: query.has('noQuote') ? undefined : 99.5, ask: query.has('noQuote') ? undefined : 100.5,
  marketSession: { available: false, quote_open: null, trade_open: null, state: 'unknown' } }

function Harness() {
  const [planner, setPlanner] = useState<PlannerSnapshot | null>(query.has('noPlanner') ? null : {
    side, entry, sl: side === 'long' ? entry - 1 : entry + 1,
    tp: side === 'long' ? entry + 2 : entry - 2, lots: .01,
  })
  const [done, setDone] = useState('')
  const [open, setOpen] = useState(true)
  return <main>
    <DemoExecutionPanel feed={feed} planner={planner} volume={query.has('noVolume') ? null : .01}
      unsupportedManagement={false} confirmationOpen={open} onCancel={() => setOpen(false)} onComplete={setDone} />
    <output aria-label="Wynik">{done}</output>
    <button onClick={() => setPlanner(value => value ? { ...value, entry: value.entry + .2 } : null)}>Przesuń Planner</button>
  </main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
