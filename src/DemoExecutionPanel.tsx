import { useEffect, useRef, useState } from 'react'
import type { MarketFeedState, PlannerSnapshot } from './MarketChart'
import { executionStatus, prepareExecution, readExecution, sendExecution, unresolvedExecution, type ExecutionRecord, type ExecutionStatus } from './mt5Execution'

const STORAGE = 'crt-terminal:pending-execution:v1'
const orderTypeLabels: Record<number, string> = { 0: 'BUY MARKET', 1: 'SELL MARKET', 2: 'BUY LIMIT', 3: 'SELL LIMIT', 4: 'BUY STOP', 5: 'SELL STOP', 6: 'BUY STOP LIMIT', 7: 'SELL STOP LIMIT' }
const message = (error: unknown) => error instanceof Error ? error.message : 'Nie mogę potwierdzić wyniku. Sprawdźmy go w MT5.'
type Props = { feed: MarketFeedState; planner: PlannerSnapshot | null; volume: number | null; unsupportedManagement: boolean; confirmationOpen: boolean; onCancel: () => void; onComplete: (message: string) => void }
/** A single explicit Luna confirmation runs the existing DEMO preflight and one-shot send path. */
export function DemoExecutionPanel({ feed, planner, volume, unsupportedManagement, confirmationOpen, onCancel, onComplete }: Props) {
  const [status, setStatus] = useState<ExecutionStatus | null>(null)
  const [record, setRecord] = useState<ExecutionRecord | null>(null)
  const [notice, setNotice] = useState('Sprawdzam uprawnienia konta DEMO…')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false), mounted = useRef(true)
  const recoveryId = useRef<string | null>(null)
  const account = feed.account
  const kind = planner?.side === 'long' ? 'buy_limit' : 'sell_limit'
  const planKey = JSON.stringify([feed.symbol, account?.login, account?.server, planner, volume, kind, unsupportedManagement])
  const currentKey = useRef(planKey); currentKey.current = planKey
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
            try { if (localStorage.getItem(STORAGE) === id) localStorage.removeItem(STORAGE) } catch { /* server journal remains authoritative */ }
            if (result.state === 'RECONCILED') onComplete(result.message)
          }
        } else setNotice(current => current === 'Sprawdzam uprawnienia konta DEMO…' ? 'Luna › Plan wyśle się dopiero po Twoim potwierdzeniu.' : current)
      } catch (error) { if (!cancelled && mounted.current) { setStatus(null); setNotice(message(error)) } }
      finally { lock.current = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => { cancelled = true; mounted.current = false; window.clearInterval(timer) }
  }, [account?.login, account?.server])

  const block = !status ? 'Czekam na potwierdzenie uprawnień mostu.'
    : !status.enabled ? status.reason || 'Najpierw uzgodnię poprzednią wysyłkę z MT5.'
      : !planner ? 'Wskaż wejście, Stop Loss i Take Profit na wykresie.'
        : !account || !feed.symbol ? 'Czekam na symbol i konto z MT5.'
          : kind === 'buy_limit' && feed.ask !== undefined && planner.entry >= feed.ask ? 'Dla BUY LIMIT wejście musi być poniżej bieżącego Ask.'
            : kind === 'sell_limit' && feed.bid !== undefined && planner.entry <= feed.bid ? 'Dla SELL LIMIT wejście musi być powyżej bieżącego Bid.'
              : !feed.marketSession?.available ? 'Brak potwierdzonych godzin sesji symbolu w MT5.'
                : feed.marketSession.trade_open === false ? 'Sesja handlowa jest zamknięta. Zlecenie pozostaje zablokowane.'
                  : unsupportedManagement ? 'Przed wysyłką wyłącz TP1–TP3 oraz BE. Obsługuję pełny TP i SL.'
                    : feed.status !== 'live' ? feed.status === 'closed' ? 'Rynek jest zamknięty. Poczekajmy na otwarcie sesji.' : 'Poczekajmy na aktualne notowanie.'
                      : !volume || volume <= 0 ? 'Ustaw poprawny wolumen.' : !Number.isFinite(planner.entry) || !Number.isFinite(planner.sl) || !Number.isFinite(planner.tp) ? 'Sprawdź ceny wejścia, SL i TP.' : ''

  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { await action() } catch (error) { setNotice(message(error)) }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const confirm = () => void run(async () => {
    if (block || !planner || !volume || !account || !feed.symbol || unresolved) return
    const key = currentKey.current
    const quote = planner.side === 'long' ? feed.ask : feed.bid
    if (!quote || !Number.isFinite(quote)) throw new Error('Nie mam aktualnej ceny Bid/Ask. Poczekajmy na notowanie.')
    const clientRequestId = crypto.randomUUID()
    // Save the id before prepare: if the bridge response is interrupted, recovery can only read this request.
    localStorage.setItem(STORAGE, clientRequestId)
    if (localStorage.getItem(STORAGE) !== clientRequestId) throw new Error('Nie udało mi się zapisać identyfikatora zlecenia. Niczego nie wysłałam.')
    recoveryId.current = clientRequestId
    setNotice('Luna › Sprawdzam konto DEMO, poziomy i ryzyko przed wysyłką…')
    const prepared = await prepareExecution({ clientRequestId, accountLogin: account.login, accountServer: account.server,
      symbol: feed.symbol, side: planner.side === 'long' ? 'buy' : 'sell', kind, volume, entry: planner.entry, sl: planner.sl, tp: planner.tp, quote, deviationPoints: 20 })
    setRecord(prepared); setNotice(prepared.message)
    if (prepared.state !== 'PREPARED') return
    if (currentKey.current !== key || Date.now() >= prepared.expiresAt) {
      setNotice('Luna › Plan zmienił się lub kontrola wygasła. Nie wysłałam zlecenia; sprawdź plan ponownie.')
      return
    }
    setRecord({ ...prepared, state: 'SUBMITTING' })
    setNotice('Luna › Kontrole przeszły. Wysyłam zlecenie DEMO jeden raz…')
    let result: ExecutionRecord
    try { result = await sendExecution(prepared) }
    catch (error) {
      setRecord({ ...prepared, state: 'UNKNOWN' })
      setNotice(`Luna › Wynik wysyłki jest niepewny. Nie ponawiam zlecenia. ${message(error)}`)
      return
    }
    setRecord(result); setNotice(result.message)
    if (!unresolvedExecution(result)) {
      recoveryId.current = null
      try { localStorage.removeItem(STORAGE) } catch { /* server result is already known */ }
    }
    try { setStatus(await executionStatus()) } catch { setStatus(null) }
    if (result.state === 'RECONCILED') onComplete(result.message)
  })
  const check = () => void run(async () => {
    const id = record?.clientRequestId || recoveryId.current
    if (!id) return
    const result = await readExecution(id)
    setRecord(result); setNotice(result.message)
    if (!unresolvedExecution(result)) {
      recoveryId.current = null
      try { localStorage.removeItem(STORAGE) } catch { /* server result is already known */ }
      if (result.state === 'RECONCILED') onComplete(result.message)
    }
    setStatus(await executionStatus())
  })
  if (!confirmationOpen && !unresolved) return null
  return <section className="demo-execution luna-trade-confirm" aria-label="Potwierdzenie zlecenia DEMO przez Lunę">
    <h3>{unresolved ? 'LUNA · UZGADNIAM WYNIK' : 'LUNA · POTWIERDZENIE POZYCJI'}</h3>
    <p className="execution-luna" role="status">Luna › {unresolved ? notice : `Czy wysłać ${kind === 'buy_limit' ? 'BUY LIMIT' : 'SELL LIMIT'} na koncie DEMO?`}</p>
    {confirmationOpen && planner && <div className="execution-review">
      <strong>{feed.symbol || 'SYMBOL'} · {kind === 'buy_limit' ? 'BUY LIMIT' : 'SELL LIMIT'} · {planner.side === 'long' ? 'DŁUGA' : 'KRÓTKA'}</strong>
      <dl>{[['Wolumen', `${volume ?? '—'} lot`], ['Wejście', planner.entry], ['SL', planner.sl], ['Pełny TP', planner.tp]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {block && <p className="execution-luna dim">Luna › {block}</p>}
      <div className="execution-actions"><button className="execution-send" disabled={busy || Boolean(block) || unresolved} onClick={confirm}>Potwierdź pozycję · wyślij DEMO</button><button className="execution-cancel" disabled={busy || unresolved} onClick={onCancel}>Anuluj rysowanie</button></div>
    </div>}
    {unresolved && <><p className="execution-luna dim">Luna › Nie wysyłam ponownie. Najpierw odczytam istniejące zlecenie z dziennika MT5.</p><button disabled={busy} onClick={check}>Sprawdź wynik w MT5</button></>}
    {record?.state === 'REJECTED' && <p className="execution-luna dim">Luna › MT5 odrzucił zlecenie. Popraw plan i potwierdź go ponownie albo anuluj rysowanie.</p>}
  </section>
}
