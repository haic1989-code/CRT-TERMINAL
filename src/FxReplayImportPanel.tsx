import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  cancelReplayImport,
  fetchReplayArchives,
  fetchReplayImport,
  startReplayImport,
  type ReplayArchive,
  type ReplayImportJob,
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

export function FxReplayImportPanel({ initialSymbol, onClose }: { initialSymbol: string; onClose: () => void }) {
  const now = Date.now()
  const [symbol, setSymbol] = useState(initialSymbol)
  const [fromTime, setFromTime] = useState(localInputTime(now - 7 * 24 * 60 * 60 * 1000))
  const [toTime, setToTime] = useState(localInputTime(now))
  const [archives, setArchives] = useState<ReplayArchive[]>([])
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

  useEffect(() => { void refreshArchives() }, [])

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

  return <div className="fx-replay-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="fx-replay-window" role="dialog" aria-modal="true" aria-labelledby="fx-replay-title">
      <header className="fx-replay-header">
        <div><small>CRT // LOCAL MARKET LAB</small><h2 id="fx-replay-title">FX REPLAY</h2><p>Import rzeczywistych ticków MT5 do lokalnego archiwum</p></div>
        <button type="button" className="fx-replay-close" aria-label="Zamknij FX Replay" onClick={onClose}>×</button>
      </header>
      <div className="fx-replay-content">
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
          {archives.map(archive => <article className={'fx-replay-archive ' + (archive.status === 'complete' ? 'is-complete' : 'is-incomplete')} key={archive.id}>
            <div className="fx-replay-archive-heading"><b>{archive.symbol}</b><span>{statusLabel[archive.status]}</span></div>
            <p>{archive.broker || 'Broker MT5'} · {archive.server || 'serwer niepodany'}</p>
            <p>{showTime(archive.from_ms)} → {showTime(archive.to_ms)}</p>
            <div className="fx-replay-archive-footer"><span>{archive.tick_count.toLocaleString('pl-PL')} ticków</span><span>{archive.sha256 ? 'SHA-256 ' + archive.sha256.slice(0, 12) + '…' : archive.error || 'bez sumy — import niekompletny'}</span></div>
          </article>)}
        </section>
      </div>
    </section>
  </div>
}
