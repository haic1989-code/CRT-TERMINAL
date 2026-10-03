import { useEffect, useRef, useState } from 'react'
import type { MarketFeedState, PlannerSnapshot } from './MarketChart'
import { executionStatus, prepareExecution, readExecution, sendExecution, unresolvedExecution, type ExecutionRecord, type ExecutionStatus } from './mt5Execution'

const STORAGE = 'crt-terminal:pending-execution:v1'
const stateLabels = { PREPARED: 'Sprawdzone', INTENT: 'Weryfikuję przed wysyłką', SUBMITTING: 'Wysyłam', ACKNOWLEDGED: 'Odpowiedź brokera · uzgadniam', UNKNOWN: 'Wynik niepotwierdzony', REJECTED: 'Odrzucone', RECONCILED: 'Wynik uzgodniony z MT5' }
const message = (error: unknown) => error instanceof Error ? error.message : 'Nie mogę potwierdzić wyniku. Sprawdźmy go w MT5.'
type Props = { feed: MarketFeedState; planner: PlannerSnapshot | null; volume: number | null; unsupportedManagement: boolean }
/** Only explicit user clicks can prepare or submit. Recovery calls are read-only. */
export function DemoExecutionPanel({ feed, planner, volume, unsupportedManagement }: Props) {
  const [kind, setKind] = useState<'market' | 'pending'>('pending')
  const [deviation, setDeviation] = useState(20)
  const [status, setStatus] = useState<ExecutionStatus | null>(null)
  const [record, setRecord] = useState<ExecutionRecord | null>(null)
  const [notice, setNotice] = useState('Sprawdzam konto DEMO i dziennik wysyłki…')
  const [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now())
  const lock = useRef(false), mounted = useRef(true), preparedKey = useRef('')
  const recoveryId = useRef<string | null>(null)
  const account = feed.account
  const planKey = JSON.stringify([feed.symbol, account?.login, account?.server, planner, volume, kind, deviation, unsupportedManagement])
  const currentKey = useRef(planKey); currentKey.current = planKey
  const prepared = record?.state === 'PREPARED'
  const unresolved = Boolean(record && unresolvedExecution(record))
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    try { recoveryId.current = localStorage.getItem(STORAGE) } catch { /* server journal remains authoritative */ }
    const refresh = async () => {
      if (lock.current) return
      lock.current = true
      try {
        const value = await executionStatus()
        if (cancelled || !mounted.current) return
        setStatus(value)
        const id = value.unresolved[0]?.clientRequestId || recoveryId.current
        if (id) {
          const result = await readExecution(id)
          if (cancelled) return
          if (mounted.current) { setRecord(result); setNotice(result.message) }
          if (!unresolvedExecution(result)) {
            recoveryId.current = null
            try { if (localStorage.getItem(STORAGE) === id) localStorage.removeItem(STORAGE) } catch { /* retain durable server journal */ }
          }
        } else setNotice(current => current === 'Sprawdzam konto DEMO i dziennik wysyłki…' ? 'Mogę sprawdzić Twój plan. Wysyłam dopiero po osobnym potwierdzeniu.' : current)
      } catch (error) { if (!cancelled && mounted.current) { setStatus(null); setNotice(message(error)) } }
      finally { lock.current = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { cancelled = true; mounted.current = false; window.clearInterval(timer); window.clearInterval(clock) }
  }, [account?.login, account?.server])
  const block = !status ? 'Czekam na potwierdzenie uprawnień mostu.' : !status.enabled ? status.reason || 'Najpierw uzgodnię poprzednią wysyłkę z MT5.' : !planner ? 'Wybierz DŁUGA lub KRÓTKA i wskaż wejście na wykresie.' : unsupportedManagement ? 'Ta wersja wysyła pełny TP i SL. Wyłącz TP1–TP3 oraz BE przed wysyłką.' : feed.status !== 'live' ? 'Poczekajmy na aktualne notowanie.' : !volume || volume <= 0 ? 'Ustaw poprawny wolumen.' : ''
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { await action() } catch (error) { setNotice(message(error)) }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const prepare = () => void run(async () => {
    if (block || !planner || !volume || !account || !feed.symbol) return
    const key = currentKey.current
    const quote = planner.side === 'long' ? feed.ask : feed.bid
    if (!quote || !Number.isFinite(quote)) throw new Error('Nie mam aktualnej ceny Bid/Ask. Poczekajmy na notowanie.')
    const result = await prepareExecution({ clientRequestId: crypto.randomUUID(), accountLogin: account.login, accountServer: account.server,
      symbol: feed.symbol, side: planner.side === 'long' ? 'buy' : 'sell', kind, volume, entry: planner.entry, sl: planner.sl, tp: planner.tp, quote, deviationPoints: deviation })
    preparedKey.current = key
    setRecord(result); setNotice(result.message)
  })
  const send = () => void run(async () => {
    if (!record || record.state !== 'PREPARED' || block || preparedKey.current !== currentKey.current || Date.now() >= record.expiresAt) return
    // Persist recovery ID before any network call. A failed storage write blocks submission.
    localStorage.setItem(STORAGE, record.clientRequestId)
    if (localStorage.getItem(STORAGE) !== record.clientRequestId) throw new Error('Nie udało mi się zapisać identyfikatora wysyłki. Nie wysłałam zlecenia.')
    recoveryId.current = record.clientRequestId
    setRecord({ ...record, state: 'SUBMITTING' }); setNotice('Wysyłam jeden raz. Przy przerwanym połączeniu sprawdzę wynik bez ponawiania.')
    try {
      const result = await sendExecution(record)
      setRecord(result); setNotice(result.message)
      if (!unresolvedExecution(result)) {
        recoveryId.current = null
        try { localStorage.removeItem(STORAGE) } catch { /* server result is already known */ }
      }
    } catch (error) {
      setRecord({ ...record, state: 'UNKNOWN' })
      setNotice(`Nie potwierdziłam wyniku wysyłki. Nie ponawiam zlecenia. ${message(error)}`)
    }
    try { setStatus(await executionStatus()) } catch { setStatus(null) }
  })
  const check = () => void run(async () => {
    const id = record?.clientRequestId || recoveryId.current
    if (!id) return
    const result = await readExecution(id)
    setRecord(result); setNotice(result.message)
    if (!unresolvedExecution(result)) { recoveryId.current = null; localStorage.removeItem(STORAGE) }
    setStatus(await executionStatus())
  })
  const seconds = record ? Math.max(0, Math.ceil((record.expiresAt - now) / 1000)) : 0
  return <section className="demo-execution" aria-label="Ręczna egzekucja DEMO">
    <h3>06 EGZEKUCJA · TYLKO DEMO</h3>
    <p className="execution-luna" role="status">Luna › {notice}</p>
    {account && <p className="subline">Konto {account.login} · {account.server}</p>}
    <div className="execution-options"><label>Rodzaj <select value={kind} disabled={busy || unresolved} onChange={event => setKind(event.target.value as typeof kind)}><option value="pending">Oczekujące · cena planu</option><option value="market">Po rynku · aktualny Bid/Ask</option></select></label><label>Odchylenie (punkty) <input type="number" min="0" max="100" step="1" value={deviation} disabled={busy || unresolved} onChange={event => setDeviation(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))}/></label></div>
    {block && <p className="execution-luna dim">Luna › {block}</p>}
    {!unresolved && <button className="execution-check" disabled={busy || Boolean(block)} onClick={prepare}>Sprawdź zlecenie DEMO</button>}
    {record && <div className="execution-review">
      <strong>{record.request.symbol} · {record.request.type % 2 === 0 ? 'KUPNO' : 'SPRZEDAŻ'} · {record.kind === 'market' ? 'PO RYNKU' : [,, 'LIMIT','LIMIT','STOP','STOP'][record.request.type] || 'OCZEKUJĄCE'}</strong>
      <dl>{[['Lot', record.request.volume], ['Wejście', record.request.price], ['SL', record.request.sl], ['Pełny TP', record.request.tp], ['Ryzyko', `${record.risk.loss.toFixed(2)} ${record.risk.currency} (${record.risk.riskPercent.toFixed(2)}%)`], ['Margin', `${record.risk.margin.toFixed(2)} ${record.risk.currency}`], ['Stan', stateLabels[record.state]]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {record.result && <p className="subline">{record.result.order ? `Zlecenie #${record.result.order} · ` : ''}{record.result.deal ? `Transakcja #${record.result.deal} · ` : ''}{record.result.filledVolume !== undefined ? `Wykonano ${record.result.filledVolume} lota` : ''}</p>}
      {prepared && <><p className="execution-luna">Luna › {preparedKey.current !== planKey ? 'Plan się zmienił. Sprawdź go ponownie.' : seconds > 0 ? `Podsumowanie jest ważne jeszcze ${seconds} s. Sprawdź kierunek, SL i TP.` : 'Podsumowanie wygasło. Sprawdź plan ponownie.'}</p><button className="execution-send" disabled={busy || Boolean(block) || preparedKey.current !== planKey || seconds === 0} onClick={send}>Wyślij {record.request.volume} lota · DEMO</button></>}
      {unresolved && <button disabled={busy} onClick={check}>Sprawdź wynik w MT5 · bez ponawiania</button>}
    </div>}
    <p className="subline">Luna › TP1–TP3 i BE pozostają planowaniem. Pozycje zamykaj bezpośrednio w MT5.</p>
  </section>
}
