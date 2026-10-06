import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type UTCTimestamp,
} from 'lightweight-charts'
import { createMarketChart } from './chart/createMarketChart'
import { fetchMt5Bars, type Mt5Account, type Mt5MarketSession, type Mt5SymbolInfo } from './mt5Client'
import { useChartIndicators, type IndicatorSeriesEntry } from './hooks/useChartIndicators'
import { useChartDrawingInteractions } from './hooks/useChartDrawingInteractions'
import { getIndicatorBars } from './indicators/chartBars'
import { drawingLogicalAtTime, fibonacciRetracementPrice } from './domain/drawingGeometry'
import { PositionPlannerPrimitive, plannerLogicalToCoordinate, type PlannerPrimitiveHit } from './positionPlannerPrimitive'
import type { AlertRule, BreakEvenMode, MarketProfile } from './domain/contracts'
import type { ReferenceLevel } from './domain/referenceLevels'
import { snapToSymbolTick, translatePlannerGeometry, type PricePrecision } from './domain/plannerGeometry'
import { DRAWING_POINT_COUNTS, type ChartAnnotation, type ChartAnnotationKind, type ChartDrawingPoint, type ChartDrawingStore } from './domain/chartDrawings'
import {
  clampLots,
  clampPlannerLevel,
  createPlannerAtPrice,
  type PlannerAccountingValues,
  type PlannerLevel,
  type PlannerSide,
  type PlannerState,
  type PlannerVolumeConstraints,
} from './domain/chartPlanner'
import type { IndicatorId, IndicatorSettings } from './indicators/catalog'
import type { IndicatorBar } from './indicators/calculations'
import type { VegaTradeProposal } from './engines/vegaContext'
import { PlannerControlPanel } from './PlannerControlPanel'

export type { IndicatorSettings } from './indicators/catalog'

export type ChartTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1'
type PlannerTargetSelection = 'tp1' | 'tp2' | 'tp3'
export type PlannerSnapshot = { side: PlannerSide; entry: number; tp: number; tp1?: number; tp2?: number; tp3?: number; breakEven?: number; sl: number; lots: number }
export type ManagedPositionHighlight = { id: number; symbol: string; side: PlannerSide; volume: number; entry: number; stopLoss: number; takeProfit: number; currentPrice?: number }
export type ManagedOrderHighlight = { id: number; symbol: string; trigger: number }
export type MarketFeedStatus = 'connecting' | 'history' | 'live' | 'closed' | 'stale' | 'error'
export type MarketProfileView = { showTpo: boolean; showPoc: boolean; showValueArea: boolean; density: number; widthPct: number; position: 'left' | 'right' }

export type MarketFeedState = {
  status: MarketFeedStatus
  source: 'MT5'
  mode: 'local'
  lastTickAt: number | null
  symbol?: string
  account?: Mt5Account
  symbolInfo?: Mt5SymbolInfo
  message?: string
  lastPrice?: number
  bid?: number
  ask?: number
  marketSession?: Mt5MarketSession
}

const TIMEFRAME_MINUTES: Record<ChartTimeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
}

export type { PlannerSide } from './domain/chartPlanner'

type PlannerTimeRange = {
  start: number
  end: number
}


const DRAWINGS_STORAGE_KEY = 'smartflow-x:drawings:v1'

function isStoredChartAnnotation(value: unknown): value is ChartAnnotation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChartAnnotation>
  return typeof candidate.id === 'string'
    && typeof candidate.kind === 'string'
    && Object.prototype.hasOwnProperty.call(DRAWING_POINT_COUNTS, candidate.kind)
    && Array.isArray(candidate.points)
    && candidate.points.length === DRAWING_POINT_COUNTS[candidate.kind as ChartAnnotationKind]
    && candidate.points.every((point) => point && Number.isFinite(Number(point.time)) && Number.isFinite(point.price))
    && (candidate.label === undefined || typeof candidate.label === 'string')
}

function readChartDrawingStore(): ChartDrawingStore {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DRAWINGS_STORAGE_KEY) || '{}') as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const store: ChartDrawingStore = {}
    for (const [scope, items] of Object.entries(parsed)) {
      if (Array.isArray(items)) store[scope] = items.filter(isStoredChartAnnotation).slice(-500)
    }
    return store
  } catch {
    return {}
  }
}

function writeChartDrawingStore(store: ChartDrawingStore) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify(store)) } catch { /* drawings remain available for this session if storage is unavailable */ }
}

function pricePrecision(info?: Mt5SymbolInfo): PricePrecision {
  return { digits: info?.digits ?? 2, tickSize: info?.trade_tick_size || info?.point || 0.01 }
}

function plannerAccountingValues(info?: Mt5SymbolInfo): PlannerAccountingValues | undefined {
  if (!info) return undefined
  return {
    tickSize: info.trade_tick_size || info.point || 0.01,
    profitTickValue: info.trade_tick_value_profit || info.trade_tick_value || 0,
    lossTickValue: info.trade_tick_value_loss || info.trade_tick_value || 0,
  }
}

function plannerVolumeConstraints(info?: Mt5SymbolInfo): PlannerVolumeConstraints | undefined {
  if (!info) return undefined
  return {
    min: info.volume_min || 0.01,
    max: info.volume_max || 100,
    step: info.volume_step || 0.01,
  }
}

function formatSymbolPrice(price: number, info?: Mt5SymbolInfo) {
  return price.toFixed(info?.digits ?? 2)
}

function feedLabel(feed: MarketFeedState) {
  if (feed.status === 'live') return 'MT5 · NA ŻYWO'
  if (feed.status === 'closed') return 'MT5 · RYNEK ZAMKNIĘTY'
  if (feed.status === 'history') return 'MT5 · HISTORIA'
  if (feed.status === 'stale') return 'MT5 · NIEAKTUALNY'
  if (feed.status === 'error') return 'MT5 · NIEDOSTĘPNY'
  return 'MT5 · ŁĄCZENIE'
}

function feedStatusForQuote(quoteAgeMs: number, session: Mt5MarketSession): MarketFeedStatus {
  if (session.available && session.quote_open === false) return 'closed'
  return quoteAgeMs <= 15000 ? 'live' : quoteAgeMs <= 120000 ? 'history' : 'stale'
}

export function MarketChart({
  timeframe,
  symbol = 'XAUUSD',
  plannerRequest,
  plannerLevelRequest,
  onPlannerLevelPlacementComplete,
  vegaProposal = null,
  drawingRequest,
  plannerTargets = { tp1: false, tp2: false, tp3: false },
  plannerTargetProfitLabels = [],
  plannerFullTpProfitLabel,
  plannerFullSlLossLabel,
  breakEvenMode = 'manual',
  managedPosition = null,
  managedOrder = null,
  cancelRequest,
  onPlannerChange,
  onPlannerPlaced,
  onBarsChange,
  onDrawingComplete,
  volumeVisible = true,
  compactFeedStatus = false,
  indicators = [],
  indicatorSettings = {},
  marketProfile = null,
  marketProfileView = { showTpo: true, showPoc: true, showValueArea: true, density: 4, widthPct: 18, position: 'right' },
  referenceLevels = [],
  navigationControlsExternal = false,
  autoScrollEnabled,
  onAutoScrollChange,
  chartShiftEnabled,
  onChartShiftChange,
  alerts = [],
  onAlertSelect,
  onFeedStateChange,
  simulationTickId = 0,
  rangeScanId = 0,
  rangeScanDetected = false,
}: {
  timeframe: ChartTimeframe
  symbol?: string
  plannerRequest?: { side: PlannerSide; nonce: number; proposal?: { entry: number; sl: number; tp: number } } | null
  plannerLevelRequest?: { target: PlannerTargetSelection; nonce: number } | null
  onPlannerLevelPlacementComplete?: (nonce: number) => void
  vegaProposal?: VegaTradeProposal | null
  drawingRequest?: { tool: string; nonce: number; label?: string } | null
  plannerTargets?: { tp1?: boolean; tp2: boolean; tp3: boolean }
  plannerTargetProfitLabels?: Array<string | null>
  plannerFullTpProfitLabel?: string | null
  plannerFullSlLossLabel?: string | null
  breakEvenMode?: BreakEvenMode
  managedPosition?: ManagedPositionHighlight | null
  managedOrder?: ManagedOrderHighlight | null
  cancelRequest?: { nonce: number } | null
  onPlannerChange?: (planner: PlannerSnapshot | null) => void
  onPlannerPlaced?: () => void
  onBarsChange?: (bars: Array<{ time: number; open: number; high: number; low: number; close: number; tickVolume?: number }>) => void
  onDrawingComplete?: (result: 'saved' | 'tools') => void
  volumeVisible?: boolean
  compactFeedStatus?: boolean
  indicators?: IndicatorId[]
  indicatorSettings?: IndicatorSettings
  marketProfile?: MarketProfile | null
  marketProfileView?: MarketProfileView
  referenceLevels?: ReferenceLevel[]
  navigationControlsExternal?: boolean
  autoScrollEnabled?: boolean
  onAutoScrollChange?: (enabled: boolean) => void
  chartShiftEnabled?: boolean
  onChartShiftChange?: (enabled: boolean) => void
  alerts?: AlertRule[]
  onAlertSelect?: (alertId: string) => void
  onFeedStateChange?: (state: MarketFeedState) => void
  simulationTickId?: number
  rangeScanId?: number
  rangeScanDetected?: boolean
}) {
  const drawingScope = `${symbol.trim().toUpperCase()}|${timeframe}`

  const rootRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const plannerGestureCleanupRef = useRef<((cancel?: boolean, notify?: boolean) => void) | null>(null)
  const currentBarRef = useRef<CandlestickData<UTCTimestamp> | null>(null)
  const plannerRef = useRef<PlannerState | null>(null)
  const plannerTimeRef = useRef<PlannerTimeRange | null>(null)
  const plannerSideRef = useRef<PlannerSide | null>(null)
  const plannerPrimitiveRef = useRef<PositionPlannerPrimitive | null>(null)
  const syncPlannerPrimitiveRef = useRef<() => void>(() => {})
  const autoScrollRef = useRef(true)
  const chartInteractionLockedRef = useRef(false)
  const profileLinesRef = useRef<any[]>([])
  const referenceLevelLinesRef = useRef<any[]>([])
  const alertLinesRef = useRef<any[]>([])
  const managementLinesRef = useRef<any[]>([])
  const indicatorSeriesRef = useRef<IndicatorSeriesEntry[]>([])
  const volumeSeriesRef = useRef<any>(null)
  const volumeDataRef = useRef<Array<{ time: UTCTimestamp; value: number; color: string }>>([])

  const [data, setData] = useState<CandlestickData<UTCTimestamp>[]>([])
  const [volumeData, setVolumeData] = useState<Array<{ time: UTCTimestamp; value: number; color: string }>>([])
  const [loadedBars, setLoadedBars] = useState(0)
  const [drawingStore, setDrawingStore] = useState<ChartDrawingStore>(() => readChartDrawingStore())
  const chartAnnotations = drawingStore[drawingScope] ?? []
  const setChartAnnotations = (update: ChartAnnotation[] | ((current: ChartAnnotation[]) => ChartAnnotation[])) => {
    setDrawingStore((current) => {
      const existing = current[drawingScope] ?? []
      const next = typeof update === 'function' ? update(existing) : update
      return { ...current, [drawingScope]: next.slice(-500) }
    })
  }
  const [drawingsOpen, setDrawingsOpen] = useState(false)
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null)
  const [confirmClearDrawings, setConfirmClearDrawings] = useState(false)
  useEffect(() => { setSelectedDrawing(null); setConfirmClearDrawings(false); setDrawingsOpen(false) }, [drawingScope])
  useEffect(() => { if (chartAnnotations.length === 0) { setDrawingsOpen(false); setConfirmClearDrawings(false) } }, [chartAnnotations.length])
  const deleteDrawing = (id: string) => { setChartAnnotations(current => current.filter(item => item.id !== id)); if (selectedDrawing === id) setSelectedDrawing(null); setConfirmClearDrawings(false) }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'Escape') { setDrawingsOpen(false); setSelectedDrawing(null); setConfirmClearDrawings(false) }
      if (event.key === 'Delete' && selectedDrawing && drawingsOpen && !drawingRequest) { event.preventDefault(); deleteDrawing(selectedDrawing) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedDrawing, drawingsOpen, drawingRequest, drawingScope])
  const drawingClipId = useId().replace(/:/g, '')
  const drawingKind = drawingRequest && Object.prototype.hasOwnProperty.call(DRAWING_POINT_COUNTS, drawingRequest.tool) ? drawingRequest.tool as ChartAnnotationKind : null
  const drawingInteractions = useChartDrawingInteractions({
    rootRef,
    chartRef,
    candlesRef,
    data,
    timeframe,
    drawingRequest,
    drawingKind,
    setAnnotations: setChartAnnotations,
    onDrawingComplete,
  })
  const {
    drawingRevision,
    drawingAnchors,
    drawingCursor,
    drawingSequenceRef,
    drawingGestureRef,
    drawingActiveRef,
    syncDrawingCoordinates,
    invalidateDrawing,
    resetDrawing,
    handleDrawingMove,
    handleDrawingUp,
  } = drawingInteractions
  const liveHistoryRef = useRef<CandlestickData<UTCTimestamp>[]>([])
  const [lastBar, setLastBar] = useState<CandlestickData<UTCTimestamp> | null>(null)
  const [phosphorPulse, setPhosphorPulse] = useState<{ id: number; time: UTCTimestamp; price: number } | null>(null)
  const pulseElementRef = useRef<HTMLSpanElement>(null)
  const previousCloseRef = useRef<number | null>(null)
  const pulseSequenceRef = useRef(0)
  const handledTickId = useRef(0)
  const [planner, setPlanner] = useState<PlannerState | null>(null)
  const [plannerTime, setPlannerTime] = useState<PlannerTimeRange | null>(null)
  const [plannerSide, setPlannerSide] = useState<PlannerSide | null>(null)
  const [placingSide, setPlacingSide] = useState<PlannerSide | null>(null)
  const [placingTarget, setPlacingTarget] = useState<PlannerTargetSelection | null>(null)
  const [activePlannerLevel, setActivePlannerLevel] = useState<PlannerLevel | null>(null)
  const [movingPlanner, setMovingPlanner] = useState(false)
  const [resizingPlanner, setResizingPlanner] = useState<'left' | 'right' | null>(null)
  const [plannerLots, setPlannerLots] = useState(0.01)
  useEffect(() => { writeChartDrawingStore(drawingStore) }, [drawingStore])
  const [plannerDirty, setPlannerDirty] = useState(false)
  const [localAutoScroll, setLocalAutoScroll] = useState(true)
  const [localChartShift, setLocalChartShift] = useState(true)
  const autoScroll = autoScrollEnabled ?? localAutoScroll
  const chartShift = chartShiftEnabled ?? localChartShift
  const setAutoScroll = (next: boolean) => onAutoScrollChange ? onAutoScrollChange(next) : setLocalAutoScroll(next)
  const setChartShift = (next: boolean) => onChartShiftChange ? onChartShiftChange(next) : setLocalChartShift(next)
  const [chartShiftPercent, setChartShiftPercent] = useState(18)
  const [feed, setFeed] = useState<MarketFeedState>({
    status: 'connecting',
    source: 'MT5',
    mode: 'local',
    lastTickAt: null,
  })

  const publishFeed = (next: MarketFeedState) => {
    setFeed(next)
    onFeedStateChange?.(next)
  }

  const clearPlanner = (force = false) => {
    plannerGestureCleanupRef.current?.(true)
    if (!force && plannerRef.current && plannerDirty && !window.confirm('Anulować edytowany plan? Zmiany w geometrii zostaną utracone.')) return
    plannerRef.current = null
    plannerTimeRef.current = null
    plannerSideRef.current = null
    setPlanner(null)
    setPlannerTime(null)
    setPlannerSide(null)
    setPlacingSide(null)
    setPlacingTarget(null)
    setMovingPlanner(false)
    setResizingPlanner(null)
    setActivePlannerLevel(null)
    setPlannerDirty(false)
  }

  const applyPlannerProposal = (side: PlannerSide, proposal: { entry: number; sl: number; tp: number }) => {
    const chart = chartRef.current
    if (!chart || !data.length) return
    plannerGestureCleanupRef.current?.(true)
    setDrawingsOpen(false)
    const entry = snapToSymbolTick(proposal.entry, pricePrecision(feed.symbolInfo))
    const sl = snapToSymbolTick(proposal.sl, pricePrecision(feed.symbolInfo))
    const tp = snapToSymbolTick(proposal.tp, pricePrecision(feed.symbolInfo))
    if (!(side === 'long' ? sl < entry && tp > entry : tp < entry && sl > entry)) return
    const visible = chart.timeScale().getVisibleLogicalRange()
    const visibleBars = visible ? Math.max(20, Number(visible.to) - Number(visible.from)) : 300
    const widthBars = Math.max(18, Math.round(visibleBars * .22), Math.ceil(180 * visibleBars / Math.max(1, chart.timeScale().width())))
    const start = visible ? Math.round(Number(visible.from) + visibleBars * .56) : Math.max(0, data.length - widthBars)
    const end = start + widthBars
    const next = { tp, tp1: null, tp2: null, tp3: null, be: null, entry, sl }
    plannerRef.current = next
    plannerTimeRef.current = { start, end }
    plannerSideRef.current = side
    setPlanner(next)
    onPlannerPlaced?.()
    setPlannerTime({ start, end })
    setPlannerSide(side)
    setPlannerDirty(false)
    setPlacingSide(null)
    setMovingPlanner(false)
    setResizingPlanner(null)
    setActivePlannerLevel(null)
    requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
  }

  const armPlanner = (side: PlannerSide) => {
    plannerGestureCleanupRef.current?.(true)
    setDrawingsOpen(false)
    plannerRef.current = null
    plannerTimeRef.current = null
    plannerSideRef.current = null
    setPlanner(null)
    setPlannerTime(null)
    setPlannerSide(null)
    setPlacingSide(side)
    setPlacingTarget(null)
    setMovingPlanner(false)
    setResizingPlanner(null)
    setActivePlannerLevel(null)
    setPlannerDirty(false)
  }

  const applyChartNavigationMode = () => {
    const chart = chartRef.current
    const container = containerRef.current
    if (!chart || !container || chartInteractionLockedRef.current) return

    const shiftPixels = chartShift
      ? Math.round(container.clientWidth * (chartShiftPercent / 100))
      : 0

    chart.timeScale().applyOptions({
      rightOffsetPixels: shiftPixels,
      shiftVisibleRangeOnNewBar: autoScroll,
    })

  }

  const syncPlannerPrimitive = () => {
    const primitive = plannerPrimitiveRef.current
    if (!primitive) return

    const currentPlanner = plannerRef.current
    const currentTime = plannerTimeRef.current
    const currentSide = plannerSideRef.current
    const root = rootRef.current

    if (!currentPlanner || !currentTime || !currentSide || !root) {
      primitive.setState(null)
      return
    }

    const style = getComputedStyle(root)
    const readOpacity = (name: string, fallback: number) => {
      const parsed = Number.parseFloat(style.getPropertyValue(name))
      return Number.isFinite(parsed) ? parsed : fallback
    }

    primitive.setState({
      side: currentSide,
      digits: feed.symbolInfo?.digits ?? 2,
      tp: currentPlanner.tp,
      entry: currentPlanner.entry,
      sl: currentPlanner.sl,
      startLogical: currentTime.start,
      endLogical: currentTime.end,
      labelOpacity: readOpacity('--planner-frame-fill', 0.69),
      rewardFill: readOpacity('--planner-reward-fill', 0),
      riskFill: readOpacity('--planner-risk-fill', 0),
      rewardBorder: readOpacity('--planner-reward-border', 0.70),
      riskBorder: readOpacity('--planner-risk-border', 0.70),
      fullTpProfitLabel: plannerFullTpProfitLabel ?? undefined,
      fullSlLossLabel: plannerFullSlLossLabel ?? undefined,
    })
  }
  useEffect(() => {
    previousCloseRef.current = null
    setPhosphorPulse(null)
  }, [symbol, timeframe])
  useEffect(() => {
    if (!lastBar) { previousCloseRef.current = null; return }
    const previous = previousCloseRef.current
    previousCloseRef.current = lastBar.close
    const demo = simulationTickId > handledTickId.current
    handledTickId.current = simulationTickId
    const changed = previous != null && previous !== lastBar.close && feed.status === 'live'
    if ((!demo && !changed) || window.matchMedia('(prefers-reduced-motion: reduce)').matches || rootRef.current?.closest('.dragon-motion-paused')) return
    setPhosphorPulse({ id: ++pulseSequenceRef.current, time: lastBar.time, price: lastBar.close })
  }, [lastBar, simulationTickId, feed.status])
  useEffect(() => {
    if (!phosphorPulse) return
    let frame = 0
    const position = () => {
      const element = pulseElementRef.current, chart = chartRef.current, series = candlesRef.current
      if (element && chart && series) {
        const x = chart.timeScale().timeToCoordinate(phosphorPulse.time)
        const y = series.priceToCoordinate(phosphorPulse.price)
        const visible = x != null && y != null && x >= 0 && x <= chart.timeScale().width() && y >= 0 && y < (rootRef.current?.clientHeight ?? 0)
        element.style.visibility = visible ? 'visible' : 'hidden'
        if (visible) { element.style.left = `${x}px`; element.style.top = `${y}px` }
      }
      frame = requestAnimationFrame(position)
    }
    frame = requestAnimationFrame(position)
    const timer = window.setTimeout(() => setPhosphorPulse(current => current?.id === phosphorPulse.id ? null : current), 700)
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [phosphorPulse])
  // Chart listeners and the MT5 polling loop outlive a React render. Always have
  // them use the latest planner labels instead of restoring a stale FULL TP caption.
  syncPlannerPrimitiveRef.current = syncPlannerPrimitive

  useEffect(() => { syncPlannerPrimitiveRef.current() }, [plannerFullTpProfitLabel, plannerFullSlLossLabel])

  useEffect(() => {
    let cancelled = false
    let retryTimer: number | null = null
    const controller = new AbortController()

    publishFeed({ status: 'connecting', source: 'MT5', mode: 'local', lastTickAt: null })
    setData([])
    liveHistoryRef.current = []
    volumeDataRef.current = []
    setVolumeData([])
    setLoadedBars(0)
    setLastBar(null)
    clearPlanner(true)
    currentBarRef.current = null

    const load = async () => {
      try {
        const payload = await fetchMt5Bars(timeframe, 5000, controller.signal, symbol)
        if (cancelled) return

        const candles = payload.values.map((item) => ({
          time: item.time as UTCTimestamp,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
        }))
        const initialVolumeData = payload.values.map((item) => ({ time: item.time as UTCTimestamp, value: item.tick_volume, color: item.close >= item.open ? 'rgba(15, 211, 255, 0.62)' : 'rgba(255, 53, 166, 0.66)' }))
        volumeDataRef.current = initialVolumeData
        setVolumeData(initialVolumeData)
        onBarsChange?.(payload.values.map((item) => ({ time: item.time, open: item.open, high: item.high, low: item.low, close: item.close, tickVolume: item.tick_volume })))

        if (candles.length === 0) {
          throw new Error('MT5 nie zwrócił żadnych barów dla tego interwału.')
        }

        const newest = candles[candles.length - 1]
        const tickTimeMs = payload.tick.time_msc || payload.tick.time * 1000
        const quoteAgeMs = Math.max(0, Date.now() - tickTimeMs)
        const status = feedStatusForQuote(quoteAgeMs, payload.market_session)

        liveHistoryRef.current = candles
        setData(candles)
        setLoadedBars(payload.loaded_bars)
        setLastBar(newest)
        currentBarRef.current = newest

        publishFeed({
          status,
          source: 'MT5',
          mode: 'local',
          lastTickAt: Math.floor(tickTimeMs / 1000),
          symbol: payload.symbol,
          account: payload.account,
          symbolInfo: payload.symbol_info,
          marketSession: payload.market_session,
          lastPrice: payload.symbol_info.chart_mode === 1 ? payload.tick.last : payload.tick.bid,
          bid: payload.tick.bid,
          ask: payload.tick.ask,
          message: status === 'closed'
            ? 'Rynek jest zamknięty według godzin sesji symbolu u brokera.'
            : status === 'stale'
              ? payload.market_session.available
                ? 'Sesja jest otwarta, ale ostatni tick jest nieaktualny.'
                : 'Nie mam grafiku sesji brokera. Ostatni tick jest nieaktualny.'
              : undefined,
        })
      } catch (error) {
        if (cancelled || controller.signal.aborted) return
        publishFeed({
          status: 'error',
          source: 'MT5',
          mode: 'local',
          lastTickAt: null,
          message: error instanceof Error ? error.message : 'Nie udało się połączyć z lokalnym MT5.',
        })
        retryTimer = window.setTimeout(load, 2000)
      }
    }

    load()

    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      controller.abort()
    }
  }, [timeframe, symbol])

  useEffect(() => {
    if (data.length === 0) return

    const root = rootRef.current
    const container = containerRef.current
    if (!root || !container) return

    let disposed = false
    const pendingAnimationFrames = new Set<number>()
    const scheduleFrame = (callback: FrameRequestCallback) => {
      if (disposed) return
      const frame = window.requestAnimationFrame((timestamp) => {
        pendingAnimationFrames.delete(frame)
        if (!disposed) callback(timestamp)
      })
      pendingAnimationFrames.add(frame)
    }

    const matrixTheme = Boolean(root.closest('.sf-matrix'))
    const { chart, candles, volumes } = createMarketChart({
      container,
      matrixTheme,
      data,
      volumeData,
      volumeVisible,
      priceFormatter: (price) => formatSymbolPrice(price, feed.symbolInfo),
      precision: feed.symbolInfo?.digits ?? 2,
      minMove: feed.symbolInfo?.trade_tick_size || feed.symbolInfo?.point || 0.01,
      hasFreshTick: data.length > 0 && Boolean(feed.lastTickAt),
    })
    volumeSeriesRef.current = volumes
    const plannerPrimitive = new PositionPlannerPrimitive()
    candles.attachPrimitive(plannerPrimitive)
    plannerPrimitiveRef.current = plannerPrimitive
    chartRef.current = chart
    candlesRef.current = candles

    const rightOffsetBars = 5
    const chartWidth = Math.max(900, container.clientWidth)
    const targetBars = Math.max(280, Math.min(360, Math.round(chartWidth / 6.4)))
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, data.length - targetBars),
      to: data.length - 1 + rightOffsetBars,
    })
    scheduleFrame(applyChartNavigationMode)

    const syncAxisRails = () => {
      if (disposed || chartRef.current !== chart) return
      const priceWidth = chart.priceScale('right').width()
      const timeHeight = chart.timeScale().height()
      if (priceWidth > 0) root.style.setProperty('--price-rail-width', `${priceWidth}px`)
      if (timeHeight > 0) root.style.setProperty('--time-rail-height', `${timeHeight}px`)
    }

    let syncScheduled = false
    const scheduleSync = () => {
      if (disposed || syncScheduled) return
      syncScheduled = true
      scheduleFrame(() => {
        syncScheduled = false
        if (chartRef.current !== chart) return
        syncAxisRails()
        syncPlannerPrimitiveRef.current()
      })
    }

    const normalizedWheelPixels = (event: WheelEvent) => {
      const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return raw * 40
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return raw * Math.max(600, container.clientHeight)
      return raw
    }

    const handleMt5Wheel = (event: WheelEvent) => {
      if (chartInteractionLockedRef.current || drawingActiveRef.current) return

      const wheelPixels = normalizedWheelPixels(event)
      if (!Number.isFinite(wheelPixels) || wheelPixels === 0) return

      const timeScale = chart.timeScale()
      const visible = timeScale.getVisibleLogicalRange()
      if (!visible) return

      event.preventDefault()

      const from = Number(visible.from)
      const to = Number(visible.to)
      const visibleBars = Math.max(1, to - from)

      if (event.ctrlKey) {
        // MT5: Ctrl + wheel changes chart scale. Keep the bar under the cursor
        // stable until the dedicated Fixed Chart Position marker is introduced.
        const rect = container.getBoundingClientRect()
        const cursorX = Math.max(0, Math.min(timeScale.width(), event.clientX - rect.left))
        const anchorRatio = timeScale.width() > 0 ? cursorX / timeScale.width() : 0.5
        const zoomFactor = Math.exp(wheelPixels * 0.0018)
        const minBars = Math.max(12, timeScale.width() / 22)
        const maxBars = Math.max(minBars, timeScale.width() / 1.7)
        const nextBars = Math.max(minBars, Math.min(maxBars, visibleBars * zoomFactor))
        const anchorLogical = from + visibleBars * anchorRatio
        const nextFrom = anchorLogical - nextBars * anchorRatio
        const nextTo = nextFrom + nextBars

        timeScale.setVisibleLogicalRange({ from: nextFrom, to: nextTo })
        return
      }

      // MT5 wheel direction: wheel down moves back in history; wheel up moves forward.
      // About 100 wheel pixels ~= one physical notch on Windows, mapped to ~3 bars.
      const shiftBars = Math.max(-18, Math.min(18, (wheelPixels / 100) * 3))
      let nextFrom = from - shiftBars
      let nextTo = to - shiftBars

      if (nextFrom < 0) {
        nextTo -= nextFrom
        nextFrom = 0
      }

      const futureAllowance = Math.max(20, Math.round(visibleBars * 0.35))
      const maxTo = data.length - 1 + futureAllowance
      if (nextTo > maxTo) {
        const correction = nextTo - maxTo
        nextFrom -= correction
        nextTo = maxTo
      }

      timeScale.setVisibleLogicalRange({ from: nextFrom, to: nextTo })
    }

    container.addEventListener('wheel', handleMt5Wheel, { passive: false })

    scheduleSync()
    const scheduleDrawingSync = () => scheduleFrame(() => invalidateDrawing())
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleSync)
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDrawingSync)
    chart.subscribeCrosshairMove(scheduleSync)
    chart.subscribeCrosshairMove(scheduleDrawingSync)
    scheduleDrawingSync()

    const observer = new ResizeObserver(() => { scheduleSync(); scheduleDrawingSync() })
    observer.observe(container)

    return () => {
      disposed = true
      pendingAnimationFrames.forEach((frame) => window.cancelAnimationFrame(frame))
      pendingAnimationFrames.clear()
      container.removeEventListener('wheel', handleMt5Wheel)
      observer.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleSync)
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDrawingSync)
      chart.unsubscribeCrosshairMove(scheduleSync)
      chart.unsubscribeCrosshairMove(scheduleDrawingSync)
      if (plannerPrimitiveRef.current) {
        candles.detachPrimitive(plannerPrimitiveRef.current)
        plannerPrimitiveRef.current = null
      }
      volumeSeriesRef.current = null
      chartRef.current = null
      candlesRef.current = null
      chart.remove()
    }
  }, [data, timeframe])

  useEffect(() => {
    volumeSeriesRef.current?.setData(volumeData)
  }, [volumeData])

  useEffect(() => { volumeSeriesRef.current?.applyOptions({ visible: volumeVisible }) }, [volumeVisible, data])



  useChartIndicators({
    chartRef,
    rootRef,
    seriesRef: indicatorSeriesRef,
    historyRef: liveHistoryRef,
    volumeDataRef,
    data,
    lastBar,
    volumeData,
    indicators,
    indicatorSettings,
  })

  useEffect(() => {
    if (!data.length) return
    const bars = getIndicatorBars(liveHistoryRef.current, lastBar, volumeDataRef.current)
    onBarsChange?.(bars)
    if (rootRef.current) rootRef.current.dataset.liveBarCount = String(bars.length)
  }, [data, lastBar, volumeData, onBarsChange])

  useEffect(() => {
    const series = candlesRef.current
    if (!series) return
    profileLinesRef.current.forEach((line) => series.removePriceLine(line))
    profileLinesRef.current = []
    if (!marketProfile) return
    const levels: Array<readonly [number, string, string]> = []
    if (marketProfileView.showPoc) levels.push([marketProfile.poc, 'POC', '#ff42d1'])
    if (marketProfileView.showValueArea) {
      levels.push([marketProfile.vah, 'VAH', '#13dfff'])
      levels.push([marketProfile.val, 'VAL', '#13dfff'])
    }
    for (const [price, title, color] of levels) {
      profileLinesRef.current.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title }))
    }
  }, [marketProfile, marketProfileView.showPoc, marketProfileView.showValueArea])

  useEffect(() => {
    const series = candlesRef.current
    if (!series) return
    referenceLevelLinesRef.current.forEach((line) => series.removePriceLine(line))
    referenceLevelLinesRef.current = []
    for (const level of referenceLevels) {
      referenceLevelLinesRef.current.push(series.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: level.lineStyle === 'solid' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: level.title,
      }))
    }
    if (rootRef.current) rootRef.current.dataset.referenceLevelCount = String(referenceLevelLinesRef.current.length)
  }, [referenceLevels])

  useEffect(() => {
    const series = candlesRef.current
    if (!series) return
    alertLinesRef.current.forEach((line) => series.removePriceLine(line))
    alertLinesRef.current = []
    const activeSymbol = feed.symbol || symbol
    for (const rule of alerts.filter((item) => item.enabled && item.symbol === activeSymbol)) {
      alertLinesRef.current.push(series.createPriceLine({ price: rule.level, color: 'rgba(255, 183, 76, .9)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: rule.condition.toUpperCase() }))
    }
  }, [alerts, data.length, feed.symbol, symbol])

  useEffect(() => {
    const series = candlesRef.current
    if (!series) return
    managementLinesRef.current.forEach((line) => series.removePriceLine(line))
    managementLinesRef.current = []
    const activeSymbol = feed.symbol || symbol
    const add = (price: number | undefined, title: string, color: string, style = LineStyle.Dashed) => {
      if (!(price && Number.isFinite(price) && price > 0)) return
      managementLinesRef.current.push(series.createPriceLine({ price, color, lineWidth: 2, lineStyle: style, axisLabelVisible: true, title }))
    }
    if (managedPosition && managedPosition.symbol === activeSymbol) {
      add(managedPosition.entry, 'ENTRY · MANAGE', '#55c7ff', LineStyle.Solid)
      add(managedPosition.stopLoss, 'SL · MANAGE', '#ff4ca9')
      add(managedPosition.takeProfit, 'TP · MANAGE', '#27e1cf')
      add(managedPosition.currentPrice, 'CURRENT', '#f0f5ff', LineStyle.Dotted)
    }
    if (managedOrder && managedOrder.symbol === activeSymbol) add(managedOrder.trigger, 'PENDING · TRIGGER', '#ffb84d', LineStyle.Dashed)
  }, [managedPosition, managedOrder, data.length, feed.symbol, symbol])

  useEffect(() => {
    if (data.length === 0) return

    let disposed = false
    let timer: number | null = null
    const controller = new AbortController()
    let recovering = true

    const poll = async () => {
      try {
        const payload = await fetchMt5Bars(timeframe, recovering ? 5000 : 100, controller.signal, symbol)
        if (disposed) return

        const tick = payload.tick
        const tickTimeMs = tick.time_msc || tick.time * 1000
        const quoteAgeMs = Math.max(0, Date.now() - tickTimeMs)
        const status = feedStatusForQuote(quoteAgeMs, payload.market_session)

        // Native MT5 bars are authoritative, including current-bar extrema.
        const merged = new Map(liveHistoryRef.current.map(bar => [Number(bar.time), bar]))
        const volumes = new Map(volumeDataRef.current.map(bar => [Number(bar.time), bar]))
        for (const bar of payload.values) {
          merged.set(bar.time, { time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close })
          volumes.set(bar.time, { time: bar.time as UTCTimestamp, value: bar.tick_volume, color: bar.close >= bar.open ? 'rgba(15, 211, 255, 0.62)' : 'rgba(255, 53, 166, 0.66)' })
        }
        const reconciled = [...merged.values()].sort((a, b) => Number(a.time) - Number(b.time))
        const newest = reconciled.at(-1)
        if (!newest) throw new Error('MT5 nie zwrócił świec.')
        const range = chartRef.current?.timeScale().getVisibleLogicalRange()
        liveHistoryRef.current = reconciled
        candlesRef.current?.setData(reconciled)
        if (range && !autoScrollRef.current) chartRef.current?.timeScale().setVisibleLogicalRange(range)
        currentBarRef.current = newest
        setLastBar(newest)
        setLoadedBars(reconciled.length)
        volumeDataRef.current = [...volumes.values()].sort((a, b) => Number(a.time) - Number(b.time))
        setVolumeData(volumeDataRef.current)
        recovering = false
        requestAnimationFrame(() => syncPlannerPrimitiveRef.current())

        publishFeed({
          status,
          source: 'MT5',
          mode: 'local',
          lastTickAt: Math.floor(tickTimeMs / 1000),
          symbol: payload.symbol,
          account: payload.account,
          symbolInfo: payload.symbol_info,
          marketSession: payload.market_session,
          lastPrice: payload.symbol_info.chart_mode === 1 ? tick.last : tick.bid,
          bid: tick.bid,
          ask: tick.ask,
          message: status === 'closed'
            ? 'Rynek jest zamknięty według godzin sesji symbolu u brokera.'
            : status === 'stale'
              ? payload.market_session.available
                ? 'Sesja jest otwarta, ale strumień ticków jest nieaktualny.'
                : 'Nie mam grafiku sesji brokera. Strumień ticków jest nieaktualny.'
              : undefined,
        })
      } catch (error) {
        recovering = true
        if (!disposed) {
          setFeed((current) => {
            const next: MarketFeedState = {
              ...current,
              status: current.lastTickAt ? 'stale' : 'error',
              source: 'MT5',
              mode: 'local',
              message: error instanceof Error ? error.message : 'Utracono połączenie z MT5 Local Bridge.',
            }
            onFeedStateChange?.(next)
            return next
          })
        }
      } finally {
        if (!disposed) timer = window.setTimeout(poll, recovering ? 2000 : 1000)
      }
    }

    poll()

    return () => {
      disposed = true
      controller.abort()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [timeframe, data.length, symbol])

  useEffect(() => {
    onPlannerChange?.(planner && plannerSide ? { side: plannerSide, entry: planner.entry, tp: planner.tp, ...(planner.tp1 !== null ? { tp1: planner.tp1 } : {}), ...(planner.tp2 !== null ? { tp2: planner.tp2 } : {}), ...(planner.tp3 !== null ? { tp3: planner.tp3 } : {}), ...(planner.be !== null ? { breakEven: planner.be } : {}), sl: planner.sl, lots: plannerLots } : null)
  }, [planner, plannerSide, plannerLots])

  useEffect(() => {
    setPlanner((current) => {
      const side = plannerSideRef.current
      if (!current || !side) return current
      const precision = pricePrecision(feed.symbolInfo)
      const distance = Math.abs(current.entry - current.sl)
      const direction = side === 'long' ? 1 : -1
      const target = (multiple: number) => snapToSymbolTick(current.entry + direction * distance * multiple, precision)
      const next = { ...current, tp1: plannerTargets.tp1 ? current.tp1 : null, tp2: plannerTargets.tp2 ? current.tp2 ?? target(2.8) : null, tp3: plannerTargets.tp3 ? current.tp3 ?? target(3.7) : null }
      plannerRef.current = next
      setPlannerDirty(true)
      requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
      return next
    })
  }, [plannerTargets.tp1, plannerTargets.tp2, plannerTargets.tp3])

  useEffect(() => {
    setPlanner((current) => {
      if (!current) return current
      const next = { ...current, be: breakEvenMode === 'off' ? null : current.be ?? current.entry }
      plannerRef.current = next
      setPlannerDirty(true)
      requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
      return next
    })
  }, [breakEvenMode])

  useEffect(() => {
    if (!plannerRequest) return
    if (plannerRequest.proposal) applyPlannerProposal(plannerRequest.side, plannerRequest.proposal)
    else armPlanner(plannerRequest.side)
  }, [plannerRequest?.nonce])

  useEffect(() => {
    if (!plannerLevelRequest || !plannerRef.current) {
      setPlacingTarget(null)
      return
    }
    setPlacingTarget(plannerLevelRequest.target)
  }, [plannerLevelRequest?.nonce])

  useEffect(() => {
    if (cancelRequest) clearPlanner()
  }, [cancelRequest?.nonce])

  useEffect(() => {
    resetDrawing()
    drawingActiveRef.current = Boolean(drawingRequest)
    const chart = chartRef.current
    chart?.applyOptions({ handleScroll: { pressedMouseMove: !drawingRequest, horzTouchDrag: !drawingRequest }, handleScale: { axisPressedMouseMove: !drawingRequest, pinch: !drawingRequest } })
    if (drawingRequest) { plannerGestureCleanupRef.current?.(true); setPlacingSide(null); setSelectedDrawing(null); setDrawingsOpen(false); setConfirmClearDrawings(false) }
    if (!drawingRequest) return
    if (drawingRequest.tool === 'clear' || drawingRequest.tool === 'erase') {
      setDrawingsOpen(true)
      setConfirmClearDrawings(drawingRequest.tool === 'clear')
      onDrawingComplete?.('tools')
    }
  }, [drawingRequest?.nonce, drawingScope, data.length])

  useEffect(() => {
    plannerRef.current = planner
    requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
  }, [planner])

  useEffect(() => {
    plannerTimeRef.current = plannerTime
    requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
  }, [plannerTime])

  useEffect(() => {
    plannerSideRef.current = plannerSide
    requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
  }, [plannerSide])

  useEffect(() => {
    // Parent tuning controls are CSS variables; refresh primitive on every React render.
    requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
  })

  useEffect(() => {
    const wasAutoScroll = autoScrollRef.current
    autoScrollRef.current = autoScroll
    if (autoScroll && !wasAutoScroll && !chartInteractionLockedRef.current) {
      chartRef.current?.timeScale().scrollToRealTime()
    }
    requestAnimationFrame(applyChartNavigationMode)
  }, [autoScroll])

  useEffect(() => {
    requestAnimationFrame(applyChartNavigationMode)
  }, [chartShift, chartShiftPercent])

  useEffect(() => {
    const info = feed.symbolInfo
    if (!info) return
    setPlannerLots((current) => clampLots(current, plannerVolumeConstraints(info)))
    chartRef.current?.applyOptions({ localization: { priceFormatter: (price: number) => formatSymbolPrice(price, info) } })
    candlesRef.current?.applyOptions({ priceFormat: { type: 'price', precision: info.digits, minMove: info.trade_tick_size || info.point || 10 ** -info.digits } })
  }, [feed.symbolInfo])

  const handleShiftMarkerPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const root = rootRef.current
    if (!root) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      const percentFromRight = ((rect.right - moveEvent.clientX) / rect.width) * 100
      setChartShiftPercent(Math.max(10, Math.min(50, percentFromRight)))
    }

    const stop = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  // One gesture owns native chart navigation and window listeners. Coordinates
  // are sampled at grab time, so live ticks and edge offsets cannot move the grab.
  const startPlannerGesture = (part: PlannerPrimitiveHit | PlannerLevel, event: ReactPointerEvent<HTMLDivElement>) => {
    plannerGestureCleanupRef.current?.(true)
    const root = rootRef.current
    const chart = chartRef.current
    const candles = candlesRef.current
    const original = plannerRef.current
    const originalRange = plannerTimeRef.current
    const side = plannerSideRef.current
    if (!root || !chart || !candles || !original || !originalRange || !side) return
    const rect = root.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const logical0 = chart.timeScale().coordinateToLogical(x)
    const logicalX0 = logical0 === null ? null : chart.timeScale().logicalToCoordinate(logical0)
    const logicalX1 = logical0 === null ? null : chart.timeScale().logicalToCoordinate((Number(logical0)+1) as Logical)
    const price0 = candles.coordinateToPrice(y)
    const price1 = candles.coordinateToPrice(y + 1)
    if (logical0 === null || logicalX0 === null || logicalX1 === null || logicalX0 === logicalX1 || price0 === null || price1 === null) return
    const barsPerPixel = 1 / (logicalX1 - logicalX0)
    const pricePerPixel = price1 - price0
    const precision = pricePrecision(feed.symbolInfo)
    const startPlanner = {...original}
    const startRange = {...originalRange}
    const startClientX = event.clientX
    const startClientY = event.clientY
    const pointerId = event.pointerId
    const dirtyBefore = plannerDirty
    const interactionsBefore = {handleScroll:structuredClone(chart.options().handleScroll), handleScale:structuredClone(chart.options().handleScale)}
    const autoScaleBefore = chart.priceScale('right').options().autoScale
    const shiftBefore = chart.timeScale().options().shiftVisibleRangeOnNewBar
    const visible = chart.timeScale().getVisibleLogicalRange()
    const widthBars = startRange.end - startRange.start
    const minWidth = Math.min(widthBars, Math.max(8, 160 * Math.abs(barsPerPixel)))
    const maxLogical = Math.max(startRange.end, data.length - 1 + Math.max(60, visible ? (Number(visible.to) - Number(visible.from))*.6 : 180), visible ? Number(visible.to) + widthBars : 0)
    event.preventDefault()
    event.stopPropagation()
    root.setPointerCapture(pointerId)
    chartInteractionLockedRef.current = true
    chart.applyOptions({handleScroll:false, handleScale:false})
    chart.priceScale('right').applyOptions({autoScale:false})
    chart.timeScale().applyOptions({shiftVisibleRangeOnNewBar:false})
    setMovingPlanner(part === 'body')
    setResizingPlanner(part === 'resize-left' ? 'left' : part === 'resize-right' ? 'right' : null)
    setActivePlannerLevel(part === 'body' || part.startsWith('resize-') ? null : part as PlannerLevel)

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const dx = (e.clientX - startClientX) * barsPerPixel
      const dy = (e.clientY - startClientY) * pricePerPixel
      let next = startPlanner
      let range = startRange
      if (part === 'body') {
        const start = Math.max(0, Math.min(maxLogical - widthBars, startRange.start + dx))
        range = {start, end:start + widthBars}
        const delta = Math.max(dy, precision.tickSize - Math.min(startPlanner.entry, startPlanner.sl, startPlanner.tp))
        const translated = translatePlannerGeometry({entry:startPlanner.entry, stopLoss:startPlanner.sl, takeProfit:startPlanner.tp}, delta, precision)
        next = {...startPlanner, entry:translated.entry, sl:translated.stopLoss, tp:translated.takeProfit,
          tp1:startPlanner.tp1 === null ? null : snapToSymbolTick(startPlanner.tp1 + delta, precision),
          tp2:startPlanner.tp2 === null ? null : snapToSymbolTick(startPlanner.tp2 + delta, precision),
          tp3:startPlanner.tp3 === null ? null : snapToSymbolTick(startPlanner.tp3 + delta, precision),
          be:startPlanner.be === null ? null : snapToSymbolTick(startPlanner.be + delta, precision)}
      } else if (part === 'resize-left') range = {start:Math.max(0, Math.min(startRange.end - minWidth, startRange.start + dx)), end:startRange.end}
      else if (part === 'resize-right') range = {start:startRange.start, end:Math.min(maxLogical, Math.max(startRange.start + minWidth, startRange.end + dx))}
      else {
        const level = part as PlannerLevel
        const value = startPlanner[level]
        if (value === null) return
        next = clampPlannerLevel(side, level, value + dy, startPlanner, pricePrecision(feed.symbolInfo))
        // An entry-linked BE destination follows Entry until explicitly separated.
        if (level === 'entry' && startPlanner.be === startPlanner.entry) next = {...next, be:next.entry}
      }
      plannerRef.current = next
      plannerTimeRef.current = range
      setPlanner(next)
      setPlannerTime(range)
      setPlannerDirty(true)
      syncPlannerPrimitiveRef.current()
    }
    const finish = (cancel = false, notify = true) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancelPointer)
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', key)
      plannerGestureCleanupRef.current = null
      chartInteractionLockedRef.current = false
      if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId)
      if (chartRef.current === chart) {
        chart.applyOptions(interactionsBefore)
        chart.priceScale('right').applyOptions({autoScale:autoScaleBefore})
        chart.timeScale().applyOptions({shiftVisibleRangeOnNewBar:shiftBefore})
      }
      if (notify) {
        setMovingPlanner(false); setResizingPlanner(null); setActivePlannerLevel(null)
        window.requestAnimationFrame(syncDrawingCoordinates)
        if (cancel) { plannerRef.current = startPlanner; plannerTimeRef.current = startRange; setPlanner(startPlanner); setPlannerTime(startRange); setPlannerDirty(dirtyBefore); syncPlannerPrimitiveRef.current() }
      }
    }
    const up = (e: PointerEvent) => { if (e.pointerId === pointerId) finish() }
    const cancelPointer = (e: PointerEvent) => { if (e.pointerId === pointerId) finish(true) }
    const blur = () => finish(true)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(true) } }
    plannerGestureCleanupRef.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancelPointer)
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', key)
  }
  useEffect(() => () => { plannerGestureCleanupRef.current?.(false, false) }, [symbol, timeframe])

  const handleRootPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const target = event.target as HTMLElement
    if (target.closest('[data-planner-ui="true"], [data-planner-control="true"]')) return

    if (placingTarget && !drawingRequest && !placingSide) {
      const root = rootRef.current
      const chart = chartRef.current
      const candles = candlesRef.current
      const current = plannerRef.current
      const side = plannerSideRef.current
      if (!root || !chart || !candles || !current || !side) return
      const rect = root.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const paneHeight = chart.panes()[0]?.getHeight() ?? rect.height
      if (x < 0 || x > chart.timeScale().width() || y < 0 || y > paneHeight) return
      const price = candles.coordinateToPrice(y)
      if (price === null || !Number.isFinite(price)) return
      const level: PlannerLevel = placingTarget
      const next = clampPlannerLevel(side, level, price, current, pricePrecision(feed.symbolInfo))
      if (next === current) return
      event.preventDefault()
      event.stopPropagation()
      plannerRef.current = next
      setPlanner(next)
      setPlannerDirty(true)
      setPlacingTarget(null)
      requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
      if (plannerLevelRequest) onPlannerLevelPlacementComplete?.(plannerLevelRequest.nonce)
      return
    }

    const plannerTarget = target.closest('[data-planner-hit]')?.getAttribute('data-planner-hit')
    if (plannerTarget && !drawingRequest && !placingSide) { startPlannerGesture(plannerTarget as PlannerLevel, event); return }
    const hitDrawing = target.closest('[data-drawing-id]')?.getAttribute('data-drawing-id')
    if (hitDrawing && !drawingRequest && !placingSide) { event.preventDefault(); event.stopPropagation(); setSelectedDrawing(hitDrawing); setDrawingsOpen(true); return }

    const root = rootRef.current
    const chart = chartRef.current
    const candles = candlesRef.current
    if (!root || !chart || !candles) return

    const rect = root.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top

    if (drawingInteractions.handleDrawingDown(event)) return


    if (placingSide) {
      const logical = chart.timeScale().coordinateToLogical(localX)
      const price = candles.coordinateToPrice(localY)
      if (logical === null || price === null) return

      event.preventDefault()
      event.stopPropagation()

      const side = placingSide
      const plannerState = createPlannerAtPrice(price, side, pricePrecision(feed.symbolInfo), plannerTargets, breakEvenMode)
      const visible = chart.timeScale().getVisibleLogicalRange()
      const visibleBars = visible ? Math.max(20, Number(visible.to) - Number(visible.from)) : 300
      const widthBars = Math.max(18, Math.round(visibleBars * .22), Math.ceil(180 * visibleBars / Math.max(1, chart.timeScale().width())))
      const futureAllowance = visible
        ? Math.max(60, Math.round(visibleBars * 0.60))
        : 180
      const maxLogical = Math.max(
        data.length - 1 + futureAllowance,
        visible ? Math.ceil(Number(visible.to) + widthBars) : data.length - 1 + futureAllowance
      )

      // The clicked entry is the LEFT edge of a new planner.
      // MT5-style right-side chart space is valid placement space, so do not clamp to last real bar.
      const anchor = Math.max(0, Math.min(maxLogical - widthBars, Math.round(Number(logical))))
      const timeRange = { start: anchor, end: anchor + widthBars }
      plannerRef.current = plannerState
      plannerTimeRef.current = timeRange
      plannerSideRef.current = side
      setPlanner(plannerState)
      onPlannerPlaced?.()
      setPlannerTime(timeRange)
      setPlannerSide(side)
      setPlannerDirty(false)
      setPlacingSide(null)
      requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
      return
    }

    if (!plannerRef.current || !plannerTimeRef.current || !plannerSideRef.current) return

    const hit = plannerPrimitiveRef.current?.hitPart(localX, localY)
    if (hit) startPlannerGesture(hit, event)
  }

  const renderAnnotation = (annotation: ChartAnnotation) => {
          const chart = chartRef.current
          const candles = candlesRef.current
          if (!chart || !candles) return null
          const coordinates = annotation.points.map((point) => {
            const logical = drawingLogicalAtTime(Number(point.time), data, TIMEFRAME_MINUTES[timeframe] * 60)
            const x = chart.timeScale().timeToCoordinate(point.time) ?? (logical === null ? null : chart.timeScale().logicalToCoordinate(logical as Logical))
            const y = candles.priceToCoordinate(point.price)
            return x === null || y === null ? null : { x, y }
          })
          if (coordinates.some((point) => point === null)) return null
          const points = coordinates as { x: number; y: number }[]
          const a = points[0]
          const width = chart.timeScale().width()
          const height = chart.panes()[0]?.getHeight() || 1
          if (annotation.kind === 'vertical') return <line key={annotation.id} data-drawing-kind="vertical" x1={a.x} x2={a.x} y1="0" y2={height} stroke="#24dfff" strokeWidth="1.5" strokeDasharray="5 4" />
          if (annotation.kind === 'horizontal') return <g key={annotation.id} data-drawing-kind="horizontal"><line x1="0" x2={width} y1={a.y} y2={a.y} stroke="#24dfff" strokeWidth="1.5" strokeDasharray="6 4" /><text x={width - 70} y={a.y - 5} fill="#8befff" fontSize="10" fontFamily="Consolas, monospace">LEVEL · {annotation.points[0].price.toFixed(feed.symbolInfo?.digits ?? 2)}</text></g>
          if (annotation.kind === 'text') return <text key={annotation.id} data-drawing-kind="text" x={a.x + 7} y={a.y - 7} fill="#24dfff" fontSize="12" fontFamily="Consolas, monospace">{annotation.label || ''}</text>
          const b = points[1]
          if (annotation.kind === 'trend') {
            const name = `TRENDLINE_${annotation.id === 'draft' ? 'DRAFT' : String(chartAnnotations.findIndex(item => item.id === annotation.id) + 1).padStart(2, '0')}`
            const labelWidth = Math.max(112, name.length * 7 + 20)
            const labelHeight = 20
            let labelX = b.x + 11
            if (labelX + labelWidth > width - 4) labelX = b.x - labelWidth - 11
            labelX = Math.max(4, Math.min(labelX, width - labelWidth - 4))
            let labelY = b.y - labelHeight - 9
            if (labelY < 4) labelY = b.y + 10
            labelY = Math.max(4, Math.min(labelY, height - labelHeight - 4))
            return <g key={annotation.id} className="drawing-trend-group">
              <line data-drawing-kind="trend" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#20dfff" strokeWidth="2" />
              <circle className="drawing-trend-anchor" cx={b.x} cy={b.y} r="3.5" fill="#03101c" stroke="#70f5ff" strokeWidth="1.5" />
              <g className="drawing-terminal-label" data-drawing-label="trendline" data-label-anchor-x={b.x} data-label-anchor-y={b.y}>
                <rect x={labelX} y={labelY} width={labelWidth} height={labelHeight} rx="2" fill="#061827ee" stroke="#27cbe3" strokeWidth="1" />
                <text x={labelX + 7} y={labelY + 13.5} fill="#a4f8ff" fontSize="10" fontWeight="600" fontFamily="Consolas, monospace">↗ {name}</text>
              </g>
            </g>
          }
          if (annotation.kind === 'ray') {
            const dx = b.x - a.x
            const dy = b.y - a.y
            const endX = dx >= 0 ? width : 0
            const endY = Math.abs(dx) < 0.001 ? (dy >= 0 ? height : 0) : a.y + (dy / dx) * (endX - a.x)
            return <line key={annotation.id} data-drawing-kind="ray" x1={a.x} y1={a.y} x2={endX} y2={endY} stroke="#8d78ff" strokeWidth="1.5" strokeDasharray="7 4" />
          }
          if (annotation.kind === 'rectangle') return <rect key={annotation.id} data-drawing-kind="rectangle" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.max(1, Math.abs(a.x - b.x))} height={Math.max(1, Math.abs(a.y - b.y))} fill="rgba(36, 223, 255, .09)" stroke="#24dfff" strokeWidth="1.5" />
          if (annotation.kind === 'measure') {
            const priceDelta = Math.abs(annotation.points[1].price - annotation.points[0].price)
            const tickSize = pricePrecision(feed.symbolInfo).tickSize
            const tickCount = tickSize > 0 ? priceDelta / tickSize : 0
            return <g key={annotation.id} data-drawing-kind="measure"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ff68d8" strokeWidth="1.5" strokeDasharray="4 3" /><text x={(a.x + b.x) / 2 + 5} y={(a.y + b.y) / 2 - 5} fill="#ff9ce5" fontSize="11" fontFamily="Consolas, monospace">{priceDelta.toFixed(feed.symbolInfo?.digits ?? 2)} · {tickCount.toFixed(1)} ticks</text></g>
          }
          if (annotation.kind === 'fib') {
            const startPrice = annotation.points[0].price
            const endPrice = annotation.points[1].price
            const x1 = Math.min(a.x, b.x)
            const x2 = Math.max(a.x, b.x)
            return <g key={annotation.id} data-drawing-kind="fib">{([0, .236, .382, .5, .618, .786, 1] as const).map((ratio, index) => {
              const value = fibonacciRetracementPrice(startPrice, endPrice, ratio)
              const y = candles.priceToCoordinate(value)
              if (y === null) return null
              const colors = ['#ffd879', '#ff68d8', '#ad97ff', '#50edff', '#ad97ff', '#ff68d8', '#ffd879']
              return <g key={ratio} data-fib-ratio={ratio}><line x1={x1} x2={x2} y1={y} y2={y} stroke={colors[index]} strokeWidth={ratio === 0 || ratio === 1 ? 1.8 : 1} strokeDasharray={ratio === 0 || ratio === 1 ? undefined : "3 3"} /><text x={Math.max(8, Math.min(x2 + 4, width - 178))} y={Math.max(15, Math.min(y - 6, height - 5))} fill={colors[index]} fontSize="13" fontFamily="Consolas, monospace" stroke="#041020" strokeWidth="3" paintOrder="stroke">{(ratio * 100).toFixed(1)}% · {value.toFixed(feed.symbolInfo?.digits ?? 2)}</text></g>
            })}</g>
          }
          if (annotation.kind === 'channel') {
            const c = points[2]
            const dx = c.x - b.x
            const dy = c.y - b.y
            return <g key={annotation.id} data-drawing-kind="channel"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#24dfff" strokeWidth="1.5" /><line x1={a.x + dx} y1={a.y + dy} x2={c.x} y2={c.y} stroke="#24dfff" strokeWidth="1.5" /><line x1={a.x} y1={a.y} x2={a.x + dx} y2={a.y + dy} stroke="#24dfff" strokeWidth="1" strokeDasharray="3 3" /></g>
          }
          return null
  }
  const draftPoints = drawingCursor ? [...drawingAnchors, drawingCursor] : drawingAnchors
  const draftKind = drawingKind === 'channel' && draftPoints.length === 2 ? 'trend' : drawingKind
  const draftAnnotation: ChartAnnotation | null = draftKind && draftPoints.length >= DRAWING_POINT_COUNTS[draftKind] ? { id: 'draft', kind: draftKind, points: draftPoints.slice(0, DRAWING_POINT_COUNTS[draftKind]), label: drawingRequest?.label } : null
  const hasVisibleRsiPane = indicators.includes('RSI') && indicatorSettings.RSI?.visible !== false
  const selectedScanRange = selectedDrawing ? chartAnnotations.find(annotation => annotation.id === selectedDrawing && annotation.kind === 'rectangle') : null
  const scanRangeStyle: CSSProperties | undefined = (() => {
    if (!selectedScanRange || !chartRef.current || !candlesRef.current) return undefined
    const points = selectedScanRange.points.map(point => ({
      x: chartRef.current!.timeScale().timeToCoordinate(point.time),
      y: candlesRef.current!.priceToCoordinate(point.price),
    }))
    if (points.some(point => point.x === null || point.y === null)) return undefined
    const xs = points.map(point => point.x as number), ys = points.map(point => point.y as number)
    const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top
    if (![left,top,width,height].every(Number.isFinite) || width < 4 || height < 4) return undefined
    return { inset:'auto', left, top, width, height }
  })()

  return (
    <div
      ref={rootRef}
      className={`market-chart${drawingRequest ? ' market-chart--drawing' : ''}${placingSide ? ' market-chart--placing' : ''}${placingTarget ? ' market-chart--placing-target' : ''}${movingPlanner ? ' market-chart--planner-moving' : ''}${resizingPlanner ? ' market-chart--planner-resizing' : ''}${activePlannerLevel ? ' market-chart--planner-level-drag' : ''}${hasVisibleRsiPane ? ' market-chart--has-rsi-pane' : ''}`}
      aria-label={`Wykres rynkowy ${symbol} ${timeframe}`}
      data-key-level-count="0"
      data-auto-scroll={String(autoScroll)}
      data-chart-shift={String(chartShift)}
      data-reference-level-count={referenceLevels.length}
      data-planner-entry={planner?.entry}
      data-planner-tp={planner?.tp}
      data-planner-tp-label={planner ? 'FULL TP' : 'none'}
      data-planner-target-tp1={planner?.tp1 ?? 'none'}
      data-planner-level-request={placingTarget ?? 'none'}
      data-planner-sl={planner?.sl}
      data-planner-be={planner?.be ?? 'off'}
      data-planner-start={plannerTime?.start}
      data-planner-end={plannerTime?.end}
      data-planner-side={plannerSide ?? 'none'}
      data-vega-proposal-side={vegaProposal?.side ?? 'none'}
      data-volume-visible={String(volumeVisible)}
      data-drawing-armed={drawingKind || drawingRequest?.tool || 'none'}
      data-indicator-pane-count="0"
      data-indicator-pane-scale-count="0"
      data-indicator-series-count="0"
      onPointerDownCapture={handleRootPointerDownCapture}
      onPointerMoveCapture={handleDrawingMove}
      onPointerUpCapture={handleDrawingUp}
      onPointerCancel={drawingInteractions.handleDrawingCancel}
    >
      <div ref={containerRef} className="market-chart__canvas" />
      {rangeScanId > 0 && <div key={`scan-${rangeScanId}`} className={`crt-range-scan${rangeScanDetected ? ' is-detected' : ''}`} style={scanRangeStyle} aria-hidden="true"><span className="crt-range-scan-beam" /><span className="crt-range-scan-label">PODGLĄD ANIMACJI · BEZ ANALIZY WYBICIA</span></div>}
      {phosphorPulse && <span key={phosphorPulse.id} className="crt-phosphor-pulse" ref={pulseElementRef} style={{visibility:"hidden"}} aria-hidden="true"><i /><b /></span>}
      <svg className="market-chart__drawing-overlay" data-testid="drawing-overlay" data-revision={drawingRevision} width="100%" height="100%" viewBox={'0 0 ' + (rootRef.current?.clientWidth || 1) + ' ' + (rootRef.current?.clientHeight || 1)} aria-label="Rysunki na wykresie">
        {vegaProposal && (() => {
          const candles = candlesRef.current
          const chart = chartRef.current
          if (!candles || !chart) return null
          const width = chart.timeScale().width()
          const height = chart.panes()[0]?.getHeight() || rootRef.current?.clientHeight || 1
          const digits = feed.symbolInfo?.digits ?? 2
          const levels = [
            { id: 'ENTRY', price: vegaProposal.entry, color: '#f4d17e', dash: undefined },
            { id: 'VEGA SL', price: vegaProposal.stopLoss, color: '#ff668b', dash: '5 4' },
            { id: 'VEGA TP', price: vegaProposal.takeProfit, color: '#38e4d5', dash: '5 4' },
            ...(vegaProposal.support !== null && vegaProposal.support !== vegaProposal.stopReference ? [{ id: 'SUPPORT', price: vegaProposal.support, color: '#e3b96d', dash: '2 5' }] : []),
            ...(vegaProposal.resistance !== null && vegaProposal.resistance !== vegaProposal.targetReference ? [{ id: 'RESISTANCE', price: vegaProposal.resistance, color: '#b99aff', dash: '2 5' }] : []),
          ]
          const entryY = candles.priceToCoordinate(vegaProposal.entry)
          const stopY = candles.priceToCoordinate(vegaProposal.stopLoss)
          const targetY = candles.priceToCoordinate(vegaProposal.takeProfit)
          const visibleLevels = levels.flatMap(level => {
            const y = candles.priceToCoordinate(level.price)
            return y === null || y < 2 || y > height - 2 ? [] : [{ ...level, y }]
          }).sort((a, b) => a.y - b.y)
          let nextLabelY = 12
          const labelRows = visibleLevels.map(level => {
            const labelY = Math.max(level.y - 5, nextLabelY)
            nextLabelY = labelY + 14
            return { ...level, labelY }
          })
          const maxLabelY = height - 5
          const overflow = labelRows.length ? Math.max(0, labelRows[labelRows.length - 1].labelY - maxLabelY) : 0
          const shiftUp = labelRows.length ? Math.min(overflow, Math.max(0, labelRows[0].labelY - 12)) : 0
          const labelX = Math.max(8, width - 226)
          return <g data-vega-proposal-overlay="true" pointerEvents="none">
            {entryY !== null && stopY !== null && <rect x="0" y={Math.min(entryY, stopY)} width={width} height={Math.abs(entryY-stopY)} fill="rgba(255,102,139,.055)" />}
            {entryY !== null && targetY !== null && <rect x="0" y={Math.min(entryY, targetY)} width={width} height={Math.abs(entryY-targetY)} fill="rgba(56,228,213,.055)" />}
            {labelRows.map(level => {
              const labelY = level.labelY - shiftUp
              return <g key={level.id} data-vega-level={level.id}>
                <line x1="0" x2={width} y1={level.y} y2={level.y} stroke={level.color} strokeWidth={level.id === 'ENTRY' ? 1.6 : 1.2} strokeDasharray={level.dash} opacity=".88" />
                <line x1={labelX - 5} x2={labelX - 5} y1={level.y} y2={labelY} stroke={level.color} strokeWidth="1" opacity=".85" />
                <rect x={labelX - 2} y={labelY - 10} width="218" height="13" rx="2" fill="#06111c" opacity=".9" />
                <text x={labelX + 3} y={labelY} fill={level.color} fontSize="10" fontFamily="Consolas, monospace" stroke="#06111c" strokeWidth="2" paintOrder="stroke">VEGA {level.id} · {level.price.toFixed(digits)}</text>
              </g>
            })}
          </g>
        })()}
        {marketProfile && marketProfileView.showTpo && (() => {
          const candles = candlesRef.current
          const width = rootRef.current?.clientWidth || 1
          if (!candles || !marketProfile.bins.length) return null
          const density = Math.max(1, Math.min(12, Math.round(marketProfileView.density)))
          const maxTpo = Math.max(1, ...marketProfile.bins.map((bin) => bin.tpo))
          const maxWidth = Math.max(24, width * Math.max(5, Math.min(35, marketProfileView.widthPct)) / 100)
          return <g data-market-profile-overlay="tpo">{marketProfile.bins.map((bin, index) => {
            if (bin.tpo <= 0 || index % density !== 0) return null
            const y = candles.priceToCoordinate(bin.price)
            if (y === null || y < 0 || y > (rootRef.current?.clientHeight || 1)) return null
            const barWidth = Math.max(1, maxWidth * bin.tpo / maxTpo)
            const x = marketProfileView.position === 'right' ? Math.max(0, width - 72 - barWidth) : 72
            return <rect key={index} x={x} y={y - 1} width={barWidth} height="2" fill="rgba(36, 223, 255, .18)" />
          })}</g>
        })()}
        <defs>
          <clipPath id={drawingClipId}><rect width={chartRef.current?.timeScale().width() || 0} height={chartRef.current?.panes()[0]?.getHeight() || 0} /></clipPath>
          <clipPath id={`${drawingClipId}-planner-extensions`}><rect width={chartRef.current?.timeScale().width() || 0} height={chartRef.current?.panes()[0]?.getHeight() || 0} /></clipPath>
        </defs>
        {(() => {
          const chart = chartRef.current
          const candles = candlesRef.current
          const current = plannerRef.current
          const range = plannerTimeRef.current
          const geometry = plannerPrimitiveRef.current?.geometry()
          if (!chart || !candles || !current || !range || !geometry) return null
          const width = chart.timeScale().width()
          const start = plannerLogicalToCoordinate(chart.timeScale(), range.start)
          const end = plannerLogicalToCoordinate(chart.timeScale(), range.end)
          if (start === null || end === null) return null
          const left = Math.max(0, Math.min(start, end))
          const right = Math.min(width, Math.max(start, end))
          const levels = [
            { id: 'full-tp', y: geometry.tpY, color: '#31e8db' },
            { id: 'entry', y: geometry.entryY, color: '#ffd277' },
            { id: 'sl', y: geometry.slY, color: '#ff6289' },
            { id: 'tp1', value: current.tp1, color: '#20d7cc' },
            { id: 'tp2', value: current.tp2, color: '#36d8ef' },
            { id: 'tp3', value: current.tp3, color: '#83a6ff' },
            { id: 'be', value: current.be, color: '#ffd166' },
          ].map(level => ({ ...level, y: 'y' in level ? level.y : level.value == null ? null : candles.priceToCoordinate(level.value) }))
          return <g className="planner-level-extensions" clipPath={`url(#${drawingClipId}-planner-extensions)`} pointerEvents="none">
            {levels.flatMap(level => {
              if (level.y === null || level.y === undefined) return []
              return [
                left > 0 && <line key={`${level.id}-left`} data-planner-level-extension={`${level.id}-left`} x1="0" x2={left} y1={level.y} y2={level.y} stroke={level.color} strokeWidth="1" strokeDasharray="3 5" strokeOpacity=".48" />,
                right < width && <line key={`${level.id}-right`} data-planner-level-extension={`${level.id}-right`} x1={right} x2={width} y1={level.y} y2={level.y} stroke={level.color} strokeWidth="1" strokeDasharray="3 5" strokeOpacity=".48" />,
              ].filter(Boolean)
            })}
          </g>
        })()}
        <g clipPath={`url(#${drawingClipId})`}>{chartAnnotations.map(annotation => <g key={annotation.id} data-drawing-id={annotation.id} className={selectedDrawing === annotation.id ? 'drawing-saved selected' : 'drawing-saved'} style={{pointerEvents: drawingRequest || placingSide ? 'none' : 'visiblePainted'}}>{renderAnnotation(annotation)}</g>)}</g>
        {draftAnnotation && <g className="market-chart__draft" clipPath={`url(#${drawingClipId})`} opacity=".65">{renderAnnotation(draftAnnotation)}</g>}
        {(() => { const g = plannerPrimitiveRef.current?.geometry(); return g ? <rect data-planner-geometry="main" data-entry-y={g.entryY} data-tp-y={g.tpY} data-sl-y={g.slY} data-handle-y={(g.rewardTop+g.rewardBottom)/2} x={g.left} y={g.top} width={g.right-g.left} height={g.bottom-g.top} fill="none" pointerEvents="none" /> : null })()}
        {(['tp1', 'tp2', 'tp3', 'be'] as const).map((level) => {
          const chart = chartRef.current
          const candles = candlesRef.current
          const value = plannerRef.current?.[level]
          const range = plannerTimeRef.current
          if (!chart || !candles || value === null || value === undefined || !range) return null
          const y = candles.priceToCoordinate(value)
          const x1 = plannerLogicalToCoordinate(chart.timeScale(), range.start)
          const x2 = plannerLogicalToCoordinate(chart.timeScale(), range.end)
          if (y === null || x1 === null || x2 === null) return null
          const stroke = level === 'tp1' ? '#20d7cc' : level === 'tp2' ? '#36d8ef' : level === 'tp3' ? '#83a6ff' : '#ffd166'
          const fill = level === 'tp1' ? '#76f2e3' : level === 'tp2' ? '#60e5f4' : level === 'tp3' ? '#a3bcff' : '#ffe28a'
          const profitLabel = level === 'tp1' ? plannerTargetProfitLabels[0] : level === 'tp2' ? plannerTargetProfitLabels[1] : level === 'tp3' ? plannerTargetProfitLabels[2] : null
          const entryY = candles.priceToCoordinate(plannerRef.current!.entry)
          const overlapsEntry = level === 'be' && entryY !== null && Math.abs(y - entryY) < 26
          const fullTpY = candles.priceToCoordinate(plannerRef.current!.tp)
          const overlapsFullTp = level === 'tp1' && fullTpY !== null && Math.abs(y - fullTpY) < 26
          const labelY = level === 'be' ? y + (overlapsEntry ? 38 : 20) : overlapsFullTp ? y + 17 : y - 9
          const labelX = (x1 + x2) / 2
          return <g key={level} className="planner-extra-level" data-planner-hit={level}>
            {!overlapsEntry && <><rect data-planner-target={level} data-price={value} x={Math.min(x1,x2)} y={y-6} width={Math.abs(x2-x1)} height={12} fill="transparent" pointerEvents="all" /><line x1={x1} x2={x2} y1={y} y2={y} stroke={stroke} strokeWidth="1.5" strokeDasharray="4 4" /></>}
            <rect data-planner-target={overlapsEntry ? level : undefined} data-price={value} x={labelX-85} y={labelY-15} width="170" height="22" fill="transparent" pointerEvents="all" />
            <text x={labelX} y={labelY} textAnchor="middle" className="planner-terminal-label" fill={fill} fontSize="12" fontFamily="Consolas, monospace" pointerEvents="all">{level === 'be' ? 'BE STOP' : level.toUpperCase()} · {value.toFixed(feed.symbolInfo?.digits ?? 2)}{profitLabel ? ` · ${profitLabel}` : ''}</text>
          </g>
        })}
        {alerts.filter((rule) => rule.enabled && rule.symbol === (feed.symbol || symbol)).map((rule) => {
          const candles = candlesRef.current
          const y = candles?.priceToCoordinate(rule.level)
          const width = rootRef.current?.clientWidth || 1
          const height = rootRef.current?.clientHeight || 1
          if (y === null || y === undefined || y < 0 || y > height) return null
          return <rect key={rule.id} data-alert-hit={rule.id} data-alert-price={rule.level} x="0" y={y - 7} width={width} height="14" fill="transparent" pointerEvents="all" cursor="pointer" onPointerDownCapture={(event) => { event.preventDefault(); event.stopPropagation() }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAlertSelect?.(rule.id) }} />
        })}
      </svg>

      {drawingRequest && <div className="market-chart__drawing-hint" role="status">Luna › {drawingRequest.tool.toUpperCase()} · {drawingKind && DRAWING_POINT_COUNTS[drawingKind] > 1 ? `${drawingAnchors.length + 1}/${DRAWING_POINT_COUNTS[drawingKind]} · kliknij punkt${DRAWING_POINT_COUNTS[drawingKind] === 2 ? ' lub przeciągnij' : ''}` : 'kliknij wykres'} · ESC anuluj</div>}
      {!compactFeedStatus && planner && !drawingRequest && <div className="planner-gesture-guide">&gt; PLAN {plannerSide === 'long' ? 'DŁUGA' : plannerSide === 'short' ? 'KRÓTKA' : ''} · wnętrze: przesuń całość · WEJŚCIE / TP / SL: zmień cenę · uchwyty: szerokość{(movingPlanner || resizingPlanner || activePlannerLevel) && ' · ESC cofnij ruch'}</div>}
      {chartAnnotations.length > 0 && <div className="chart-drawing-manager" data-planner-ui="true">
        <button className="chart-drawing-toggle" aria-label="Zarządzaj rysunkami" aria-expanded={drawingsOpen} onClick={() => { setDrawingsOpen(v => !v); setConfirmClearDrawings(false) }}>&gt; RYSUNKI [{chartAnnotations.length}]</button>
        {drawingsOpen && <div className="chart-drawing-list" aria-label="Lista rysunków">
          <header>{symbol} / {timeframe}<button aria-label="Zamknij listę rysunków" onClick={() => setDrawingsOpen(false)}>×</button></header>
          {chartAnnotations.length === 0 && <p>Luna › Nie masz jeszcze rysunków na tym wykresie.</p>}
          {chartAnnotations.map((item, index) => <div key={item.id}>
            <button aria-pressed={selectedDrawing === item.id} onClick={() => setSelectedDrawing(item.id)}>{String(index + 1).padStart(2,'0')} / {item.kind === 'trend' ? 'TRENDLINE' : item.kind.toUpperCase()}</button>
            <button aria-label={'Usuń rysunek ' + (index + 1)} onClick={() => deleteDrawing(item.id)}>USUŃ</button>
          </div>)}
          {chartAnnotations.length > 0 && <footer>{confirmClearDrawings ? <><span>Luna › Usunąć wszystkie rysunki z {timeframe}?</span><button onClick={() => { setChartAnnotations([]); setSelectedDrawing(null); setConfirmClearDrawings(false) }}>Tak, wyczyść</button><button onClick={() => setConfirmClearDrawings(false)}>Anuluj</button></> : <button onClick={() => setConfirmClearDrawings(true)}>Wyczyść wszystkie rysunki</button>}</footer>}
        </div>}
      </div>}
      {!compactFeedStatus && <PlannerControlPanel
        side={plannerSide}
        placingSide={placingSide}
        planner={planner}
        symbol={feed.symbol}
        currency={feed.account?.currency || feed.symbolInfo?.currency_profit || 'USD'}
        equity={feed.account?.equity}
        lots={plannerLots}
        volumeStep={feed.symbolInfo?.volume_step || 0.01}
        accountingValues={plannerAccountingValues(feed.symbolInfo)}
        volumeConstraints={plannerVolumeConstraints(feed.symbolInfo)}
        formatPrice={(price) => formatSymbolPrice(price, feed.symbolInfo)}
        onLotsChange={(lots) => { setPlannerLots(lots); setPlannerDirty(true) }}
        onArm={armPlanner}
        onClear={clearPlanner}
      />}

      {!navigationControlsExternal && <div className="chart-navigation-controls" data-planner-ui="true" aria-label="Sterowanie pozycją wykresu">
        <button
          type="button"
          className={`chart-nav-button${autoScroll ? ' is-active' : ''}`}
          onClick={() => setAutoScroll(!autoScroll)}
          title="MT5 Auto Scroll — śledź najnowszą cenę"
        >
          <span className="chart-nav-button__icon">⇥</span>
          <span>AUTO</span>
        </button>
        <button
          type="button"
          className={`chart-nav-button${chartShift ? ' is-active' : ''}`}
          onClick={() => setChartShift(!chartShift)}
          title="MT5 Chart Shift — zostaw margines po prawej"
        >
          <span className="chart-nav-button__icon">↤</span>
          <span>SHIFT</span>
        </button>
      </div>}

      {chartShift && (
        <button
          type="button"
          className="chart-shift-marker"
          style={{ right: `calc(var(--price-rail-width) + ${chartShiftPercent}%)` }}
          onPointerDown={handleShiftMarkerPointerDown}
          data-planner-ui="true"
          title={`Margines prawej strony: ${Math.round(chartShiftPercent)}%`}
          aria-label="Przeciągnij znacznik marginesu wykresu"
        >
          <span />
        </button>
      )}

      {lastBar && (
        <div className="market-chart__hud market-chart__hud--left">
          <span className="market-chart__ohlc-label">O</span><span>{formatSymbolPrice(lastBar.open, feed.symbolInfo)}</span>
          <span className="market-chart__ohlc-label">H</span><span>{formatSymbolPrice(lastBar.high, feed.symbolInfo)}</span>
          <span className="market-chart__ohlc-label">L</span><span>{formatSymbolPrice(lastBar.low, feed.symbolInfo)}</span>
          <span className="market-chart__ohlc-label">C</span><span className="market-chart__ohlc-close">{formatSymbolPrice(lastBar.close, feed.symbolInfo)}</span>
        </div>
      )}

      {!compactFeedStatus && <div className={`market-chart__hud market-chart__hud--right feed-status feed-status--${feed.status}`}>
        <span className="market-chart__test-dot" />
        <span>{`${feedLabel(feed)} · ${timeframe} · ${loadedBars} BARS`}</span>
      </div>}

      {feed.status === 'connecting' && data.length === 0 && (
        <div className="market-chart__loading">Luna › Łączę się z Twoim MetaTrader 5…</div>
      )}

      {feed.status === 'error' && data.length === 0 && (
        <div className="market-chart__loading market-chart__loading--error">
          Luna › Nie mam połączenia z MT5. {feed.message || 'Nie udało się połączyć z MT5'}
        </div>
      )}

      {managedPosition && managedPosition.symbol === (feed.symbol || symbol) && (
        <div className="market-chart__manage-badge" data-managed-position={managedPosition.id}>
          MANAGE POSITION #{managedPosition.id} · {managedPosition.side.toUpperCase()} · {managedPosition.volume.toFixed(2)} LOT
        </div>
      )}
      {managedOrder && managedOrder.symbol === (feed.symbol || symbol) && (
        <div className="market-chart__manage-badge market-chart__manage-badge--order" data-managed-order={managedOrder.id}>
          PENDING #{managedOrder.id} · TRIGGER {formatSymbolPrice(managedOrder.trigger, feed.symbolInfo)}
        </div>
      )}
      {!compactFeedStatus && placingTarget && (
        <div className="market-chart__placement-banner" role="status">
          {placingTarget.toUpperCase()} · KLIKNIJ WYKRES, ABY USTAWIĆ CENĘ
        </div>
      )}
      {!compactFeedStatus && placingSide && (
        <div className="market-chart__placement-banner">
          {placingSide === 'long' ? 'LONG' : 'SHORT'} · KLIKNIJ PUNKT WEJŚCIA
        </div>
      )}

    </div>
  )
}

