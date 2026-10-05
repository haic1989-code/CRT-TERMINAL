import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  cancelReplayImport,
  cancelReplayRun,
  fetchReplayArchives,
  fetchReplayImport,
  fetchReplayRun,
  fetchReplayRunEvents,
  fetchReplayStrategies,
  startReplayImport,
  startReplayRun,
  saveReplayStrategy,
  type ReplayArchive,
  type ReplayImportJob,
  type ReplayRun,
  type ReplayRunEvent,
  type ReplayStrategy,
} from './mt5Client'
import './fx-replay.css'

function localInputTime(value: number) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

function showTime(value: number) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

const statusLabel: Record<ReplayArchive['status'], string> = {
  importing: 'IMPORT W TOKU',
  complete: 'KOMPLETNE',
  failed: 'BŁĄD IMPORTU',
  cancelled: 'ANULOWANE',
  interrupted: 'PRZERWANE',
}

const sampleStrategy = `def on_start(context):
    context.state["prices"] = []
    context.state["total"] = 0.0
    context.state["position"] = None

def on_tick(context, tick):
    if tick["bid"] <= 0 or tick["ask"] <= 0:
        return
    prices = context.state["prices"]
    prices.append((tick["bid"] + tick["ask"]) / 2)
    context.state["total"] += prices[-1]
    period = max(2, min(500, int(context.params.get("period", 30))))
    if len(prices) > period:
        context.state["total"] -= prices.pop(0)
    if len(prices) < period:
        return
    average = context.state["total"] / period
    market = (tick["bid"] + tick["ask"]) / 2
    position = context.state["position"]
    if position is None and market > average:
        context.state["position"] = context.buy(context.spec["volume_min"])
    elif position is not None and market < average:
        context.close(position)
        context.state["position"] = None

def on_stop(context):
    pass
`

export function FxReplayImportPanel({ initialSymbol, onClose }: { initialSymbol: string; onClose: () => void }) {
  const now = Date.now()
  const [symbol, setSymbol] = useState(initialSymbol)
  const [fromTime, setFromTime] = useState(localInputTime(now - 7 * 24 * 60 * 60 * 1000))
  const [toTime, setToTime] = useState(localInputTime(now))
  const [archives, setArchives] = useState<ReplayArchive[]>([])
  const [strategies, setStrategies] = useState<ReplayStrategy[]>([])
  const [strategyName, setStrategyName] = useState('Średnia krocząca — przykład')
  const [strategySource, setStrategySource] = useState(sampleStrategy)
  const [selectedArchiveId, setSelectedArchiveId] = useState('')
  const [selectedStrategyId, setSelectedStrategyId] = useState('')
  const [paramsText, setParamsText] = useState('{\n  "period": 30\n}')
  const [run, setRun] = useState<ReplayRun | null>(null)
  const [events, setEvents] = useState<ReplayRunEvent[]>([])
  const [job, setJob] = useState<ReplayImportJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeJob = job?.status === 'starting' || job?.status === 'importing'
  const completeCount = useMemo(() => archives.filter(archive => archive.status === 'complete').length, [archives])

  const refreshArchives = async () => {
    try {
      const result = await fetchReplayArchives()
      setArchives(result.values)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie mogę odczytać lokalnych archiwów.')
    }
  }

  const refreshStrategies = async () => {
    try {
      const result = await fetchReplayStrategies()
      setStrategies(result.values)
      if (!selectedStrategyId && result.values[0]) setSelectedStrategyId(result.values[0].id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie mogę odczytać lokalnych strategii.')
    }
  }

  useEffect(() => { void refreshArchives(); void refreshStrategies() }, [])

  useEffect(() => {
    if (!job?.id || !activeJob) return
    let stopped = false
    const poll = async () => {
      try {
        const latest = await fetchReplayImport(job.id)
        if (stopped) return
        setJob(latest)
        if (latest.status !== 'starting' && latest.status !== 'importing') void refreshArchives()
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : 'Nie mogę odczytać postępu importu.')
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [job?.id, activeJob])

  useEffect(() => {
    if (!run?.id || !['queued', 'running'].includes(run.status)) return
    let stopped = false
    const poll = async () => {
      try {
        const latest = await fetchReplayRun(run.id)
        if (!stopped) setRun(latest)
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : 'Nie mogę odczytać postępu symulacji.')
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 700)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [run?.id, run?.status])

  useEffect(() => {
    if (!run?.id || run.status !== 'complete') return
    let stopped = false
    void fetchReplayRunEvents(run.id, 0, 100).then(page => { if (!stopped) setEvents(page.values) }).catch(reason => {
      if (!stopped) setError(reason instanceof Error ? reason.message : 'Nie mogę odczytać dziennika symulacji.')
    })
    return () => { stopped = true }
  }, [run?.id, run?.status])

  const beginImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fromMs = new Date(fromTime).getTime()
    const toMs = new Date(toTime).getTime()
    if (!symbol.trim() || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs <= 0 || toMs <= fromMs) {
      setError('Wybierz symbol oraz poprawny zakres czasu.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const started = await startReplayImport({ symbol: symbol.trim(), fromMs, toMs })
      setJob(started)
      await refreshArchives()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się rozpocząć importu ticków.')
    } finally {
      setBusy(false)
    }
  }

  const stopImport = async () => {
    if (!job) return
    setError('')
    try { setJob(await cancelReplayImport(job.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się anulować importu.') }
  }

  const addStrategy = async () => {
    setError('')
    try {
      const saved = await saveReplayStrategy(strategyName.trim(), strategySource)
      await refreshStrategies()
      setSelectedStrategyId(saved.id)
      setRun(null)
      setEvents([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać strategii Python.')
    }
  }

  const simulate = async () => {
    if (!selectedArchiveId || !selectedStrategyId) { setError('Wybierz kompletne archiwum i skrypt Python.'); return }
    let params: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(paramsText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Parametry muszą być obiektem JSON.')
      params = parsed as Record<string, unknown>
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parametry muszą być poprawnym JSON-em.')
      return
    }
    setError('')
    setEvents([])
    try { setRun(await startReplayRun({ archiveId: selectedArchiveId, strategyId: selectedStrategyId, params })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się rozpocząć symulacji.') }
  }

  const cancelRun = async () => {
    if (!run) return
    try { setRun(await cancelReplayRun(run.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się anulować symulacji.') }
  }

  return <div className="fx-replay-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="fx-replay-window" role="dialog" aria-modal="true" aria-labelledby="fx-replay-title">
      <header className="fx-replay-header">
        <div><small>CRT // LOCAL MARKET LAB</small><h2 id="fx-replay-title">FX REPLAY</h2><p>Rzeczywiste ticki · lokalne skrypty Python · symulowane transakcje</p></div>
        <button type="button" className="fx-replay-close" aria-label="Zamknij FX Replay" onClick={onClose}>×</button>
      </header>
      <div className="fx-replay-content fx-replay-content--workspace">
        <form className="fx-replay-import" onSubmit={beginImport}>
          <div className="fx-replay-section-title"><span>01</span> NOWY IMPORT</div>
          <label>SYMBOL BROKERA<input value={symbol} maxLength={64} onChange={event => setSymbol(event.target.value)} placeholder="np. XAUUSD.a" /></label>
          <div className="fx-replay-range">
            <label>OD<input type="datetime-local" value={fromTime} onChange={event => setFromTime(event.target.value)} /></label>
            <label>DO<input type="datetime-local" value={toTime} onChange={event => setToTime(event.target.value)} /></label>
          </div>
          <p className="fx-replay-note">Luna › Import wymaga uruchomionego MT5. Ticki zapiszę w UTC; gotowe archiwum będzie dostępne offline.</p>
          <div className="fx-replay-actions">
            <button type="submit" disabled={busy || !!activeJob}>{busy ? 'ŁĄCZĘ Z MT5…' : 'IMPORTUJ TICKI'}</button>
            {activeJob && <button type="button" className="secondary" onClick={() => void stopImport()}>ANULUJ IMPORT</button>}
          </div>
          {job && <div className={'fx-replay-job fx-replay-job--' + job.status} role="status" aria-live="polite">
            <div><b>{job.status === 'complete' ? 'Luna › Archiwum gotowe.' : job.status === 'failed' ? 'Luna › Import zatrzymał się z błędem.' : job.status === 'cancelled' ? 'Luna › Import anulowany.' : 'Luna › Pobieram ticki z MT5…'}</b><span>{job.symbol} · {job.tick_count.toLocaleString('pl-PL')} ticków</span></div>
            {activeJob && <><progress max="100" value={job.progress} /><span>{job.progress}% · do {showTime(job.completed_through_ms)}</span></>}
            {job.error && <small>{job.error}</small>}
          </div>}
          {error && <p className="fx-replay-error" role="alert">Luna › {error}</p>}
        </form>
        <section className="fx-replay-archives" aria-labelledby="fx-replay-archives-title">
          <div className="fx-replay-section-title" id="fx-replay-archives-title"><span>02</span> ARCHIWA LOKALNE <small>{completeCount} GOTOWE</small></div>
          {archives.length === 0 && <p className="fx-replay-empty">Luna › Nie ma jeszcze zaimportowanych archiwów. Tutaj pojawi się ich status i zakres.</p>}
          {archives.map(archive => <article className={'fx-replay-archive ' + (archive.status === 'complete' ? 'is-complete' : 'is-incomplete') + (selectedArchiveId === archive.id ? ' is-selected' : '')} key={archive.id}>
            <div className="fx-replay-archive-heading"><b>{archive.symbol}</b><span>{statusLabel[archive.status]}</span></div>
            <p>{archive.broker || 'Broker MT5'} · {archive.server || 'serwer niepodany'}</p>
            <p>{showTime(archive.from_ms)} → {showTime(archive.to_ms)}</p>
            <div className="fx-replay-archive-footer"><span>{archive.tick_count.toLocaleString('pl-PL')} ticków</span><span>{archive.sha256 ? 'SHA-256 ' + archive.sha256.slice(0, 12) + '…' : archive.error || 'bez sumy — import niekompletny'}</span></div>
            {archive.status === 'complete' && <button type="button" className="fx-replay-select" onClick={() => { setSelectedArchiveId(archive.id); setRun(null); setEvents([]) }}>{selectedArchiveId === archive.id ? 'WYBRANE DO SYMULACJI' : 'WYBIERZ ARCHIWUM'}</button>}
          </article>)}
        </section>
        <section className="fx-replay-strategies" aria-labelledby="fx-replay-strategy-title">
          <div className="fx-replay-section-title" id="fx-replay-strategy-title"><span>03</span> SKRYPT STRATEGII <small>PYTHON API v1</small></div>
          <label>NAZWA STRATEGII<input value={strategyName} maxLength={80} onChange={event => setStrategyName(event.target.value)} /></label>
          <label>EDYTOR KODU PYTHON<textarea spellCheck={false} value={strategySource} onChange={event => setStrategySource(event.target.value)} /></label>
          <div className="fx-replay-strategy-actions">
            <button type="button" onClick={() => void addStrategy()} disabled={!strategyName.trim() || !strategySource.trim()}>ZAPISZ SKRYPT</button>
            <label className="fx-replay-select-label">ZAPISANY SKRYPT<select value={selectedStrategyId} onChange={event => setSelectedStrategyId(event.target.value)}><option value="">Wybierz strategię</option>{strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name} · v{strategy.api_version}</option>)}</select></label>
          </div>
          <label>PARAMETRY JSON<textarea className="fx-replay-params" spellCheck={false} value={paramsText} onChange={event => setParamsText(event.target.value)} /></label>
          <p className="fx-replay-note">Luna › Skrypt działa lokalnie w osobnym procesie. To kod użytkownika, nie uruchamiaj niezaufanych plików. Symulacja nie wysyła zleceń do MT5.</p>
          <div className="fx-replay-actions">
            <button type="button" disabled={!selectedArchiveId || !selectedStrategyId || !!run && ['queued', 'running'].includes(run.status)} onClick={() => void simulate()}>URUCHOM SYMULACJĘ</button>
            {run && ['queued', 'running'].includes(run.status) && <button type="button" className="secondary" onClick={() => void cancelRun()}>ANULUJ</button>}
          </div>
          {run && <div className={'fx-replay-job fx-replay-job--' + run.status} role="status" aria-live="polite">
            <div><b>{run.status === 'complete' ? 'Luna › Symulacja zakończona.' : run.status === 'failed' ? 'Luna › Skrypt zakończył się błędem.' : run.status === 'cancelled' ? 'Luna › Symulacja anulowana.' : 'Luna › Przetwarzam ticki…'}</b><span>{run.progress_ticks.toLocaleString('pl-PL')} / {run.total_ticks.toLocaleString('pl-PL')}</span></div>
            {['queued', 'running'].includes(run.status) && <progress max={Math.max(1, run.total_ticks)} value={run.progress_ticks} />}
            {run.error && <small>{run.error}</small>}
            {run.report && <div className="fx-replay-metrics"><span>Zamknięcia <b>{String(run.report.closed_exits ?? 0)}</b></span><span>Wygrane <b>{String(run.report.winning_exits ?? 0)}</b></span><span>Straty <b>{String(run.report.losing_exits ?? 0)}</b></span><span>Wynik ważony punktami <b>{Number(run.report.net_points_volume ?? 0).toLocaleString('pl-PL')}</b></span></div>}
          </div>}
          {events.length > 0 && <div className="fx-replay-events"><div className="fx-replay-section-title"><span>04</span> DZIENNIK ZDARZEŃ <small>PIERWSZE {events.length}</small></div><div className="fx-replay-event-list">{events.map(event => <div key={event.sequence} className={'fx-replay-event fx-replay-event--' + event.kind}><time>{showTime(event.time_msc)}</time><b>{event.kind.toUpperCase()}</b><span>{String(event.side || event.reason || '')}</span><span>{Number(event.price || 0).toLocaleString('pl-PL')}</span>{event.points !== undefined && <strong>{Number(event.points).toFixed(1)} pkt</strong>}</div>)}</div></div>}
        </section>
      </div>
    </section>
  </div>
}
