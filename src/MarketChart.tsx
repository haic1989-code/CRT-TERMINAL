import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type UTCTimestamp,
} from 'lightweight-charts'
import { fetchMt5Bars, fetchMt5Snapshot, type Mt5Account, type Mt5SymbolInfo } from './mt5Client'
import { vwapPresentation } from './indicators/vwapPresentation'
import { drawingLogicalAtTime, drawingTimeAtLogical, fibonacciRetracementPrice } from './domain/drawingGeometry'
import { PositionPlannerPrimitive, plannerLogicalToCoordinate, type PlannerPrimitiveHit } from './positionPlannerPrimitive'
import type { AlertRule, BreakEvenMode, MarketProfile } from './domain/contracts'
import type { ReferenceLevel } from './domain/referenceLevels'
import { clampPlannerPrice, createPlannerGeometry, snapToSymbolTick, translatePlannerGeometry, type PricePrecision } from './domain/plannerGeometry'
import { indicatorDefinition } from './indicators/catalog'
import type { IndicatorId, IndicatorSettings } from './indicators/catalog'
import { calculateIndicatorSeries, mergeLatestBar, type IndicatorBar } from './indicators/calculations'
import type { VegaTradeProposal } from './engines/vegaContext'

export type { IndicatorSettings } from './indicators/catalog'

export type ChartTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1'
export type PlannerSide = 'long' | 'short'
type PlannerTargetSelection = 'tp1' | 'tp2' | 'tp3'
export type PlannerSnapshot = { side: PlannerSide; entry: number; tp: number; tp1?: number; tp2?: number; tp3?: number; breakEven?: number; sl: number; lots: number }
export type ManagedPositionHighlight = { id: number; symbol: string; side: PlannerSide; volume: number; entry: number; stopLoss: number; takeProfit: number; currentPrice?: number }
export type ManagedOrderHighlight = { id: number; symbol: string; trigger: number }
export type MarketFeedStatus = 'connecting' | 'history' | 'live' | 'closed' | 'stale' | 'error'
export type MarketProfileView = { showTpo: boolean; showPoc: boolean; showValueArea: boolean; density: number; widthPct: number; position: 'left' | 'right' }
const RSI_PANE_HEIGHT = 140

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

type PlannerLevel = 'tp' | 'tp1' | 'tp2' | 'tp3' | 'be' | 'entry' | 'sl'

type PlannerState = {
  /** Full-position take profit remains independent from the optional partial targets. */
  tp: number
  tp1: number | null
  tp2: number | null
  tp3: number | null
  be: number | null
  entry: number
  sl: number
}

type PlannerTimeRange = {
  start: number
  end: number
}

type ChartDrawingPoint = { time: UTCTimestamp; price: number }
type ChartAnnotationKind = 'vertical' | 'horizontal' | 'trend' | 'ray' | 'rectangle' | 'channel' | 'measure' | 'fib' | 'text'
type ChartAnnotation = { id: string; kind: ChartAnnotationKind; points: ChartDrawingPoint[]; label?: string }
type ChartDrawingStore = Record<string, ChartAnnotation[]>
type IndicatorSeriesEntry = { id: IndicatorId; key: 'main' | 'upper' | 'lower'; series: any }

const DRAWINGS_STORAGE_KEY = 'smartflow-x:drawings:v1'
const DRAWING_POINT_COUNTS: Record<ChartAnnotationKind, number> = { vertical: 1, horizontal: 1, trend: 2, ray: 2, rectangle: 2, channel: 3, measure: 2, fib: 2, text: 1 }

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

function getIndicatorBars(
  data: readonly CandlestickData<UTCTimestamp>[],
  latest: CandlestickData<UTCTimestamp> | null,
  volumes: readonly { time: UTCTimestamp; value: number; color: string }[],
): IndicatorBar[] {
  const merged = mergeLatestBar(data, latest)
  const volumeByTime = new Map(volumes.map((item) => [Number(item.time), item.value]))
  return merged.map((bar) => ({
    time: Number(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    tickVolume: volumeByTime.get(Number(bar.time)) ?? 0,
  }))
}

function pricePrecision(info?: Mt5SymbolInfo): PricePrecision {
  return { digits: info?.digits ?? 2, tickSize: info?.trade_tick_size || info?.point || 0.01 }
}

function formatSymbolPrice(price: number, info?: Mt5SymbolInfo) {
  return price.toFixed(info?.digits ?? 2)
}

function createPlannerAtPrice(entry: number, side: PlannerSide, info?: Mt5SymbolInfo, targets = { tp2: false, tp3: false }, breakEvenMode: BreakEvenMode = 'manual'): PlannerState {
  const precision = pricePrecision(info)
  const geometry = createPlannerGeometry(entry, side, precision)
  const riskDistance = Math.abs(geometry.entry - geometry.stopLoss)
  const direction = side === 'long' ? 1 : -1
  const target = (multiple: number) => snapToSymbolTick(geometry.entry + direction * riskDistance * multiple, precision)
  return { tp: geometry.takeProfit, tp1: null, tp2: targets.tp2 ? target(2.8) : null, tp3: targets.tp3 ? target(3.7) : null, be: breakEvenMode === 'off' ? null : geometry.entry, entry: geometry.entry, sl: geometry.stopLoss }
}

function plannerDistances(side: PlannerSide, planner: PlannerState) {
  return side === 'long'
    ? {
        reward: Math.max(planner.tp - planner.entry, 0.1),
        risk: Math.max(planner.entry - planner.sl, 0.1),
      }
    : {
        reward: Math.max(planner.entry - planner.tp, 0.1),
        risk: Math.max(planner.sl - planner.entry, 0.1),
      }
}

function clampPlannerLevel(
  side: PlannerSide,
  level: PlannerLevel,
  price: number,
  current: PlannerState,
  info?: Mt5SymbolInfo,
): PlannerState {
  const precision = pricePrecision(info)
  if (level === 'be') return { ...current, be: snapToSymbolTick(price, precision) }
  if (level === 'tp') {
    const geometry = clampPlannerPrice(side, 'takeProfit', price, { entry: current.entry, stopLoss: current.sl, takeProfit: current.tp }, precision)
    return { ...current, tp: geometry.takeProfit }
  }
  if (level === 'tp1' || level === 'tp2' || level === 'tp3') {
    const targets: Array<number | null> = [current.tp1, current.tp2, current.tp3]
    const index = level === 'tp1' ? 0 : level === 'tp2' ? 1 : 2
    const tick = precision.tickSize > 0 ? precision.tickSize : 10 ** -precision.digits
    const direction = side === 'long' ? 1 : -1
    let previous = current.entry
    for (let i = index - 1; i >= 0; i -= 1) if (targets[i] !== null) { previous = targets[i]!; break }
    let next: number | null = null
    for (let i = index + 1; i < targets.length; i += 1) if (targets[i] !== null) { next = targets[i]; break }
    const min = previous * direction + tick
    const max = next === null ? Infinity : next * direction - tick
    const bounded = snapToSymbolTick(Math.min(max, Math.max(min, price * direction)) * direction, precision)
    if (level === 'tp1') return { ...current, tp1: bounded }
    if (level === 'tp2') return { ...current, tp2: bounded }
    return { ...current, tp3: bounded }
  }
  const geometry = clampPlannerPrice(side, level === 'sl' ? 'stopLoss' : 'entry', price, { entry: current.entry, stopLoss: current.sl, takeProfit: current.tp }, precision)
  return { ...current, tp: geometry.takeProfit, entry: geometry.entry, sl: geometry.stopLoss }
}

function plannerMetrics(side: PlannerSide, planner: PlannerState | null) {
  if (!planner) return null
  const { reward, risk } = plannerDistances(side, planner)
  return { reward, risk, rr: reward / risk }
}

function estimatePlannerOutcome(
  side: PlannerSide,
  planner: PlannerState,
  lots: number,
  symbolInfo?: Mt5SymbolInfo
) {
  const metrics = plannerMetrics(side, planner)
  if (!metrics || !symbolInfo) return null

  const tickSize = symbolInfo.trade_tick_size || symbolInfo.point || 0.01
  const profitTickValue = symbolInfo.trade_tick_value_profit || symbolInfo.trade_tick_value || 0
  const lossTickValue = symbolInfo.trade_tick_value_loss || symbolInfo.trade_tick_value || 0
  if (tickSize <= 0 || lots <= 0 || profitTickValue <= 0 || lossTickValue <= 0) return null

  return {
    tpMoney: (metrics.reward / tickSize) * profitTickValue * lots,
    slMoney: (metrics.risk / tickSize) * lossTickValue * lots,
    rr: metrics.rr,
  }
}

function clampLots(value: number, symbolInfo?: Mt5SymbolInfo) {
  const min = symbolInfo?.volume_min || 0.01
  const max = symbolInfo?.volume_max || 100
  const step = symbolInfo?.volume_step || 0.01
  const bounded = Math.min(max, Math.max(min, value))
  const snapped = Math.round((bounded - min) / step) * step + min
  const precision = step < 0.01 ? 3 : step < 0.1 ? 2 : 1
  return Number(snapped.toFixed(precision))
}

function PlannerControlPanel({
  side,
  placingSide,
  planner,
  symbol,
  symbolInfo,
  account,
  lots,
  onLotsChange,
  onArm,
  onClear,
}: {
  side: PlannerSide | null
  placingSide: PlannerSide | null
  planner: PlannerState | null
  symbol?: string
  symbolInfo?: Mt5SymbolInfo
  account?: Mt5Account
  lots: number
  onLotsChange: (lots: number) => void
  onArm: (side: PlannerSide) => void
  onClear: () => void
}) {
  const metrics = side && planner ? plannerMetrics(side, planner) : null
  const outcome = side && planner ? estimatePlannerOutcome(side, planner, lots, symbolInfo) : null
  const status = placingSide ? 'WYBIERZ WEJŚCIE' : planner && side ? 'AKTYWNY' : 'GOTOWY'
  const currency = account?.currency || symbolInfo?.currency_profit || 'USD'
  const riskPct = outcome && account?.equity
    ? (outcome.slMoney / Math.max(account.equity, 0.01)) * 100
    : null
  const volumeStep = symbolInfo?.volume_step || 0.01

  return (
    <section className="planner-control-panel planner-control-panel--v2" data-planner-ui="true" aria-label="Planer pozycji">
      <div className="planner-control-panel__header planner-control-panel__header--v2">
        <div>
          <span className="planner-control-panel__eyebrow">SMARTFLOW · PLANER POZYCJI</span>
          <strong>PLANER POZYCJI</strong>
        </div>
        <span className={`planner-control-panel__status planner-control-panel__status--${placingSide ? 'placing' : planner ? 'active' : 'off'}`}>
          {status}
        </span>
      </div>

      <div className="planner-control-panel__instrument">
        <span>{symbol || 'XAUUSD'}</span>
        <small>{side ? side.toUpperCase() : 'WYBIERZ KIERUNEK'}</small>
      </div>

      <div className="planner-control-panel__directions">
        <button
          type="button"
          className={`planner-direction-button planner-direction-button--long${placingSide === 'long' || side === 'long' ? ' is-active' : ''}`}
          onClick={() => onArm('long')}
        >
          <span>DŁUGA</span>
          <small>ZYSK POWYŻEJ</small>
        </button>
        <button
          type="button"
          className={`planner-direction-button planner-direction-button--short${placingSide === 'short' || side === 'short' ? ' is-active' : ''}`}
          onClick={() => onArm('short')}
        >
          <span>KRÓTKA</span>
          <small>ZYSK PONIŻEJ</small>
        </button>
      </div>

      {placingSide && (
        <div className="planner-control-panel__placement">
          <span className="planner-control-panel__placement-dot" />
          Kliknij punkt WEJŚCIA na wykresie
        </div>
      )}

      {!placingSide && planner && side && metrics && (
        <>
          <div className="planner-control-panel__trade-grid">
            <div className="planner-control-panel__volume">
              <span className="planner-control-panel__field-label">WOLUMEN</span>
              <div className="planner-lot-stepper">
                <button type="button" onClick={() => onLotsChange(clampLots(lots - volumeStep, symbolInfo))}>−</button>
                <input
                  aria-label="Wolumen pozycji"
                  inputMode="decimal"
                  value={lots}
                  onChange={(event) => {
                    const parsed = Number(event.target.value.replace(',', '.'))
                    if (Number.isFinite(parsed)) onLotsChange(clampLots(parsed, symbolInfo))
                  }}
                />
                <button type="button" onClick={() => onLotsChange(clampLots(lots + volumeStep, symbolInfo))}>+</button>
              </div>
              <small>LOT</small>
            </div>

            <div className="planner-control-panel__rr-card">
              <span>R:R</span>
              <strong>{metrics.rr.toFixed(2)}</strong>
              <small>reward / risk</small>
            </div>
          </div>

          <div className="planner-control-panel__money">
            <div className="planner-money-card planner-money-card--profit">
              <span>TP · SZAC. WYNIK</span>
              <strong>{outcome ? `+${outcome.tpMoney.toFixed(2)} ${currency}` : '—'}</strong>
              <small>{formatSymbolPrice(planner.tp, symbolInfo)}</small>
            </div>
            <div className="planner-money-card planner-money-card--risk">
              <span>SL · SZAC. STRATA</span>
              <strong>{outcome ? `−${outcome.slMoney.toFixed(2)} ${currency}` : '—'}</strong>
              <small>
                {formatSymbolPrice(planner.sl, symbolInfo)}
                {riskPct !== null ? ` · ${riskPct.toFixed(2)}% equity` : ''}
              </small>
            </div>
          </div>

          <div className="planner-control-panel__levels">
            <div><span>WEJŚCIE</span><strong>{formatSymbolPrice(planner.entry, symbolInfo)}</strong></div>
            <div><span>TP</span><strong className="metric-profit">{formatSymbolPrice(planner.tp, symbolInfo)}</strong></div>
            <div><span>SL</span><strong className="metric-risk">{formatSymbolPrice(planner.sl, symbolInfo)}</strong></div>
          </div>

          <div className="planner-control-panel__hint">
            ŚRODEK = przesuń X/Y · KRAWĘDZIE = zmień szerokość · TP/WEJŚCIE/SL = zmień cenę
          </div>
        </>
      )}

      {!placingSide && !planner && (
        <div className="planner-control-panel__hint planner-control-panel__hint--empty">
          Wybierz pozycję długą albo krótką, a następnie kliknij punkt wejścia.
        </div>
      )}

      {(planner || placingSide) && (
        <button type="button" className="planner-control-panel__clear" onClick={onClear}>
          ZAMKNIJ PLANER
        </button>
      )}
    </section>
  )
}

function feedLabel(feed: MarketFeedState) {
  if (feed.status === 'live') return 'MT5 · NA ŻYWO'
  if (feed.status === 'closed') return 'MT5 · RYNEK ZAMKNIĘTY'
  if (feed.status === 'history') return 'MT5 · HISTORIA'
  if (feed.status === 'stale') return 'MT5 · NIEAKTUALNY'
  if (feed.status === 'error') return 'MT5 · NIEDOSTĘPNY'
  return 'MT5 · ŁĄCZENIE'
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
  const drawingSequenceRef = useRef<ChartDrawingPoint[]>([])

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
  const [drawingRevision, setDrawingRevision] = useState(0)
  const [drawingAnchors, setDrawingAnchors] = useState<ChartDrawingPoint[]>([])
  const [drawingCursor, setDrawingCursor] = useState<ChartDrawingPoint | null>(null)
  const drawingGestureRef = useRef<{ pointerId: number; x: number; y: number; dragged: boolean } | null>(null)
  const drawingActiveRef = useRef(false)
  const drawingMoveFrameRef = useRef<number | null>(null)
  const drawingClipId = useId().replace(/:/g, '')
  const drawingKind = drawingRequest && Object.prototype.hasOwnProperty.call(DRAWING_POINT_COUNTS, drawingRequest.tool) ? drawingRequest.tool as ChartAnnotationKind : null
  const syncDrawingCoordinates = () => {
    if (drawingMoveFrameRef.current !== null) return
    drawingMoveFrameRef.current = window.requestAnimationFrame(() => { drawingMoveFrameRef.current = null; setDrawingRevision(value => value + 1) })
  }
  useEffect(() => () => { if (drawingMoveFrameRef.current !== null) window.cancelAnimationFrame(drawingMoveFrameRef.current) }, [])
  const liveHistoryRef = useRef<CandlestickData<UTCTimestamp>[]>([])
  const [lastBar, setLastBar] = useState<CandlestickData<UTCTimestamp> | null>(null)
  const [phosphorPulse, setPhosphorPulse] = useState<{ id: number; x: number; y: number } | null>(null)
  const handledTickId = useRef(0)
  useEffect(() => {
    if (!simulationTickId || simulationTickId === handledTickId.current) return
    handledTickId.current = simulationTickId
    const chart = chartRef.current
    const candleSeries = candlesRef.current
    const latest = currentBarRef.current ?? lastBar ?? data.at(-1)
    if (!chart || !candleSeries || !latest) return
    const x = chart.timeScale().timeToCoordinate(latest.time)
    const y = candleSeries.priceToCoordinate(latest.close)
    if (x === null || y === null) return
    setPhosphorPulse({ id: simulationTickId, x, y })
    const timer = window.setTimeout(() => setPhosphorPulse(current => current?.id === simulationTickId ? null : current), 1750)
    return () => window.clearTimeout(timer)
  }, [simulationTickId])
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
        const dayUtc = new Date().getUTCDay()
        const weekend = dayUtc === 0 || dayUtc === 6
        const status: MarketFeedStatus =
          quoteAgeMs <= 15000 ? 'live' : weekend ? 'closed' : quoteAgeMs <= 120000 ? 'history' : 'stale'

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
          lastPrice: payload.tick.mid,
          bid: payload.tick.bid,
          ask: payload.tick.ask,
          message:
            status === 'closed'
              ? 'MT5 połączony. Rynek nie dostarcza aktualnego ticka.'
              : status === 'stale'
                ? 'MT5 połączony, ale ostatni tick jest nieaktualny.'
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

    const matrixTheme = Boolean(rootRef.current?.closest('.sf-matrix'))
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'rgba(0, 0, 0, 0)' },
        textColor: 'rgba(247, 245, 255, 0.94)',
        attributionLogo: true,
        fontFamily: '"Cascadia Code", Consolas, monospace',
        fontSize: 11,
      },
      localization: {
        locale: 'pl-PL',
        dateFormat: 'dd.MM.yy',
        priceFormatter: (price: number) => formatSymbolPrice(price, feed.symbolInfo),
      },
      grid: {
        vertLines: { color: matrixTheme ? 'rgba(85, 240, 161, 0.055)' : 'rgba(164, 104, 255, 0.055)', style: LineStyle.Solid },
        horzLines: { color: matrixTheme ? 'rgba(85, 240, 161, 0.065)' : 'rgba(255, 82, 184, 0.065)', style: LineStyle.Solid },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: !matrixTheme,
        borderColor: 'rgba(207, 170, 255, 0.22)',
        alignLabels: true,
        scaleMargins: { top: 0.09, bottom: 0.11 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: !matrixTheme,
        borderColor: 'rgba(207, 170, 255, 0.22)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 5.6,
        minBarSpacing: 1.7,
        maxBarSpacing: 22,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: matrixTheme ? 'rgba(85, 240, 161, 0.44)' : 'rgba(203, 88, 255, 0.44)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: matrixTheme ? '#0b2815' : '#24132f' },
        horzLine: { color: matrixTheme ? 'rgba(85, 240, 161, 0.42)' : 'rgba(255, 78, 169, 0.42)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: matrixTheme ? '#0b2815' : '#2a1020' },
      },
      // MT5 contract: plain wheel scrolls history; Ctrl + wheel scales.
      // Native Lightweight Charts uses vertical wheel for zoom, so wheel handling is custom below.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: false, pinch: true },
    })

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: matrixTheme ? '#55f0a1' : '#14dcff',
      downColor: matrixTheme ? '#ff6977' : '#ff3b9d',
      wickVisible: true,
      borderVisible: true,
      borderUpColor: matrixTheme ? '#a8ffd1' : '#54eeff',
      borderDownColor: matrixTheme ? '#ff8d96' : '#ff63b2',
      wickUpColor: matrixTheme ? 'rgba(85, 240, 161, 0.96)' : 'rgba(47, 227, 255, 0.96)',
      wickDownColor: matrixTheme ? 'rgba(255, 105, 119, 0.96)' : 'rgba(255, 74, 157, 0.96)',
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: 'price', precision: feed.symbolInfo?.digits ?? 2, minMove: feed.symbolInfo?.trade_tick_size || feed.symbolInfo?.point || 0.01 },
    })

    candles.setData(data)
    const volumes = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
    volumes.setData(volumeData)
    volumes.applyOptions({ visible: volumeVisible })
    chart.priceScale('volume').applyOptions({ visible: false, scaleMargins: { top: 0.82, bottom: 0 } })
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
    const scheduleDrawingSync = () => scheduleFrame(() => setDrawingRevision((revision) => revision + 1))
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

  useEffect(() => {
    if (!data.length) return
    let disposed = false
    let timer: number | null = null
    const refreshRecentVolumes = async () => {
      try {
        const payload = await fetchMt5Bars(timeframe, 100, undefined, symbol)
        if (disposed) return
        const merged = new Map(volumeDataRef.current.map((item) => [Number(item.time), item]))
        for (const bar of payload.values) {
          merged.set(bar.time, {
            time: bar.time as UTCTimestamp,
            value: Math.max(0, bar.tick_volume),
            color: bar.close >= bar.open ? 'rgba(15, 211, 255, 0.62)' : 'rgba(255, 53, 166, 0.66)',
          })
        }
        const finalBars = new Map(payload.values.map(bar => [bar.time, bar]))
        liveHistoryRef.current = liveHistoryRef.current.map(bar => {
          const finalized = finalBars.get(Number(bar.time))
          return finalized && Number(bar.time) < Number(currentBarRef.current?.time ?? 0)
            ? { time: bar.time, open: finalized.open, high: finalized.high, low: finalized.low, close: finalized.close }
            : bar
        })
        const next = [...merged.values()].sort((a, b) => Number(a.time) - Number(b.time))
        volumeDataRef.current = next
        setVolumeData(next)
      } catch {
        // A missed volume refresh leaves the last valid bar weights in place.
      } finally {
        if (!disposed) timer = window.setTimeout(refreshRecentVolumes, 5000)
      }
    }
    timer = window.setTimeout(refreshRecentVolumes, 2000)
    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [data.length, timeframe, symbol])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !data.length) return
    indicatorSeriesRef.current.forEach((entry) => chart.removeSeries(entry.series))
    indicatorSeriesRef.current = []
    const addLine = (
      id: IndicatorId,
      key: 'main' | 'upper' | 'lower',
      name: string,
      values: Array<number | null>,
      color: string,
      style = LineStyle.Solid,
      paneIndex = 0,
      fixedRange?: { minValue: number; maxValue: number },
    ) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: name,
        ...(fixedRange ? { autoscaleInfoProvider: () => ({ priceRange: fixedRange }) } : {}),
      }, paneIndex)
      const points = bars.flatMap((bar, index) => values[index] == null ? [] : [{ time: bar.time as UTCTimestamp, value: values[index]! }])
      series.setData(id === 'VWAP' ? vwapPresentation(points) : points)
      indicatorSeriesRef.current.push({ id, key, series })
      return series
    }
    const bars = getIndicatorBars(liveHistoryRef.current, null, volumeDataRef.current)
    for (const id of indicators) {
      const settings = indicatorSettings[id] ?? { visible: true }
      if (settings.visible === false) continue
      const definition = indicatorDefinition(id)
      if (!definition) continue
      const period = settings.period ?? definition.defaultPeriod ?? 14
      const values = calculateIndicatorSeries(id, bars, period)
      const paneIndex = id === 'RSI' ? chart.panes().length : 0
      let rsiSeries: any = null
      for (const item of values) {
        const title = id === 'SMA 20' ? `SMA ${period}`
          : id === 'EMA 50' ? `EMA ${period}`
            : id === 'Bollinger Bands' ? `BB ${item.key} ${period}`
              : id === 'RSI' ? `RSI (${period})` : 'VWAP · DAY UTC'
        const color = id === 'SMA 20' ? '#ffe06b'
          : id === 'EMA 50' ? '#5eabff'
            : id === 'VWAP' ? '#b594ff'
              : id === 'RSI' ? '#5ce8ff' : 'rgba(238, 125, 255, .8)'
        const style = id === 'Bollinger Bands' ? LineStyle.Dashed : LineStyle.Solid
        const created = addLine(id, item.key, title, item.values, color, style, paneIndex, id === 'RSI' ? { minValue: 0, maxValue: 100 } : undefined)
        if (id === 'RSI') rsiSeries = created
      }
      if (id === 'RSI' && rsiSeries) {
        rsiSeries.createPriceLine({ price: 70, color: 'rgba(255, 89, 178, .72)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' })
        rsiSeries.createPriceLine({ price: 30, color: 'rgba(92, 232, 255, .72)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' })
        chart.priceScale('right', paneIndex).applyOptions({ visible: true, autoScale: true, scaleMargins: { top: 0.04, bottom: 0.04 } })
        chart.panes()[paneIndex]?.setHeight(RSI_PANE_HEIGHT)
      }
    }
    const paneCount = Math.max(0, chart.panes().length - 1)
    const visiblePaneScaleCount = chart.panes().slice(1).filter((_, index) => chart.priceScale('right', index + 1).options().visible).length
    if (rootRef.current) {
      rootRef.current.dataset.indicatorPaneCount = String(paneCount)
      rootRef.current.dataset.indicatorPaneScaleCount = String(visiblePaneScaleCount)
      rootRef.current.dataset.indicatorSeriesCount = String(indicatorSeriesRef.current.length)
      rootRef.current.dataset.rsiPaneHeight = paneCount ? String(RSI_PANE_HEIGHT) : '0'
    }
    return () => {
      const current = chartRef.current
      if (current) indicatorSeriesRef.current.forEach((entry) => { try { current.removeSeries(entry.series) } catch { /* chart is already being disposed */ } })
      indicatorSeriesRef.current = []
      if (current && rootRef.current) {
        const panes = current.panes()
        rootRef.current.dataset.indicatorPaneCount = String(Math.max(0, panes.length - 1))
        rootRef.current.dataset.indicatorPaneScaleCount = String(panes.slice(1).filter((_, index) => current.priceScale('right', index + 1).options().visible).length)
        rootRef.current.dataset.indicatorSeriesCount = '0'
      }
    }
  }, [indicators, indicatorSettings, data])

  useEffect(() => {
    if (!data.length || !lastBar || indicatorSeriesRef.current.length === 0) return
    const bars = getIndicatorBars(liveHistoryRef.current, lastBar, volumeDataRef.current)
    const last = bars[bars.length - 1]
    if (!last) return
    const calculatedById = new Map<IndicatorId, ReturnType<typeof calculateIndicatorSeries>>()
    for (const entry of indicatorSeriesRef.current) {
      if (entry.id === 'VWAP') {
        const activeSession = Math.floor(last.time / 86400)
        let sessionStart = bars.length - 1
        while (sessionStart > 0 && Math.floor(bars[sessionStart - 1].time / 86400) === activeSession) sessionStart -= 1
        const sessionValues = calculateIndicatorSeries('VWAP', bars.slice(sessionStart))[0].values
        const value = sessionValues[sessionValues.length - 1]
        if (value !== null && value !== undefined && Number.isFinite(value)) entry.series.update({ time: last.time as UTCTimestamp, value })
        continue
      }

      let calculated = calculatedById.get(entry.id)
      if (!calculated) {
        const definition = indicatorDefinition(entry.id)
        const period = indicatorSettings[entry.id]?.period ?? definition?.defaultPeriod ?? 14
        calculated = calculateIndicatorSeries(entry.id, bars, period)
        calculatedById.set(entry.id, calculated)
      }
      const values = calculated.find((item) => item.key === entry.key)?.values
      const value = values?.[values.length - 1]
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      entry.series.update({ time: last.time as UTCTimestamp, value })
    }
  }, [data, lastBar, indicators, indicatorSettings])

  useEffect(() => {
    if (!data.length) return
    const bars = getIndicatorBars(liveHistoryRef.current, lastBar, volumeDataRef.current)
    onBarsChange?.(bars)
    if (rootRef.current) rootRef.current.dataset.liveBarCount = String(bars.length)
  }, [data, lastBar, volumeData, onBarsChange])

  useEffect(() => {
    const entries = indicatorSeriesRef.current.filter((entry) => entry.id === 'VWAP')
    if (!data.length || !entries.length) return
    const bars = getIndicatorBars(liveHistoryRef.current, lastBar, volumeDataRef.current)
    const values = calculateIndicatorSeries('VWAP', bars)[0].values
    const points = bars.flatMap((bar, index) => values[index] === null ? [] : [{ time: bar.time as UTCTimestamp, value: values[index]! }])
    entries.forEach((entry) => entry.series.setData(vwapPresentation(points)))
  }, [volumeData])


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
    let lastTickMsc = 0

    const poll = async () => {
      try {
        const payload = await fetchMt5Snapshot(undefined, symbol)
        if (disposed) return

        const tick = payload.tick
        const tickTimeMs = tick.time_msc || tick.time * 1000
        const quoteAgeMs = Math.max(0, Date.now() - tickTimeMs)
        const dayUtc = new Date().getUTCDay()
        const weekend = dayUtc === 0 || dayUtc === 6
        const status: MarketFeedStatus =
          quoteAgeMs <= 15000 ? 'live' : weekend ? 'closed' : quoteAgeMs <= 120000 ? 'history' : 'stale'

        if (tickTimeMs > lastTickMsc && Number.isFinite(tick.mid) && tick.mid > 0) {
          lastTickMsc = tickTimeMs
          const intervalSeconds = TIMEFRAME_MINUTES[timeframe] * 60
          const tickSeconds = Math.floor(tickTimeMs / 1000)
          const bucketTime = Math.floor(tickSeconds / intervalSeconds) * intervalSeconds
          const current = currentBarRef.current
          const isNewBar = !current || bucketTime > Number(current.time)
          let next: CandlestickData<UTCTimestamp>

          if (isNewBar) {
            next = {
              time: bucketTime as UTCTimestamp,
              open: tick.mid,
              high: tick.mid,
              low: tick.mid,
              close: tick.mid,
            }
          } else if (bucketTime === Number(current.time)) {
            next = {
              time: current.time,
              open: current.open,
              high: Math.max(current.high, tick.mid),
              low: Math.min(current.low, tick.mid),
              close: tick.mid,
            }
          } else {
            next = current
          }

          if (next !== current) {
            liveHistoryRef.current = mergeLatestBar(liveHistoryRef.current, next)
            currentBarRef.current = next
            candlesRef.current?.update(next)
            setLastBar(next)
            // shiftVisibleRangeOnNewBar already advances the viewport in AUTO mode.
            // Calling scrollToRealTime here as well applied the same movement twice.
            requestAnimationFrame(() => syncPlannerPrimitiveRef.current())
          }
        }

        publishFeed({
          status,
          source: 'MT5',
          mode: 'local',
          lastTickAt: Math.floor(tickTimeMs / 1000),
          symbol: payload.symbol,
          account: payload.account,
          symbolInfo: payload.symbol_info,
          lastPrice: tick.mid,
          bid: tick.bid,
          ask: tick.ask,
          message:
            status === 'closed'
              ? 'MT5 połączony. Rynek nie dostarcza aktualnego ticka.'
              : status === 'stale'
                ? 'MT5 połączony, ale strumień ticków jest nieaktualny.'
                : undefined,
        })
      } catch (error) {
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
        if (!disposed) timer = window.setTimeout(poll, 500)
      }
    }

    poll()

    return () => {
      disposed = true
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
    drawingSequenceRef.current = []
    setDrawingAnchors([])
    setDrawingCursor(null)
    drawingGestureRef.current = null
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
    setPlannerLots((current) => clampLots(current, info))
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
        next = clampPlannerLevel(side, level, value + dy, startPlanner, feed.symbolInfo)
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

  const readDrawingPoint = (clientX: number, clientY: number): ChartDrawingPoint | null => {
    const root = rootRef.current
    const chart = chartRef.current
    const candles = candlesRef.current
    if (!root || !chart || !candles || !data.length) return null
    const rect = root.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const plotHeight = chart.panes()[0]?.getHeight() ?? rect.height
    if (x < 0 || x > chart.timeScale().width() || y < 0 || y > plotHeight) return null
    const price = candles.coordinateToPrice(y)
    const logical = chart.timeScale().coordinateToLogical(x)
    const directTime = chart.timeScale().coordinateToTime(x)
    const time = directTime ?? (logical === null ? null : drawingTimeAtLogical(Number(logical), data, TIMEFRAME_MINUTES[timeframe] * 60))
    return price === null || time === null || !Number.isFinite(price) ? null : { time: time as UTCTimestamp, price }
  }
  const addDrawingPoint = (point: ChartDrawingPoint) => {
    if (!drawingKind) return
    const previous = drawingSequenceRef.current.at(-1)
    if (previous && previous.time === point.time && Math.abs(previous.price - point.price) < 1e-9) return
    const points = [...drawingSequenceRef.current, point]
    const required = DRAWING_POINT_COUNTS[drawingKind]
    if (points.length < required) {
      drawingSequenceRef.current = points
      setDrawingAnchors(points)
      setDrawingCursor(point)
      return
    }
    setChartAnnotations(current => [...current, { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, kind: drawingKind, points, label: drawingKind === 'text' ? drawingRequest?.label?.trim() : undefined }])
    drawingSequenceRef.current = []
    setDrawingAnchors([])
    setDrawingCursor(null)
    drawingGestureRef.current = null
    onDrawingComplete?.('saved')
  }
  const handleDrawingMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    syncDrawingCoordinates()
    if (!drawingRequest) return
    event.stopPropagation()
    const point = readDrawingPoint(event.clientX, event.clientY)
    setDrawingCursor(point)
    const gesture = drawingGestureRef.current
    if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 5) gesture.dragged = true
  }
  const handleDrawingUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRequest) return
    event.stopPropagation()
    const gesture = drawingGestureRef.current
    drawingGestureRef.current = null
    if (!gesture || gesture.pointerId !== event.pointerId || !gesture.dragged) return
    const point = readDrawingPoint(event.clientX, event.clientY)
    if (point) addDrawingPoint(point)
  }

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
      const next = clampPlannerLevel(side, level, price, current, feed.symbolInfo)
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

    if (drawingRequest) {
      event.preventDefault()
      event.stopPropagation()
      if (drawingRequest.tool === 'erase' || drawingRequest.tool === 'clear') return
      const point = readDrawingPoint(event.clientX, event.clientY)
      if (!point || !drawingKind) return
      const isFirstPoint = drawingSequenceRef.current.length === 0
      addDrawingPoint(point)
      if (isFirstPoint && DRAWING_POINT_COUNTS[drawingKind] === 2) {
        drawingGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragged: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      return
    }


    if (placingSide) {
      const logical = chart.timeScale().coordinateToLogical(localX)
      const price = candles.coordinateToPrice(localY)
      if (logical === null || price === null) return

      event.preventDefault()
      event.stopPropagation()

      const side = placingSide
      const plannerState = createPlannerAtPrice(price, side, feed.symbolInfo, plannerTargets, breakEvenMode)
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
      onPointerCancel={() => { drawingGestureRef.current = null; drawingSequenceRef.current = []; setDrawingAnchors([]); setDrawingCursor(null) }}
    >
      <div ref={containerRef} className="market-chart__canvas" />
      {rangeScanId > 0 && <div key={`scan-${rangeScanId}`} className={`crt-range-scan${rangeScanDetected ? ' is-detected' : ''}`} style={scanRangeStyle} aria-hidden="true"><span className="crt-range-scan-beam" /></div>}
      {phosphorPulse && <span key={phosphorPulse.id} className="crt-phosphor-pulse" style={{ left: phosphorPulse.x, top: phosphorPulse.y }} aria-hidden="true"><i /><b /></span>}
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

      {drawingRequest && <div className="market-chart__drawing-hint" role="status">{drawingRequest.tool.toUpperCase()} · {drawingKind && DRAWING_POINT_COUNTS[drawingKind] > 1 ? `${drawingAnchors.length + 1}/${DRAWING_POINT_COUNTS[drawingKind]} · kliknij punkt${DRAWING_POINT_COUNTS[drawingKind] === 2 ? ' lub przeciągnij' : ''}` : 'kliknij wykres'} · ESC anuluj</div>}
      {planner && !drawingRequest && <div className="planner-gesture-guide">&gt; PLAN {plannerSide === 'long' ? 'DŁUGA' : plannerSide === 'short' ? 'KRÓTKA' : ''} · wnętrze: przesuń całość · WEJŚCIE / TP / SL: zmień cenę · uchwyty: szerokość{(movingPlanner || resizingPlanner || activePlannerLevel) && ' · ESC cofnij ruch'}</div>}
      {chartAnnotations.length > 0 && <div className="chart-drawing-manager" data-planner-ui="true">
        <button className="chart-drawing-toggle" aria-label="Zarządzaj rysunkami" aria-expanded={drawingsOpen} onClick={() => { setDrawingsOpen(v => !v); setConfirmClearDrawings(false) }}>&gt; RYSUNKI [{chartAnnotations.length}]</button>
        {drawingsOpen && <div className="chart-drawing-list" aria-label="Lista rysunków">
          <header>{symbol} / {timeframe}<button aria-label="Zamknij listę rysunków" onClick={() => setDrawingsOpen(false)}>×</button></header>
          {chartAnnotations.length === 0 && <p>Brak rysunków na tym wykresie.</p>}
          {chartAnnotations.map((item, index) => <div key={item.id}>
            <button aria-pressed={selectedDrawing === item.id} onClick={() => setSelectedDrawing(item.id)}>{String(index + 1).padStart(2,'0')} / {item.kind === 'trend' ? 'TRENDLINE' : item.kind.toUpperCase()}</button>
            <button aria-label={'Usuń rysunek ' + (index + 1)} onClick={() => deleteDrawing(item.id)}>USUŃ</button>
          </div>)}
          {chartAnnotations.length > 0 && <footer>{confirmClearDrawings ? <><span>Usunąć wszystkie z {timeframe}?</span><button onClick={() => { setChartAnnotations([]); setSelectedDrawing(null); setConfirmClearDrawings(false) }}>Tak, wyczyść</button><button onClick={() => setConfirmClearDrawings(false)}>Anuluj</button></> : <button onClick={() => setConfirmClearDrawings(true)}>Wyczyść wszystkie rysunki</button>}</footer>}
        </div>}
      </div>}
      <PlannerControlPanel
        side={plannerSide}
        placingSide={placingSide}
        planner={planner}
        symbol={feed.symbol}
        symbolInfo={feed.symbolInfo}
        account={feed.account}
        lots={plannerLots}
        onLotsChange={(lots) => { setPlannerLots(lots); setPlannerDirty(true) }}
        onArm={armPlanner}
        onClear={clearPlanner}
      />

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
        <div className="market-chart__loading">ŁĄCZENIE Z LOKALNYM META TRADER 5…</div>
      )}

      {feed.status === 'error' && data.length === 0 && (
        <div className="market-chart__loading market-chart__loading--error">
          MT5 OFFLINE · {feed.message || 'Nie udało się połączyć z MT5'}
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
      {placingTarget && (
        <div className="market-chart__placement-banner" role="status">
          {placingTarget.toUpperCase()} · KLIKNIJ WYKRES, ABY USTAWIĆ CENĘ
        </div>
      )}
      {placingSide && (
        <div className="market-chart__placement-banner">
          {placingSide === 'long' ? 'LONG' : 'SHORT'} · KLIKNIJ PUNKT WEJŚCIA
        </div>
      )}

    </div>
  )
}

