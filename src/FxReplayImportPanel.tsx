import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  cancelReplayImport,
  cancelReplayRun,
  fetchReplayArchives,
  fetchReplayImport,
  fetchReplayInbox,
  fetchReplayRun,
  fetchReplayRunEvents,
  fetchReplayStrategies,
  fetchReplayStrategySource,
  fetchReplayTicks,
  startReplayImport,
  startReplayRun,
  saveReplayStrategy,
  type ReplayArchive,
  type ReplayImportJob,
  type ReplayRun,
  type ReplayRunEvent,
  type ReplayStrategy,
  type ReplayTick,
} from './mt5Client'
import './fx-replay.css'
import { indexReplayCandles, replayCandlesAt, replayCursorAt } from './replayPlayback'

function localInputTime(value: number) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

function showTime(value: number) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(value) + ' UTC'
}

const replayIntervals: Record<string, number> = { M1: 60_000, M5: 300_000, M15: 900_000, M30: 1_800_000, H1: 3_600_000, H4: 14_400_000, D1: 86_400_000 }
const PAGE_SIZE = 30_000
const PAGE_STRIDE = 20_000

function ReplayPriceChart({ ticks, cursor, events, intervalMs }: { ticks: ReplayTick[]; cursor: number; events: ReplayRunEvent[]; intervalMs: number }) {
  const candleIndex = useMemo(() => indexReplayCandles(ticks, intervalMs), [ticks, intervalMs])
  const candles = useMemo(() => replayCandlesAt(candleIndex, cursor), [candleIndex, cursor])
  if (!candles.length) return <div className="fx-replay-chart-empty">Luna › W wybranym fragmencie nie ma jeszcze prawidłowej ceny Bid.</div>
  const values = candles.flatMap(candle => [candle.low, candle.high])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || Math.max(Math.abs(max) * 0.0001, 1)
  const xForIndex = (index: number) => 52 + index * (900 / Math.max(1, candles.length - 1))
  const yForPrice = (price: number) => 270 - ((price - min) / span) * 235
  const visibleEvents = events.filter(event => ['entry', 'exit', 'pending'].includes(event.kind) && event.tick_sequence !== null && Number(event.tick_sequence) <= ticks[cursor]?.sequence && Number(event.price) > 0).slice(-1000)
  const firstSeq = ticks[0]?.sequence ?? 0
  const lastSeq = ticks[cursor]?.sequence ?? firstSeq
  return <svg className="fx-replay-chart" viewBox="0 0 1000 310" role="img" aria-label="Wykres świecowy odtworzony z ticków archiwum">
    {[0, 1, 2, 3, 4].map(index => <g key={index}><line x1="48" x2="966" y1={35 + index * 58} y2={35 + index * 58} /><text x="972" y={39 + index * 58}>{(max - span * index / 4).toFixed(2)}</text></g>)}
    {candles.map((candle, index) => {
      const x = xForIndex(index)
      const up = candle.close >= candle.open
      const color = up ? '#59e1ac' : '#ff718e'
      const bodyTop = Math.min(yForPrice(candle.open), yForPrice(candle.close))
      const bodyHeight = Math.max(1.5, Math.abs(yForPrice(candle.open) - yForPrice(candle.close)))
      return <g key={candle.time} className={up ? 'is-up' : 'is-down'}><line x1={x} x2={x} y1={yForPrice(candle.high)} y2={yForPrice(candle.low)} stroke={color} /><rect x={x - Math.min(5, Math.max(2, 260 / candles.length))} y={bodyTop} width={Math.min(10, Math.max(3, 520 / candles.length))} height={bodyHeight} fill={color} /></g>
    })}
    {visibleEvents.map(event => {
      const seq = Number(event.tick_sequence)
      if (seq < firstSeq || seq > lastSeq) return null
      const slot = candles.findIndex(candle => candle.time === Math.floor(event.time_msc / intervalMs) * intervalMs)
      if (slot < 0) return null
      const entry = event.kind === 'entry'
      const color = entry ? '#ffd374' : event.kind === 'exit' ? '#8dd8f8' : '#b9a8f3'
      const y = yForPrice(Number(event.price))
      return <g key={'event-' + event.sequence} className="fx-replay-chart-marker"><circle cx={xForIndex(slot)} cy={y} r="5" fill={color} /><text x={xForIndex(slot) + 7} y={y - 7} fill={color}>{entry ? 'ENTRY' : event.kind === 'exit' ? `EXIT ${Number(event.points || 0) >= 0 ? '+' : ''}${Number(event.points || 0).toFixed(1)} pkt` : 'LIMIT'}</text></g>
    })}
    <text x="52" y="300">{showTime(candles[0].time)}</text><text x="966" y="300" textAnchor="end">{showTime(candles[candles.length - 1].time)}</text>
  </svg>
}

const statusLabel: Record<ReplayArchive['status'], string> = {
  importing: 'IMPORT W TOKU',
  complete: 'GOTOWE',
  failed: 'BŁĄD IMPORTU',
  cancelled: 'ANULOWANE',
  interrupted: 'PRZERWANE',
}

const sampleStrategy = `def on_start(context):
    context.ema(int(context.params.get("fast_period", 12)))
    context.ema(int(context.params.get("slow_period", 26)))
    context.atr(int(context.params.get("atr_period", 14)))
    context.state["position"] = None
    context.state["last_bar"] = None
    context.state["previous_fast"] = None
    context.state["previous_slow"] = None

def on_tick(context, tick):
    if not context.bars:
        return
    bar = context.bars[-1]
    if context.state["last_bar"] == bar["time_msc"]:
        return
    context.state["last_bar"] = bar["time_msc"]
    fast = context.ema(int(context.params.get("fast_period", 12)))
    slow = context.ema(int(context.params.get("slow_period", 26)))
    atr = context.atr(int(context.params.get("atr_period", 14)))
    if fast is None or slow is None or atr is None or atr <= 0:
        return

    position_id = context.state["position"]
    position = next((item for item in context.positions if item["id"] == position_id), None)
    if position is not None:
        trail = atr * float(context.params.get("trail_atr", 2.0))
        if position["side"] == "buy":
            next_sl = context.round_price(bar["close"] - trail, "down")
            if position["sl"] is not None and next_sl > position["sl"] and next_sl < context.bid:
                context.modify_position(position_id, sl=next_sl)
        else:
            next_sl = context.round_price(bar["close"] + trail, "up")
            if position["sl"] is not None and next_sl < position["sl"] and next_sl > context.ask:
                context.modify_position(position_id, sl=next_sl)

    previous_fast = context.state["previous_fast"]
    previous_slow = context.state["previous_slow"]
    crossed_up = previous_fast is not None and previous_slow is not None and previous_fast <= previous_slow and fast > slow
    crossed_down = previous_fast is not None and previous_slow is not None and previous_fast >= previous_slow and fast < slow
    context.state["previous_fast"] = fast
    context.state["previous_slow"] = slow
    if position is not None or not crossed_up and not crossed_down:
        return

    stop_distance = atr * float(context.params.get("stop_atr", 2.0))
    target_r = float(context.params.get("target_r", 2.0))
    if stop_distance <= 0 or target_r <= 0:
        return
    if crossed_up:
        entry = context.ask + float(context.params.get("slippage_points", 0)) * float(context.spec.get("point", 0))
        stop = context.round_price(entry - stop_distance, "down")
        target = context.round_price(entry + abs(entry - stop) * target_r, "up")
        volume = context.risk_volume(abs(entry - stop))
        context.state["position"] = context.buy(volume, sl=stop, tp=target)
    elif crossed_down:
        entry = context.bid - float(context.params.get("slippage_points", 0)) * float(context.spec.get("point", 0))
        stop = context.round_price(entry + stop_distance, "up")
        target = context.round_price(entry - abs(stop - entry) * target_r, "down")
        volume = context.risk_volume(abs(stop - entry))
        context.state["position"] = context.sell(volume, sl=stop, tp=target)

def on_stop(context):
    pass
`

export function FxReplayImportPanel({ initialSymbol, onClose }: { initialSymbol: string; onClose: () => void }) {
  const now = Date.now()
  const [importSource, setImportSource] = useState('mt5')
  const [inbox, setInbox] = useState<{ folder: string; values: { name: string; bytes: number }[] }>({ folder: '', values: [] })
  const [fileName, setFileName] = useState('')
  const [utcOffset, setUtcOffset] = useState('0')
  const [symbol, setSymbol] = useState(initialSymbol)
  const [fromTime, setFromTime] = useState(localInputTime(now - 7 * 24 * 60 * 60 * 1000))
  const [toTime, setToTime] = useState(localInputTime(now))
  const [archives, setArchives] = useState<ReplayArchive[]>([])
  const [strategies, setStrategies] = useState<ReplayStrategy[]>([])
  const [strategyName, setStrategyName] = useState('Średnia krocząca — przykład')
  const [strategySource, setStrategySource] = useState(sampleStrategy)
  const [selectedArchiveId, setSelectedArchiveId] = useState('')
  const [selectedStrategyId, setSelectedStrategyId] = useState('')
  const [paramsText, setParamsText] = useState('{\n  "timeframe": "M5",\n  "indicator_model": "mt5",\n  "risk_fraction": 0.005,\n  "fast_period": 12,\n  "slow_period": 26,\n  "atr_period": 14,\n  "stop_atr": 2,\n  "target_r": 2,\n  "trail_atr": 2,\n  "commission_per_lot_side": 0,\n  "slippage_points": 0\n}')
  const [initialBalance, setInitialBalance] = useState('10000')
  const [leverage, setLeverage] = useState('100')
  const [run, setRun] = useState<ReplayRun | null>(null)
  const [events, setEvents] = useState<ReplayRunEvent[]>([])
  const [ticks, setTicks] = useState<ReplayTick[]>([])
  const [tickPageOffset, setTickPageOffset] = useState(0)
  const [cursorIndex, setCursorIndex] = useState(0)
  const [chartInterval, setChartInterval] = useState('M1')
  const [playSpeed, setPlaySpeed] = useState(1)
  const [playDirection, setPlayDirection] = useState<1 | -1>(1)
  const [playing, setPlaying] = useState(false)
  const [pageTransition, setPageTransition] = useState<{ archiveId: string; offset: number; direction: 1 | -1; sequence: number } | null>(null)
  const cursorRef = useRef(0)
  cursorRef.current = cursorIndex
  const pageGeneration = useRef(0)
  const strategyGeneration = useRef(0)
  const pageCache = useRef(new Map<string, Promise<Awaited<ReturnType<typeof fetchReplayTicks>>>>())
  const [loadingTicks, setLoadingTicks] = useState(false)
  const [job, setJob] = useState<ReplayImportJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeJob = job?.status === 'starting' || job?.status === 'importing' || job?.status === 'finalizing'
  const completeCount = useMemo(() => archives.filter(archive => archive.status === 'complete').length, [archives])
  const selectedArchive = archives.find(archive => archive.id === selectedArchiveId)
  const selectedStrategy = strategies.find(strategy => strategy.id === selectedStrategyId)
  const accountSnapshot = selectedArchive?.manifest?.account_snapshot as Record<string, unknown> | undefined
  const depositCurrency = String(accountSnapshot?.currency || selectedArchive?.manifest?.account_currency || '—')

  const chooseArchive = (archive: ReplayArchive) => {
    pageGeneration.current++
    setPlaying(false)
    setPageTransition(null)
    pageCache.current.clear()
    setSelectedArchiveId(archive.id)
    setInitialBalance(String(accountSnapshotValue(archive, 'balance', 10_000)))
    setLeverage(String(accountSnapshotValue(archive, 'leverage', 100)))
    setTicks([])
    setRun(null)
    setEvents([])
  }

  const accountSnapshotValue = (archive: ReplayArchive, key: string, fallback: number) => {
    const snapshot = archive.manifest?.account_snapshot as Record<string, unknown> | undefined
    const number = Number(snapshot?.[key])
    return Number.isFinite(number) && number > 0 ? number : fallback
  }

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
        if (!['starting', 'importing', 'finalizing'].includes(latest.status)) void refreshArchives()
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
    if (!run?.id || run.status !== 'complete' || !ticks.length) return
    let stopped = false
    const controller = new AbortController()
    const firstTick = ticks[0]?.sequence
    const lastTick = ticks[ticks.length - 1]?.sequence
    const readEvents = async () => {
      const values: ReplayRunEvent[] = []
      let total = Infinity
      while (values.length < total && !stopped) {
        const page = await fetchReplayRunEvents(run.id, values.length, 5000, controller.signal, firstTick, lastTick)
        total = page.total
        values.push(...page.values)
        if (!page.values.length) break
      }
      if (!stopped) setEvents(values)
    }
    void readEvents().catch(reason => {
      if (!stopped) setError(reason instanceof Error ? reason.message : 'Nie mogę odczytać dziennika symulacji.')
    })
    return () => { stopped = true; controller.abort() }
  }, [run?.id, run?.status, ticks])

  const refreshInbox = async () => {
    try { setInbox(await fetchReplayInbox()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie mogę odczytać folderu eksportów.') }
  }
  useEffect(() => { if (importSource === 'file') void refreshInbox() }, [importSource])

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
      if (importSource === 'file' && (!fileName || !Number.isInteger(Number(utcOffset)) || Math.abs(Number(utcOffset)) > 840)) throw new Error('Wybierz plik ticków i poprawne przesunięcie czasu eksportu względem UTC.')
      const started = await startReplayImport({ symbol: symbol.trim(), fromMs, toMs, fileName: importSource === 'file' ? fileName : undefined, utcOffsetMinutes: importSource === 'file' ? Number(utcOffset) : undefined })
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

  const selectStrategy = async (strategyId: string) => {
    const generation = ++strategyGeneration.current
    setSelectedStrategyId(strategyId)
    const strategy = strategies.find(item => item.id === strategyId)
    if (!strategy) return
    setError('')
    try {
      const saved = await fetchReplayStrategySource(strategyId)
      if (generation !== strategyGeneration.current) return
      setStrategyName(saved.name)
      setStrategySource(saved.source)
      setSelectedStrategyId(saved.api_version === 2 ? strategyId : '')
      setRun(null)
      setEvents([])
      if (saved.api_version !== 2) setError('Luna › Stary skrypt wczytany do edytora. Zapisz go jako nową wersję API v2, aby uruchomić symulację.')
    } catch (reason) {
      if (generation !== strategyGeneration.current) return
      setSelectedStrategyId('')
      setError(reason instanceof Error ? reason.message : 'Nie mogę wczytać źródła starego skryptu.')
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
    const startBalance = Number(initialBalance)
    const selectedLeverage = Number(leverage)
    if (!Number.isFinite(startBalance) || startBalance <= 0 || !Number.isFinite(selectedLeverage) || !Number.isInteger(selectedLeverage) || selectedLeverage < 1 || selectedLeverage > 100_000) {
      setError('Podaj dodatnie saldo początkowe i dźwignię z zakresu 1–100000.')
      return
    }
    params.initial_balance = startBalance
    params.leverage = selectedLeverage
    params.account_currency = depositCurrency === '—' ? '' : depositCurrency
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

  const cachedPage = (archiveId: string, offset: number) => {
    const key = archiveId + ':' + offset
    let result = pageCache.current.get(key)
    if (!result) {
      result = fetchReplayTicks(archiveId, offset, PAGE_SIZE)
      pageCache.current.set(key, result)
      void result.catch(() => { pageCache.current.delete(key) })
      if (pageCache.current.size > 4) pageCache.current.delete(pageCache.current.keys().next().value!)
    }
    return result
  }

  useEffect(() => {
    if (!ticks.length || !selectedArchiveId) return
    if (tickPageOffset + ticks.length < (selectedArchive?.tick_count ?? 0)) void cachedPage(selectedArchiveId, tickPageOffset + PAGE_STRIDE).catch(() => {})
    if (tickPageOffset > 0) void cachedPage(selectedArchiveId, Math.max(0, tickPageOffset - PAGE_STRIDE)).catch(() => {})
  }, [ticks, tickPageOffset, selectedArchiveId])

  useEffect(() => () => { pageGeneration.current++; strategyGeneration.current++ }, [])

  const loadTickPage = async (archiveId: string, offset: number, sequence = offset) => {
    const generation = ++pageGeneration.current
    setLoadingTicks(true)
    setPlaying(false)
    setPageTransition(null)
    setError('')
    try {
      const page = await cachedPage(archiveId, offset)
      if (generation !== pageGeneration.current) return
      setTicks(page.values)
      setTickPageOffset(page.offset)
      setCursorIndex(Math.max(0, Math.min(page.values.length - 1, sequence - page.offset)))
    } catch (reason) {
      if (generation === pageGeneration.current) setError(reason instanceof Error ? reason.message : 'Nie udało się otworzyć strony ticków.')
    } finally { if (generation === pageGeneration.current) setLoadingTicks(false) }
  }

  const stepCandle = (direction: 1 | -1) => {
    const currentTime = ticks[cursorIndex]?.time_msc
    if (currentTime === undefined) return
    const currentBucket = Math.floor(currentTime / replayIntervals[chartInterval])
    let index = cursorIndex + direction
    while (index >= 0 && index < ticks.length && Math.floor(ticks[index].time_msc / replayIntervals[chartInterval]) === currentBucket) index += direction
    if (index >= 0 && index < ticks.length) { setPlaying(false); setCursorIndex(index) }
  }

  useEffect(() => {
    if (!playing || !ticks.length) return
    let frame = 0
    let lastFrame = performance.now()
    let lastPaint = lastFrame
    let playhead = ticks[cursorRef.current]?.time_msc ?? ticks[0].time_msc
    const advance = (now: number) => {
      // 1x means one second of recorded market time per wall-clock second.
      // It is independent of tick density; binary search is O(log window size).
      playhead += (now - lastFrame) * playSpeed * playDirection
      lastFrame = now
      if (now - lastPaint >= 33) {
        lastPaint = now
        const index = replayCursorAt(ticks, playhead, playDirection)
        setCursorIndex(index)
        const outside = playDirection > 0 ? playhead >= ticks[ticks.length - 1].time_msc : playhead <= ticks[0].time_msc
        if (outside) {
          const adjacent = playDirection > 0 ? tickPageOffset + ticks.length < (selectedArchive?.tick_count ?? 0) : tickPageOffset > 0
          setPlaying(false)
          if (adjacent) setPageTransition({ archiveId: selectedArchiveId, offset: playDirection > 0 ? tickPageOffset + PAGE_STRIDE : Math.max(0, tickPageOffset - PAGE_STRIDE), direction: playDirection, sequence: ticks[index].sequence })
          return
        }
      }
      frame = requestAnimationFrame(advance)
    }
    frame = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frame)
  }, [playing, ticks, tickPageOffset, selectedArchiveId, selectedArchive?.tick_count, playSpeed, playDirection])

  useEffect(() => {
    if (!pageTransition) return
    let stopped = false
    const { archiveId, offset, sequence } = pageTransition
    const generation = ++pageGeneration.current
    const continuePlayback = async () => {
      setLoadingTicks(true)
      setError('')
      try {
        const page = await cachedPage(archiveId, offset)
        if (stopped || generation !== pageGeneration.current) return
        setTicks(page.values)
        setTickPageOffset(page.offset)
        setCursorIndex(Math.max(0, Math.min(page.values.length - 1, sequence - page.offset)))
        if (page.values.length > 0) setPlaying(true)
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : 'Nie udało się przejść do kolejnej porcji ticków.')
      } finally {
        if (!stopped) {
          setLoadingTicks(false)
          setPageTransition(null)
        }
      }
    }
    void continuePlayback()
    return () => { stopped = true }
  }, [pageTransition])

  return <div className="fx-replay-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="fx-replay-window" role="dialog" aria-modal="true" aria-labelledby="fx-replay-title">
      <header className="fx-replay-header">
        <div><small>CRT // LOCAL MARKET LAB</small><h2 id="fx-replay-title">FX REPLAY</h2><p>Rzeczywiste ticki · lokalne skrypty Python · symulowane transakcje</p></div>
        <button type="button" className="fx-replay-close" aria-label="Zamknij FX Replay" onClick={onClose}>×</button>
      </header>
      <div className="fx-replay-content fx-replay-content--workspace">
        <form className="fx-replay-import" onSubmit={beginImport}>
          <div className="fx-replay-section-title"><span>01</span> NOWY IMPORT</div>
          <label>ŹRÓDŁO HISTORII<select value={importSource} disabled={!!activeJob} onChange={event => setImportSource(event.target.value)}><option value="mt5">Historia w MT5</option><option value="file">Eksport ticków z folderu</option></select></label>
          {importSource === 'file' && <>
            <p className="fx-replay-note">Luna › Umieść eksport z zakładki Ticki MT5 w folderze: <span style={{ overflowWrap: 'anywhere' }}>{inbox.folder || 'Odczytuję folder…'}</span></p>
            <label>PLIK TICKÓW<select value={fileName} onChange={event => setFileName(event.target.value)}><option value="">Wybierz plik CSV / TSV</option>{inbox.values.map(file => <option key={file.name} value={file.name}>{file.name} · {(file.bytes / 1024 / 1024).toFixed(1)} MB</option>)}</select></label>
            <div className="fx-replay-actions"><button type="button" className="secondary" onClick={() => void refreshInbox()}>ODŚWIEŻ FOLDER</button></div>
            <label>CZAS EKSPORTU · PRZESUNIĘCIE OD UTC W MINUTACH<input type="number" min="-840" max="840" step="1" value={utcOffset} onChange={event => setUtcOffset(event.target.value)} /></label>
            <p className="fx-replay-note">UTC: 0; UTC+2: 120. Wskaż dokładny symbol źródłowy. CSV nie zapisuje nazwy brokera; nie rozpoznaję jej automatycznie. Plik świec OHLC nie nadaje się do testu na rzeczywistych tickach.</p>
          </>}
          <label>SYMBOL BROKERA<input value={symbol} maxLength={64} onChange={event => setSymbol(event.target.value)} placeholder="np. XAUUSD.a" /></label>
          <div className="fx-replay-range">
            <label>OD<input type="datetime-local" value={fromTime} onChange={event => setFromTime(event.target.value)} /></label>
            <label>DO<input type="datetime-local" value={toTime} onChange={event => setToTime(event.target.value)} /></label>
          </div>
          <div className="fx-replay-data-mode"><span>TRYB TESTU</span><b>RZECZYWISTE TICKI MT5 · BID / ASK</b><small>Zapisujemy rzeczywiste ticki; nie generujemy ich ze świec OHLC.</small></div>
          <p className="fx-replay-note">Luna › MT5 dostarcza historię lub samą specyfikację symbolu przy imporcie pliku. Daty poniżej są w Twoim czasie lokalnym, archiwum zapiszę w UTC. Gotowe dane wykorzystasz offline.</p>
          <div className="fx-replay-actions">
            <button type="submit" disabled={busy || !!activeJob}>{busy ? 'ŁĄCZĘ Z MT5…' : 'IMPORTUJ TICKI'}</button>
            {activeJob && <button type="button" className="secondary" disabled={job?.status !== 'importing'} onClick={() => void stopImport()}>{job?.status === 'finalizing' ? 'FINALIZUJĘ ARCHIWUM…' : 'ANULUJ IMPORT'}</button>}
          </div>
          {job && <div className={'fx-replay-job fx-replay-job--' + job.status} role="status" aria-live="polite">
            <div><b>{job.status === 'complete' ? job.reused ? 'Luna › Ten zakres jest już w archiwum. Używam zapisanych ticków.' : 'Luna › Archiwum gotowe.' : job.status === 'failed' ? 'Luna › Import zatrzymał się z błędem.' : job.status === 'cancelled' ? 'Luna › Import anulowany.' : job.status === 'finalizing' ? 'Luna › Zapisuję sumę kontrolną archiwum…' : 'Luna › Pobieram ticki z MT5…'}</b><span>{job.symbol} · {job.tick_count.toLocaleString('pl-PL')} ticków</span></div>
            {activeJob && <><progress max="100" value={job.progress} /><span>{job.stage === 'file_read' ? 'Czytam eksport ticków z dysku…' : job.stage === 'mt5_fetch' ? `MT5 pobiera ${job.range_from_ms ? showTime(job.range_from_ms) : ''} → ${job.range_to_ms ? showTime(job.range_to_ms) : ''}` : (job.stage === 'sqlite_write' || job.stage === 'archive_write') ? 'Zapisuję pobrane ticki do lokalnego archiwum…' : job.stage === 'sha256_finalize' ? 'Kończę sumę kontrolną bez ponownego skanowania archiwum…' : `Zakres: ${job.progress}% · do ${showTime(job.completed_through_ms)}`} · {Number(job.ticks_per_second || 0).toLocaleString('pl-PL')} tick/s</span><small>Ostatnia porcja · MT5 {Number(job.last_chunk_fetch_ms || 0)} ms · zapis {Number(job.last_chunk_write_ms || 0)} ms</small></>}
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
            {archive.status === 'complete' && archive.manifest.source === 'MetaTrader5.copy_ticks_range' && archive.manifest.mt5_range_boundary_policy !== 'enclosing_seconds_filter_ms_v1' && <p className="fx-replay-note">Luna › Starszy importer mógł pomijać ticki na końcu porcji. To archiwum nadal odtworzysz; przed dokładnym testem pobierz ten zakres ponownie.</p>}
            {archive.status === 'complete' && <div className="fx-replay-archive-actions"><button type="button" className="fx-replay-select" disabled={loadingTicks || !!pageTransition} onClick={() => chooseArchive(archive)}>{selectedArchiveId === archive.id ? 'WYBRANE DO SYMULACJI' : 'WYBIERZ ARCHIWUM'}</button><button type="button" className="fx-replay-select" disabled={loadingTicks || !!pageTransition} onClick={() => { chooseArchive(archive); void loadTickPage(archive.id, 0) }}>{loadingTicks ? 'WCZYTUJĘ…' : 'OTWÓRZ ODTWARZACZ'}</button></div>}
          </article>)}
        </section>
        <section className="fx-replay-strategies" aria-labelledby="fx-replay-strategy-title">
          <div className="fx-replay-section-title" id="fx-replay-strategy-title"><span>03</span> SKRYPT STRATEGII <small>PYTHON API v2 · SILNIK 3</small></div>
          <label>NAZWA STRATEGII<input value={strategyName} maxLength={80} onChange={event => setStrategyName(event.target.value)} /></label>
          <label>EDYTOR KODU PYTHON<textarea spellCheck={false} value={strategySource} onChange={event => setStrategySource(event.target.value)} /></label>
          <div className="fx-replay-strategy-actions">
            <button type="button" onClick={() => void addStrategy()} disabled={!strategyName.trim() || !strategySource.trim()}>ZAPISZ SKRYPT</button>
            <label className="fx-replay-select-label">ZAPISANY SKRYPT<select value={selectedStrategyId} onChange={event => void selectStrategy(event.target.value)}><option value="">Wybierz strategię</option>{strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name} · v{strategy.api_version}{strategy.api_version !== 2 ? ' · wczytaj do migracji' : ''}</option>)}</select></label>
          </div>
          <div className="fx-replay-account-settings" aria-label="Ustawienia rachunku testowego">
            <label>SALDO STARTOWE<input type="number" min="0.01" step="any" value={initialBalance} onChange={event => setInitialBalance(event.target.value)} /></label>
            <label>DŹWIGNIA<select value={leverage} onChange={event => setLeverage(event.target.value)}>{[1, 2, 5, 10, 20, 30, 50, 100, 200, 500, 1000].map(value => <option key={value} value={value}>1:{value}</option>)}{!([1, 2, 5, 10, 20, 30, 50, 100, 200, 500, 1000].includes(Number(leverage))) && <option value={leverage}>1:{leverage} · własna</option>}</select></label>
            <span>WALUTA DEPOZYTU <b>{depositCurrency}</b></span>
          </div>
          <label>PARAMETRY JSON<textarea className="fx-replay-params" spellCheck={false} value={paramsText} onChange={event => setParamsText(event.target.value)} /></label>
          <p className="fx-replay-note">Luna › Ustawienia konta startują z migawki MT5 zapisanej przy imporcie. Margin jest szacowany z brokerowego wyliczenia dla bieżącego symbolu; historyczne przewalutowanie, swap i stop-out nie są odtwarzane. Model pozycji: hedging. Netting i sesje handlu nie są jeszcze odtwarzane. EMA/ATR używają modelu mt5; JSON indicator_model: legacy_v2 przywraca dawne wzory. BUY/SELL używają Ask/Bid. Symulacja nie wysyła zleceń do MT5.</p>
          <div className="fx-replay-actions">
            <button type="button" disabled={!selectedArchiveId || !selectedStrategyId || selectedStrategy?.api_version !== 2 || !!run && ['queued', 'running'].includes(run.status)} onClick={() => void simulate()}>URUCHOM SYMULACJĘ</button>
            {run && ['queued', 'running'].includes(run.status) && <button type="button" className="secondary" onClick={() => void cancelRun()}>ANULUJ</button>}
          </div>
          {run && <div className={'fx-replay-job fx-replay-job--' + run.status} role="status" aria-live="polite">
            <div><b>{run.status === 'complete' ? 'Luna › Symulacja zakończona.' : run.status === 'failed' ? 'Luna › Skrypt zakończył się błędem.' : run.status === 'cancelled' ? 'Luna › Symulacja anulowana.' : 'Luna › Przetwarzam ticki…'}</b><span>{run.progress_ticks.toLocaleString('pl-PL')} / {run.total_ticks.toLocaleString('pl-PL')}</span></div>
            {['queued', 'running'].includes(run.status) && <progress max={Math.max(1, run.total_ticks)} value={run.progress_ticks} />}
            {run.error && <small>{run.error}</small>}
            {run.report && <div className="fx-replay-metrics"><span>Model wskaźników <b>{String(run.report.indicator_model || 'legacy_v2')}</b></span><span>Zgodność z testerem MT5 <b>NIEPOTWIERDZONA</b></span><span>Zamknięcia <b>{String(run.report.closed_exits ?? 0)}</b></span><span>Dodatnie <b>{String(run.report.winning_exits ?? 0)}</b></span><span>Ujemne <b>{String(run.report.losing_exits ?? 0)}</b></span><span>Ruch ceny ważony punktami <b>{Number(run.report.net_points_volume ?? 0).toLocaleString('pl-PL')}</b></span><span>Wynik {String(run.report.account_currency || '')} <b>{run.report.realized_pnl_account_currency_estimate == null ? 'N/D · brak danych ticka' : Number(run.report.realized_pnl_account_currency_estimate).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}</b></span><span>Max obsunięcie {String(run.report.account_currency || '')} <b>{run.report.max_drawdown_account_currency_estimate == null ? 'N/D' : Number(run.report.max_drawdown_account_currency_estimate).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}</b></span><span>Dźwignia / start <b>1:{String(run.report.leverage ?? '—')} · {Number(run.report.initial_balance ?? 0).toLocaleString('pl-PL')} {String(run.report.account_currency || '')}</b></span><span>Szczyt margin <b>{run.report.peak_margin_used_estimate == null ? 'N/D · brak kalibracji MT5' : Number(run.report.peak_margin_used_estimate).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}</b></span><span>Najniższy wolny margin <b>{run.report.minimum_free_margin_estimate == null ? 'N/D' : Number(run.report.minimum_free_margin_estimate).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}</b></span><span>Odrzucone przez margin <b>{String(run.report.rejected_orders ?? 0)}</b></span></div>}
          </div>}
          {events.length > 0 && <div className="fx-replay-events"><div className="fx-replay-section-title"><span>04</span> DZIENNIK ZDARZEŃ <small>WIDOCZNY FRAGMENT · {events.length} ZDARZEŃ</small></div><div className="fx-replay-event-list">{events.filter(event => Number(event.tick_sequence) <= (ticks[cursorIndex]?.sequence ?? Infinity)).slice(-500).map(event => <div key={event.sequence} className={'fx-replay-event fx-replay-event--' + event.kind}><time>{showTime(event.time_msc)}</time><b>{event.kind.toUpperCase()}</b><span>{String(event.side || event.reason || '')}</span><span>{Number(event.price || 0).toLocaleString('pl-PL')}</span>{event.points !== undefined && <strong>{Number(event.points).toFixed(1)} pkt</strong>}</div>)}</div></div>}
        </section>
        {ticks.length > 0 ? <section className="fx-replay-player" aria-label="Odtwarzacz ticków FX Replay">
          <div className="fx-replay-section-title"><span>05</span> ODTWARZACZ TICKÓW <small>{selectedArchive?.symbol || 'ARCHIWUM'} · {tickPageOffset + cursorIndex + 1} / {selectedArchive?.tick_count}</small></div>
          <div className="fx-replay-player-readout"><strong>Bid {ticks[cursorIndex]?.bid.toLocaleString('pl-PL')}</strong><strong>Ask {ticks[cursorIndex]?.ask.toLocaleString('pl-PL')}</strong><span>{showTime(ticks[cursorIndex]?.time_msc || 0)}. {String(ticks[cursorIndex]?.time_msc || 0).slice(-3)}</span><label>ŚWIECA<select value={chartInterval} onChange={event => setChartInterval(event.target.value)}>{Object.keys(replayIntervals).map(value => <option key={value}>{value}</option>)}</select></label></div>
          <ReplayPriceChart ticks={ticks} cursor={cursorIndex} events={events} intervalMs={replayIntervals[chartInterval]} />
          <input className="fx-replay-timeline" aria-label="Pozycja odtwarzania w całym archiwum" type="range" min="0" max={Math.max(0, (selectedArchive?.tick_count ?? 1) - 1)} value={tickPageOffset + cursorIndex} disabled={loadingTicks || !!pageTransition} onChange={event => {
            const sequence = Number(event.target.value)
            setPlaying(false)
            if (sequence >= tickPageOffset && sequence < tickPageOffset + ticks.length) setCursorIndex(sequence - tickPageOffset)
            else void loadTickPage(selectedArchiveId, Math.max(0, Math.floor(sequence / PAGE_STRIDE) * PAGE_STRIDE - 10_000), sequence)
          }} />
          <div className="fx-replay-player-controls">
            <button type="button" disabled={loadingTicks || tickPageOffset <= 0} onClick={() => void loadTickPage(selectedArchiveId, Math.max(0, tickPageOffset - PAGE_STRIDE))}>POPRZEDNIA PORCJA</button>
            <button type="button" disabled={loadingTicks || !!pageTransition || cursorIndex <= 0} onClick={() => { setPlaying(false); setCursorIndex(index => Math.max(0, index - 1)) }}>‹ TICK</button>
            <button type="button" disabled={loadingTicks || !!pageTransition || cursorIndex <= 0} onClick={() => stepCandle(-1)}>‹ ŚWIECA</button>
            <button type="button" className="play" disabled={loadingTicks || !!pageTransition || ticks.length < 2} onClick={() => { if (playing && playDirection === 1) setPlaying(false); else { setPlayDirection(1); setPlaying(true) } }}>{playing && playDirection === 1 ? 'PAUZA' : 'ODTWÓRZ ▶'}</button>
            <button type="button" className="rewind" disabled={loadingTicks || !!pageTransition || ticks.length < 2} onClick={() => { if (playing && playDirection === -1) setPlaying(false); else { setPlayDirection(-1); setPlaying(true) } }}>{playing && playDirection === -1 ? 'PAUZA' : '◀ COFAJ'}</button>
            <button type="button" disabled={loadingTicks || !!pageTransition || cursorIndex >= ticks.length - 1} onClick={() => stepCandle(1)}>ŚWIECA ›</button>
            <button type="button" disabled={loadingTicks || !!pageTransition || cursorIndex >= ticks.length - 1} onClick={() => { setPlaying(false); setCursorIndex(index => Math.min(ticks.length - 1, index + 1)) }}>TICK ›</button>
            <button type="button" disabled={loadingTicks || tickPageOffset + ticks.length >= (selectedArchive?.tick_count || 0)} onClick={() => void loadTickPage(selectedArchiveId, tickPageOffset + PAGE_STRIDE, tickPageOffset + ticks.length)}>NASTĘPNA PORCJA</button>
            <label>TEMPO<select value={playSpeed} onChange={event => setPlaySpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={5}>5×</option><option value={20}>20×</option><option value={100}>100×</option><option value={1000}>1000×</option></select></label>
          </div>
          <p className="fx-replay-note">Luna › Tempo odnosi się do rzeczywistego czasu rynku. Suwak obejmuje całe archiwum; sąsiednie fragmenty wczytuję z wyprzedzeniem. Przerwy sesji pozostają w osi czasu. Wyniki zamknięć podaję w punktach brokera.</p>
        </section> : <section className="fx-replay-player fx-replay-player--empty" aria-label="Okno wizualnego odtwarzania FX Replay">
          <div className="fx-replay-section-title"><span>00</span> OKNO ODTWARZANIA <small>CRT // FX REPLAY</small></div>
          <div className="fx-replay-empty-monitor"><div className="fx-replay-empty-monitor__frame"><span>TRYB OFFLINE // GOTOWY</span><strong>WYBIERZ ARCHIWUM</strong><p>Otwórz zapisane ticki z panelu po prawej, aby rozpocząć wizualną powtórkę.</p><i aria-hidden="true">▌</i></div></div>
          <div className="fx-replay-empty-readout"><span>BID <b>—</b></span><span>ASK <b>—</b></span><span>UTC <b>—</b></span><span>POZYCJA <b>OCZEKUJE</b></span></div>
        </section>}
      </div>
    </section>
  </div>
}
