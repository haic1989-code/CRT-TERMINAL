import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { MarketChart, type ChartTimeframe, type MarketFeedState, type MarketProfileView, type PlannerSide, type PlannerSnapshot } from './MarketChart'
import './dragon-terminal.css'
import './dragon-frames.css'
import './dragon-windows.css'
import './matrix-terminal.css'
import './matrix-crt.css'
import './matrix-hologram.css'
import { CrtChartConsole } from './CrtChartConsole'
import { MatrixCommandDeck } from './MatrixCommandDeck'
import { DemoExecutionPanel } from './DemoExecutionPanel'
import { lunaMessage, lunaRisk } from './lunaMessages'
import { manualLotSizing } from './domain/manualLotSizing'
import { TerminalStatus, type TerminalFocus } from './TerminalStatus'
import { INDICATOR_CATALOG } from './indicators/catalog'
import type { IndicatorId, IndicatorPreferences, IndicatorSettings } from './indicators/catalog'
import { readIndicatorPreferences, writeIndicatorPreferences } from './indicators/preferences'
import { fetchMt5Bars, fetchMt5Calculation, fetchMt5ContextBars, fetchMt5FxBars, fetchMt5Orders, fetchMt5Positions, fetchMt5SymbolInfo, fetchMt5Symbols, type Mt5Order, type Mt5Position } from './mt5Client'
import type { AlertRule, BreakEvenMode, MarketBar, MarketContextSnapshot, SymbolSpec, TradePlan } from './domain/contracts'
import { mt5AccountToDomain, mt5OrderToDomain, mt5PositionToDomain, mt5SymbolToDomain } from './adapters/mt5DomainAdapter'
import { AlertEngine, BreakevenEngine, ContextSummaryEngine, CurrencyStrengthEngine, KeyLevelsEngine, MarketProfileEngine, MTFContextEngine, PlannerBreakEvenEngine, PortfolioRiskEngine, PositionSizingEngine, RiskGuardEngine, SessionEngine, planRisk as calculatePlanRisk } from './engines'
import { VegaContextAdvisor } from './engines/vegaContext'
import vegaPortrait from '../design/assets/final-ui/vega-main-shell.webp'
import { ModuleDrawer } from './ModuleDrawer'
import { candleRemainingSeconds, formatCountdown, formatMt5ServerTime } from './domain/telemetry'
import { calculateReferenceLevels, type ReferenceLevelGroup } from './domain/referenceLevels'
import { allocateTargetLots } from './domain/targetAllocations'

const QUICK_SYMBOLS = ['XAUUSD', 'BTCUSD', 'DJ30'] as const
const TIMEFRAMES: ChartTimeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']
const CONTEXT_TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const
type ContextTimeframe = typeof CONTEXT_TIMEFRAMES[number]
type DrawerId = 'planner' | 'risk' | 'fx' | 'profile' | 'drawing' | 'indicators' | 'alerts' | 'instruments' | 'context' | null

const BOTTOM_PANEL_KEY = 'smartflow-x:bottom-panel:v1'
const ALERTS_KEY = 'smartflow-x:alerts:v1'
const ALERT_EVENTS_KEY = 'smartflow-x:alert-events:v1'
const PRICE_LEVEL_GROUPS_KEY = 'smartflow-x:dragon-price-level-groups:v1'
const PRICE_LEVEL_GROUP_OPTIONS: Array<{ id: ReferenceLevelGroup; label: string; detail: string }> = [
  { id: 'today', label: 'DZIŚ · D-H / D-L', detail: 'bieżący D1' },
  { id: 'previous-day', label: 'POPRZEDNI DZIEŃ · PDH / PDL', detail: 'poprzedni D1' },
  { id: 'week', label: 'TEN TYDZIEŃ · W-H / W-L', detail: 'bieżący W1' },
  { id: 'previous-week', label: 'POPRZEDNI TYDZIEŃ · PWH / PWL', detail: 'poprzedni W1' },
  { id: 'opens', label: 'OTWARCIE · D-O / W-O', detail: 'D1 + W1' },
]
const DRAWING_TOOLS = [
  { id: 'horizontal', label: 'Poziom' },
  { id: 'trend', label: 'Linia trendu' },
  { id: 'fib', label: 'Fibo' },
  { id: 'rectangle', label: 'Strefa' },
] as const
type BottomTab = 'positions' | 'orders' | 'account'
type BottomPanelPersistedState = { tab: BottomTab; expanded: boolean; height: number }

function readBottomPanelState(storageKey = BOTTOM_PANEL_KEY, maxHeightRatio = 0.65): BottomPanelPersistedState {
  const fallback: BottomPanelPersistedState = { tab: 'positions', expanded: false, height: 230 }
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || 'null') as Partial<BottomPanelPersistedState> | null
    const tab: BottomTab = parsed?.tab === 'orders' || parsed?.tab === 'account' ? parsed.tab : 'positions'
    const expanded = Boolean(parsed?.expanded)
    const height = Math.max(180, Math.min(window.innerHeight * maxHeightRatio, Number(parsed?.height) || 230))
    return { tab, expanded, height }
  } catch {
    return fallback
  }
}

function readStoredAlerts(): AlertRule[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ALERTS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((rule) => rule && typeof rule.id === 'string' && typeof rule.symbol === 'string' && Number.isFinite(rule.level)) : []
  } catch {
    return []
  }
}

function readStoredAlertEvents(): { ruleId: string; symbol: string; price: number; firedAt: number }[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ALERT_EVENTS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((event) => event && typeof event.ruleId === 'string' && Number.isFinite(event.price) && Number.isFinite(event.firedAt)).slice(0, 30) : []
  } catch {
    return []
  }
}

function readStoredPriceLevelGroups(): ReferenceLevelGroup[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRICE_LEVEL_GROUPS_KEY) || '[]')
    const valid: ReferenceLevelGroup[] = ['today', 'previous-day', 'week', 'previous-week', 'opens']
    return Array.isArray(parsed) ? [...new Set(parsed.filter((group): group is ReferenceLevelGroup => valid.includes(group)))] : []
  } catch { return [] }
}

const DEFAULT_PROFILE_VIEW: MarketProfileView = { showTpo: true, showPoc: true, showValueArea: true, density: 4, widthPct: 18, position: 'right' }

const money = (value?: number, currency = 'USD') => Number.isFinite(value) ? `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}` : '—'
const compact = (value?: number) => Number.isFinite(value) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'

function titleForDrawer(id: DrawerId) {
  return ({ planner: 'PLANER TRANSAKCJI PRO', risk: 'OCHRONA RYZYKA', fx: 'KONTEKST WALUTOWY', profile: 'PROFIL RYNKU', drawing: 'NARZĘDZIA RYSUNKOWE', indicators: 'PRZEGLĄD WSKAŹNIKÓW', alerts: 'SILNIK ALERTÓW', instruments: 'WYBÓR INSTRUMENTU', context: 'PANEL KONTEKSTU' } as Record<string, string>)[id || ''] || ''
}

export function SmartFlowShell() {
  const dragon = new URLSearchParams(window.location.search).get("ui") !== "legacy"
  const [agentAssetMissing, setAgentAssetMissing] = useState(false)
  const bottomStorageKey = dragon ? "smartflow-x:dragon-bottom-panel:v2" : BOTTOM_PANEL_KEY
  const [terminalFocus, setTerminalFocus] = useState<TerminalFocus>('all')
  const [consoleNotice, setConsoleNotice] = useState<{text:string; id:number} | null>(null)
  const [ambientMotionPaused, setAmbientMotionPaused] = useState(false)
  const [periodPrompt, setPeriodPrompt] = useState<{indicator:'SMA 20'|'EMA 50'; token:number} | null>(null)
  const periodPromptSequence = useRef(0)
  const [simulationTickId, setSimulationTickId] = useState(0)
  const [rangeScan, setRangeScan] = useState<{id:number; detected:boolean} | null>(null)
  const rangeScanSequence = useRef(0)
  const consoleSequence = useRef(0)
  const notifyConsole = (text:string) => setConsoleNotice({text:lunaMessage(text), id:++consoleSequence.current})
  useEffect(() => {
    if (!consoleNotice) return
    const timer = window.setTimeout(() => setConsoleNotice(null), 3600)
    return () => window.clearTimeout(timer)
  }, [consoleNotice])
  useEffect(() => {
    if (!dragon || !rangeScan) return
    const detectTimer = window.setTimeout(() => {
      setRangeScan(current => current?.id === rangeScan.id ? { ...current, detected:true } : current)
      notifyConsole('Podgląd skanu zakończony · bez analizy wybicia')
    }, 1250)
    const clearTimer = window.setTimeout(() => setRangeScan(current => current?.id === rangeScan.id ? null : current), 3900)
    return () => { window.clearTimeout(detectTimer); window.clearTimeout(clearTimer) }
  }, [dragon, rangeScan?.id])
  const [priceLevelGroups, setPriceLevelGroups] = useState<ReferenceLevelGroup[]>(() => readStoredPriceLevelGroups())
  const [referenceDailyBars, setReferenceDailyBars] = useState<MarketBar[]>([])
  const [referenceWeeklyBars, setReferenceWeeklyBars] = useState<MarketBar[]>([])
  const [referenceLevelsLoading, setReferenceLevelsLoading] = useState(false)
  const [symbol, setSymbol] = useState<string>(QUICK_SYMBOLS[0])
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('M15')
  const [contextTimeframe, setContextTimeframe] = useState<ContextTimeframe>('M15')
  const [feed, setFeed] = useState<MarketFeedState>({ status: 'connecting', source: 'MT5', mode: 'local', lastTickAt: null })
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const [chartShiftEnabled, setChartShiftEnabled] = useState(true)
  const [account, setAccount] = useState<any>(null)
  const [positions, setPositions] = useState<Mt5Position[]>([])
  const [positionsObservedAt, setPositionsObservedAt] = useState<number | null>(null)
  const [orders, setOrders] = useState<Mt5Order[]>([])
  const [ordersObservedAt, setOrdersObservedAt] = useState<number | null>(null)
  const [portfolioSpecs, setPortfolioSpecs] = useState<Record<string, SymbolSpec>>({})
  const [fxBars, setFxBars] = useState<Record<string, MarketBar[]>>({})
  const [contextBars, setContextBars] = useState<Record<string, MarketBar[]>>({})
  const [contextObservedAt, setContextObservedAt] = useState(0)
  const [drawer, setDrawer] = useState<DrawerId>(null)
  const [initialBottomPanel] = useState(() => readBottomPanelState(bottomStorageKey, dragon ? 0.38 : 0.65))
  const [bottomTab, setBottomTab] = useState<BottomTab>(initialBottomPanel.tab)
  const [bottomExpanded, setBottomExpanded] = useState(initialBottomPanel.expanded)
  const [bottomHeight, setBottomHeight] = useState(initialBottomPanel.height)
  const [selectedPositionTicket, setSelectedPositionTicket] = useState<number | null>(null)
  const [selectedOrderTicket, setSelectedOrderTicket] = useState<number | null>(null)
  const [planner, setPlanner] = useState<PlannerSnapshot | null>(null)
  const [bars, setBars] = useState<MarketBar[]>([])
  const [plannerRequest, setPlannerRequest] = useState<{ side: PlannerSide; nonce: number; proposal?: { entry: number; sl: number; tp: number } } | null>(null)
  const [plannerCancelRequest, setPlannerCancelRequest] = useState<{ nonce: number } | null>(null)
  const [plannerLevelRequest, setPlannerLevelRequest] = useState<{ target: 'tp1' | 'tp2' | 'tp3'; nonce: number } | null>(null)
  const plannerLevelNonceRef = useRef(0)
  const [plannerRisk, setPlannerRisk] = useState(1)
  const [plannerLot, setPlannerLot] = useState(.01)
  const [plannerTargets, setPlannerTargets] = useState({ tp1: false, tp2: false, tp3: false })
  const [takeProfitAllocations, setTakeProfitAllocations] = useState<number[]>([100, 0, 0])
  const [breakEvenMode, setBreakEvenMode] = useState<BreakEvenMode>(dragon ? 'off' : 'manual')
  const [symbolQuery, setSymbolQuery] = useState('')
  const [symbolResults, setSymbolResults] = useState<any[]>([])
  const [instrumentPinned, setInstrumentPinned] = useState(false)
  const [activeAlerts, setActiveAlerts] = useState<AlertRule[]>(() => readStoredAlerts())
  const activeAlertsRef = useRef<AlertRule[]>(activeAlerts)
  const [alertEvents, setAlertEvents] = useState<{ ruleId: string; symbol: string; price: number; firedAt: number }[]>(() => readStoredAlertEvents())
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null)
  const [alertDraft, setAlertDraft] = useState('')
  const [alertCondition, setAlertCondition] = useState<'above' | 'below' | 'cross'>('cross')
  const [profileSession, setProfileSession] = useState<'day' | 'week' | 'custom'>('day')
  const [profileCustomStart, setProfileCustomStart] = useState('')
  const [profileCustomEnd, setProfileCustomEnd] = useState('')
  const [profileView, setProfileView] = useState<MarketProfileView>(DEFAULT_PROFILE_VIEW)
  const [profile, setProfile] = useState<ReturnType<typeof MarketProfileEngine.calculate>>(null)
  const [profileEnabled, setProfileEnabled] = useState(!dragon)
  const [strengthLoading, setStrengthLoading] = useState(true)
  const [marginEstimate, setMarginEstimate] = useState<{ key: string; value: number } | null>(null)
  const [brokerPlan, setBrokerPlan] = useState<{ key: string; fullTp: number; loss: number; targets: (number | null)[]; reward: number } | null>(null)
  const [marginPerLot, setMarginPerLot] = useState<{ key: string; value: number } | null>(null)
  const [toast, setToast] = useState('')
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [indicatorPreferences, setIndicatorPreferences] = useState<IndicatorPreferences>(() => readIndicatorPreferences())
  const [volumeVisible, setVolumeVisible] = useState(() => { try { return dragon ? localStorage.getItem('smartflow-x:dragon-volume:v1') === 'true' : true } catch { return !dragon } })
  useEffect(() => { if (dragon) { try { localStorage.setItem('smartflow-x:dragon-volume:v1', String(volumeVisible)) } catch { /* session preference only */ } } }, [volumeVisible, dragon])
  const selectedIndicator = indicatorPreferences.active
  const [indicatorQuery, setIndicatorQuery] = useState('')
  const indicatorSettings = indicatorPreferences.settings
  const setSelectedIndicator = (update: IndicatorId[] | ((current: IndicatorId[]) => IndicatorId[])) => {
    setIndicatorPreferences((current) => ({ ...current, active: typeof update === 'function' ? update(current.active) : update }))
  }
  const setIndicatorSettings = (update: IndicatorSettings | ((current: IndicatorSettings) => IndicatorSettings)) => {
    setIndicatorPreferences((current) => ({ ...current, settings: typeof update === 'function' ? update(current.settings) : update }))
  }
  const [drawTool, setDrawTool] = useState('')
  const [drawingNote, setDrawingNote] = useState('')
  const [quickDrawTools, setQuickDrawTools] = useState<string[]>(['horizontal', 'trend', 'fib'])
  const [drawingRequest, setDrawingRequest] = useState<{ tool: string; nonce: number; label?: string } | null>(null)

  const symbolInfo = feed.symbolInfo
  const spec: SymbolSpec | null = symbolInfo ? mt5SymbolToDomain(symbolInfo) : null

  useEffect(() => { setAccount(feed.account ?? null) }, [feed.account])
  useEffect(() => { writeIndicatorPreferences(indicatorPreferences) }, [indicatorPreferences])
  useEffect(() => { try { localStorage.setItem(PRICE_LEVEL_GROUPS_KEY, JSON.stringify(priceLevelGroups)) } catch { /* session preference only */ } }, [priceLevelGroups])
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const active = dragon && priceLevelGroups.length > 0
    if (!active) return
    let dead = false
    let pending = false
    setReferenceDailyBars([])
    setReferenceWeeklyBars([])
    setReferenceLevelsLoading(true)
    const refresh = async () => {
      if (pending) return
      pending = true
      const [daily, weekly] = await Promise.allSettled([
        fetchMt5Bars('D1', 100, undefined, symbol),
        fetchMt5Bars('W1', 100, undefined, symbol),
      ])
      if (!dead) {
        setReferenceDailyBars(daily.status === 'fulfilled' ? daily.value.values : [])
        setReferenceWeeklyBars(weekly.status === 'fulfilled' ? weekly.value.values : [])
        setReferenceLevelsLoading(false)
      }
      pending = false
    }
    void refresh()
    const timer = window.setInterval(refresh, 60000)
    return () => { dead = true; window.clearInterval(timer) }
  }, [dragon, priceLevelGroups.length, symbol])
  useEffect(() => {
    let dead = false
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const [p, o] = await Promise.allSettled([fetchMt5Positions(), fetchMt5Orders()])
        if (dead) return
        if (p.status === 'fulfilled') {
          setPositions(p.value.values)
          setPositionsObservedAt(p.value.observed_at)
        }
        if (p.status === 'rejected') setPositionsObservedAt(0)
        if (o.status === 'rejected') setOrdersObservedAt(0)
        if (o.status === 'fulfilled') {
          setOrders(o.value.values)
          setOrdersObservedAt(o.value.observed_at)
        }
        const activeSymbols = [...new Set([
          ...(p.status === 'fulfilled' ? p.value.values.map((position) => position.symbol) : []),
          ...(o.status === 'fulfilled' ? o.value.values.map((order) => order.symbol) : []),
        ])]
        const symbolInfoResults = await Promise.allSettled(activeSymbols.map((activeSymbol) => fetchMt5SymbolInfo(activeSymbol)))
        if (dead) return
        setPortfolioSpecs((current) => {
          const next = p.status === 'fulfilled' && o.status === 'fulfilled'
            ? Object.fromEntries(Object.entries(current).filter(([activeSymbol]) => activeSymbols.includes(activeSymbol)))
            : { ...current }
          symbolInfoResults.forEach((result) => {
            if (result.status === 'fulfilled') {
              const domainSpec = mt5SymbolToDomain(result.value)
              next[domainSpec.symbol] = domainSpec
            }
          })
          return next
        })
      } finally { pending = false }
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => { dead = true; window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    let dead = false
    setContextBars({})
    setContextObservedAt(0)
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const result = await fetchMt5ContextBars(symbol)
        if (!dead) {
          setContextBars(result.values as Record<string, MarketBar[]>)
          setContextObservedAt(Date.now())
        }
      } catch {
        if (!dead) { setContextBars({}); setContextObservedAt(0) }
      } finally { pending = false }
    }
    refresh()
    const timer = window.setInterval(refresh, 30000)
    return () => { dead = true; window.clearInterval(timer) }
  }, [symbol])
  useEffect(() => {
    let dead = false
    setStrengthLoading(true)
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const result = await fetchMt5FxBars('H1')
        if (!dead) setFxBars(result.values as Record<string, MarketBar[]>)
      } catch {
        if (!dead) setFxBars({})
      } finally {
        pending = false
        if (!dead) setStrengthLoading(false)
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 60000)
    return () => { dead = true; window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (drawer !== 'instruments' || !symbolQuery.trim()) { setSymbolResults([]); return }
    let dead = false
    const timer = window.setTimeout(() => fetchMt5Symbols(symbolQuery).then((r) => { if (!dead) setSymbolResults(r.values) }).catch(() => { if (!dead) setSymbolResults([]) }), 180)
    return () => { dead = true; window.clearTimeout(timer) }
  }, [drawer, symbolQuery])
  useEffect(() => {
    if (!feed.lastPrice || !activeAlertsRef.current.length) return
    const events: { ruleId: string; symbol: string; price: number; firedAt: number }[] = []
    const activeSymbol = feed.symbol || symbol
    const rules = activeAlertsRef.current.map((rule) => {
      if (rule.symbol !== activeSymbol) return rule
      const result = AlertEngine.evaluate(rule, feed.lastPrice!, Date.now(), activeSymbol)
      if (result.event) events.push(result.event)
      return result.rule
    })
    activeAlertsRef.current = rules
    setActiveAlerts(rules)
    if (events.length) setAlertEvents((current) => [...events, ...current].slice(0, 30))
  }, [feed.lastPrice, feed.symbol, symbol])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (drawer) {
        setDrawer(null)
        return
      }
      if (!dragon && bottomExpanded) {
        setBottomExpanded(false)
        return
      }
      setDrawingRequest(null)
      setDrawTool('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, bottomExpanded, dragon])
  useEffect(() => {
    try {
      window.localStorage.setItem(bottomStorageKey, JSON.stringify({ tab: bottomTab, expanded: bottomExpanded, height: bottomHeight }))
    } catch { /* persistence is best-effort */ }
  }, [bottomTab, bottomExpanded, bottomHeight, bottomStorageKey])
  useEffect(() => {
    activeAlertsRef.current = activeAlerts
    try { window.localStorage.setItem(ALERTS_KEY, JSON.stringify(activeAlerts)) } catch { /* persistence is best-effort */ }
  }, [activeAlerts])
  useEffect(() => {
    try { window.localStorage.setItem(ALERT_EVENTS_KEY, JSON.stringify(alertEvents.slice(0, 30))) } catch { /* persistence is best-effort */ }
  }, [alertEvents])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const accountDomain = mt5AccountToDomain(account)
  const domainPositions = positions.map(mt5PositionToDomain)
  const domainOrders = orders.map(mt5OrderToDomain)
  const specs = useMemo(() => ({ ...portfolioSpecs, ...(spec ? { [spec.symbol]: spec } : {}) }), [portfolioSpecs, spec])
  const exposure = PortfolioRiskEngine.calculate({ equity: accountDomain.equity, positions: domainPositions, orders: domainOrders, specs })
  const portfolioObservedAt = positionsObservedAt !== null && ordersObservedAt !== null
    ? Math.min(positionsObservedAt, ordersObservedAt)
    : null
  const selectedPosition = selectedPositionTicket === null ? null : domainPositions.find((position) => position.id === selectedPositionTicket) ?? null
  const selectedOrder = selectedOrderTicket === null ? null : domainOrders.find((order) => order.id === selectedOrderTicket) ?? null
  const managedPosition = selectedPosition ? {
    id: selectedPosition.id,
    symbol: selectedPosition.symbol,
    side: selectedPosition.side,
    volume: selectedPosition.volume,
    entry: selectedPosition.openPrice,
    stopLoss: selectedPosition.stopLoss,
    takeProfit: selectedPosition.takeProfit,
    currentPrice: (feed.symbol || symbol) === selectedPosition.symbol ? feed.lastPrice : undefined,
  } : null
  const managedOrder = selectedOrder ? { id: selectedOrder.id, symbol: selectedOrder.symbol, trigger: selectedOrder.price } : null
  const breakeven = spec ? BreakevenEngine.calculate({ positions: domainPositions, symbol: feed.symbol || symbol, spec, currentPrice: feed.lastPrice }) : null
  const keyLevelPrice = feed.lastPrice ?? bars.at(-1)?.close ?? null
  const recentKeyLevels = useMemo(() => KeyLevelsEngine.calculate(bars.slice(-500)), [bars])
  const keyLevels = useMemo(() => KeyLevelsEngine.nearest(recentKeyLevels, keyLevelPrice), [recentKeyLevels, keyLevelPrice])
  const referenceLevels = useMemo(() => calculateReferenceLevels(referenceDailyBars, referenceWeeklyBars)
    .filter((level) => priceLevelGroups.includes(level.group)), [referenceDailyBars, referenceWeeklyBars, priceLevelGroups])
  const togglePriceLevelGroup = (group: ReferenceLevelGroup) => setPriceLevelGroups((current) => {
    const active = current.includes(group)
    const label = PRICE_LEVEL_GROUP_OPTIONS.find(option => option.id === group)?.label.split(' · ')[0] || 'POZIOMY'
    notifyConsole(`${label} ${active ? 'WYŁĄCZONO' : 'WŁĄCZONO'}`)
    return active ? current.filter((item) => item !== group) : [...current, group]
  })
  const mtfDirections = useMemo(() => Object.fromEntries(CONTEXT_TIMEFRAMES.map((tf) => {
    const history = contextBars[tf] ?? []
    const trend = history.length ? MTFContextEngine.supertrend(history, 100, 2).at(-1)?.direction ?? 'neutral' : 'unavailable'
    return [tf, trend]
  })), [contextBars])
  const marginPerLotKey = planner ? `${feed.symbol || symbol}|${planner.side}|${planner.entry}` : ''
  const currentMarginPerLot = marginPerLot?.key === marginPerLotKey ? marginPerLot.value : null
  const sizedPlan = planner && spec ? dragon ? manualLotSizing(plannerLot, planner.entry, planner.sl, spec, currentMarginPerLot ?? undefined) : PositionSizingEngine.calculate({ entry: planner.entry, stopLoss: planner.sl, riskPercent: plannerRisk, equity: accountDomain.equity, spec, marginPerLot: currentMarginPerLot ?? undefined, freeMargin: accountDomain.freeMargin }) : null
  const planTargets = planner ? [
    ...(plannerTargets.tp1 && planner.tp1 != null ? [{ price: planner.tp1, allocation: takeProfitAllocations[0] ?? 100 }] : []),
    ...(plannerTargets.tp2 && planner.tp2 != null ? [{ price: planner.tp2, allocation: takeProfitAllocations[1] ?? 0 }] : []),
    ...(plannerTargets.tp3 && planner.tp3 != null ? [{ price: planner.tp3, allocation: takeProfitAllocations[2] ?? 0 }] : []),
  ] : []
  const plan: TradePlan | null = planner ? { symbol: feed.symbol || symbol, side: planner.side, entry: planner.entry, stopLoss: planner.sl, takeProfits: planTargets.map((target) => target.price), takeProfitAllocations: planTargets.map((target) => target.allocation), breakEvenMode, breakEvenPrice: planner.breakEven, volume: sizedPlan?.volume ?? 0, riskPercent: dragon ? accountDomain.equity > 0 ? (sizedPlan?.riskCash ?? 0) / accountDomain.equity * 100 : Infinity : plannerRisk } : null
  const brokerPlanKey = planner && sizedPlan?.volume ? JSON.stringify([feed.symbol || symbol, account?.login, account?.server, planner.side, planner.entry, planner.sl, planner.tp, planner.tp1, planner.tp2, planner.tp3, plannerTargets, takeProfitAllocations, sizedPlan.volume]) : ''
  const currentBrokerPlan = brokerPlan?.key === brokerPlanKey && feed.status === 'live' ? brokerPlan : null
  const localMetrics = plan && spec ? calculatePlanRisk(plan, spec, accountDomain.equity) : null
  const metrics = localMetrics && currentBrokerPlan ? { ...localMetrics, lossAtStop: currentBrokerPlan.loss, riskCash: currentBrokerPlan.loss, rewardCash: currentBrokerPlan.reward, rewardRisk: currentBrokerPlan.loss > 0 ? currentBrokerPlan.reward / currentBrokerPlan.loss : 0 } : localMetrics
  const breakEvenRule = plan ? PlannerBreakEvenEngine.evaluate({ plan, reachedTargetCount: 0 }) : null
  const marginEstimateKey = planner && sizedPlan?.volume ? `${marginPerLotKey}|${sizedPlan.volume}` : ''
  const currentMarginEstimate = marginEstimate?.key === marginEstimateKey ? marginEstimate.value : null
  const riskGuard = RiskGuardEngine.evaluate({
    now: Date.now(), account: accountDomain, quoteObservedAt: (feed.lastTickAt ?? 0) * 1000,
    proposed: plan, proposedMargin: plan ? currentMarginEstimate : null, exposure,
    maxRiskPerTradePct: 2, maxTotalRiskPct: 5, maxDailyLossPct: 5, maxMarginUsagePct: 60,
    portfolioObservedAt, portfolioMaxAgeMs: 15000,
    maxLot: spec?.volumeMax ?? null,
    maxSpreadPoints: null,
    maxSlippagePoints: null,
    spreadPoints: symbolInfo?.spread ?? null,
    slippagePoints: null,
    blockNewTrades: false,
    quoteMaxAgeMs: 15000,
  })
  const strength = CurrencyStrengthEngine.calculate(fxBars)
  useEffect(() => {
    if (!bars.length || !symbolInfo?.trade_tick_size) { setProfile(null); return }
    const selectedBars = MarketProfileEngine.selectRange(bars, profileSession, profileCustomStart, profileCustomEnd)
    setProfile(selectedBars.length ? MarketProfileEngine.calculate(selectedBars, symbolInfo.trade_tick_size) : null)
  }, [bars, symbolInfo, profileSession, profileCustomStart, profileCustomEnd])
  useEffect(() => {
    if (!planner || !feed.symbolInfo) { setMarginPerLot(null); setMarginEstimate(null); return }
    let dead = false
    setMarginPerLot(null)
    const key = `${feed.symbol || symbol}|${planner.side}|${planner.entry}`
    const timer = window.setTimeout(() => {
      fetchMt5Calculation({ action: 'margin', symbol: feed.symbol || symbol, side: planner.side === 'long' ? 'buy' : 'sell', volume: 1, price: planner.entry })
        .then((result) => { if (!dead) setMarginPerLot(result.value > 0 ? { key, value: result.value } : null) })
        .catch(() => { if (!dead) setMarginPerLot(null) })
    }, 120)
    return () => { dead = true; window.clearTimeout(timer) }
  }, [planner?.entry, planner?.side, feed.symbol, feed.symbolInfo, symbol])
  useEffect(() => {
    if (!planner || !feed.symbolInfo || !sizedPlan?.volume) { setMarginEstimate(null); return }
    let dead = false
    const key = `${marginPerLotKey}|${sizedPlan.volume}`
    const timer = window.setTimeout(() => {
      fetchMt5Calculation({ action: 'margin', symbol: feed.symbol || symbol, side: planner.side === 'long' ? 'buy' : 'sell', volume: sizedPlan.volume, price: planner.entry })
        .then((result) => { if (!dead) setMarginEstimate(Number.isFinite(result.value) && result.value > 0 ? { key, value: result.value } : null) })
        .catch(() => { if (!dead) setMarginEstimate(null) })
    }, 120)
    return () => { dead = true; window.clearTimeout(timer) }
  }, [planner?.entry, planner?.side, plannerRisk, feed.symbol, feed.symbolInfo, sizedPlan?.volume, marginPerLotKey])
  const sessions = SessionEngine.getSessions()
  const contextSummary = ContextSummaryEngine.calculate({ bars, price: feed.lastPrice, keyLevels, sessions, strength, symbol: feed.symbol || symbol })
  const focusedContextBars = contextBars[contextTimeframe] ?? []
  const focusedContextKeyLevels = useMemo(() => KeyLevelsEngine.nearest(KeyLevelsEngine.calculate(focusedContextBars.slice(-500)), keyLevelPrice), [focusedContextBars, keyLevelPrice])
  const focusedContextSummary = ContextSummaryEngine.calculate({ bars: focusedContextBars, price: feed.lastPrice, keyLevels: focusedContextKeyLevels, sessions, strength, symbol: feed.symbol || symbol })
  const currencies = Object.entries(strength).sort((a, b) => b[1] - a[1])
  const vegaSnapshot: MarketContextSnapshot = {
    capturedAt: Date.now(), symbol: feed.symbol || symbol, timeframe,
    quote: { price: feed.lastPrice ?? null, bid: feed.bid ?? null, ask: feed.ask ?? null, observedAt: feed.lastTickAt ? feed.lastTickAt * 1000 : null, status: feed.status },
    mtf: mtfDirections as MarketContextSnapshot['mtf'], currencyStrength: strength, sessions, keyLevels,
    marketProfile: profile ? { poc: profile.poc, vah: profile.vah, val: profile.val, source: profile.source } : null,
    portfolioRisk: { usedRiskCash: exposure.usedRiskCash, usedRiskPercent: exposure.usedRiskPercent, incompleteStops: exposure.incompleteStops, openPositions: domainPositions.length, pendingOrders: domainOrders.length, floatingPnl: accountDomain.floatingPnl },
    riskGuard: { allowed: riskGuard.allowed, state: riskGuard.state, reasons: [...riskGuard.reasons], warnings: [...riskGuard.warnings] }, planner: plan,
  }
  const vegaAnalysis = VegaContextAdvisor.analyze(vegaSnapshot)
  const openDrawer = (id: DrawerId) => {
    if (id === 'context') setContextTimeframe(CONTEXT_TIMEFRAMES.includes(timeframe as ContextTimeframe) ? timeframe as ContextTimeframe : 'M15')
    if (id === 'alerts') setFocusedAlertId(null)
    setDrawer((current) => current === id ? null : id)
  }
  const openContextTimeframe = (tf: ContextTimeframe) => { setContextTimeframe(tf); setDrawer('context') }
  const selectInstrument = (nextSymbol: string) => {
    setSymbol(nextSymbol)
    setSymbolQuery('')
    if (!instrumentPinned) setDrawer(null)
  }
  const setPlannerTargetEnabled = (target: 'tp1' | 'tp2' | 'tp3', enabled: boolean) => {
    const next = { ...plannerTargets, [target]: enabled }
    setPlannerTargets(next)
    const active = [next.tp1, next.tp2, next.tp3]
    const share = active.some(Boolean) ? 100 / active.filter(Boolean).length : 0
    setTakeProfitAllocations(active.map((isActive) => isActive ? share : 0))
  }
  const selectPlannerTarget = (target: 'tp1' | 'tp2' | 'tp3') => {
    if (!plannerTargets[target]) setPlannerTargetEnabled(target, true)
    setPlannerLevelRequest({ target, nonce: ++plannerLevelNonceRef.current })
  }
  const disablePlannerTarget = (target: 'tp1' | 'tp2' | 'tp3') => {
    setPlannerTargetEnabled(target, false)
    setPlannerLevelRequest(current => current?.target === target ? null : current)
  }
  const updateTargetAllocation = (index: number, value: number) => {
    const active = [plannerTargets.tp1, plannerTargets.tp2, plannerTargets.tp3]
    const nextValue = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
    const otherCount = active.filter((enabled, targetIndex) => enabled && targetIndex !== index).length
    setTakeProfitAllocations(active.map((enabled, targetIndex) => !enabled ? 0 : targetIndex === index ? nextValue : otherCount ? (100 - nextValue) / otherCount : 100))
  }
  const resetMarketProfile = () => {
    setProfileSession('day')
    setProfileCustomStart('')
    setProfileCustomEnd('')
    setProfileView(DEFAULT_PROFILE_VIEW)
  }
  const activateDrawingTool = (tool: string, label?: string) => {
    const note = (label ?? (tool === 'text' ? drawingNote : '')).trim()
    if (tool === 'text' && !note) {
      setDrawTool('text')
      setDrawer('drawing')
      return
    }
    notifyConsole(`${DRAWING_TOOLS.find(t => t.id === tool)?.label.toUpperCase() || tool.toUpperCase()} · ZAZNACZ PUNKTY NA WYKRESIE`)
    setDrawTool(tool)
    setDrawingRequest({ tool, nonce: Date.now(), ...(tool === 'text' ? { label: note } : {}) })
    setQuickDrawTools((current) => [tool, ...current.filter((item) => item !== tool)].slice(0, 3))
    setDrawer(null)
  }
  const requestPlan = (side: PlannerSide, proposal?: { entry: number; sl: number; tp: number }) => {
    setDrawingRequest(null)
    setDrawTool('')
    setSelectedPositionTicket(null)
    setSelectedOrderTicket(null)
    notifyConsole(`POZYCJA ${side === 'long' ? 'DŁUGA' : 'KRÓTKA'} · USTAW NA WYKRESIE`)
    setPlannerRequest({ side, nonce: Date.now(), ...(proposal ? { proposal } : {}) })
    setDrawer(null)
    if (!dragon) setToast(lunaMessage(`POZYCJA ${side === 'long' ? 'DŁUGA' : 'KRÓTKA'} · USTAW NA WYKRESIE`))
  }
  const cancelPlan = () => { notifyConsole('PLAN ANULOWANY'); setPlannerLevelRequest(null); setPlannerCancelRequest({ nonce: Date.now() }) }
  const saveAlert = () => {
    const level = Number(alertDraft)
    if (!(level > 0)) return
    if (focusedAlertId) {
      const rules = activeAlertsRef.current.map((rule) => rule.id === focusedAlertId ? { ...rule, level, condition: alertCondition, symbol: feed.symbol || symbol } : rule)
      activeAlertsRef.current = rules
      setActiveAlerts(rules)
      return
    }
    const rule = { id: crypto.randomUUID(), symbol: feed.symbol || symbol, level, condition: alertCondition, enabled: true } as AlertRule
    const rules = [rule, ...activeAlertsRef.current]
    activeAlertsRef.current = rules
    setActiveAlerts(rules)
    setAlertDraft('')
  }
  const updateAlerts = (update: AlertRule[] | ((current: AlertRule[]) => AlertRule[])) => {
    const rules = typeof update === 'function' ? update(activeAlertsRef.current) : update
    activeAlertsRef.current = rules
    setActiveAlerts(rules)
    if (focusedAlertId && !rules.some((rule) => rule.id === focusedAlertId)) setFocusedAlertId(null)
  }
  const focusAlert = (id: string) => {
    const rule = activeAlertsRef.current.find((item) => item.id === id)
    if (!rule) return
    if (symbol !== rule.symbol) setSymbol(rule.symbol)
    setFocusedAlertId(rule.id)
    setAlertDraft(String(rule.level))
    setAlertCondition(rule.condition)
    setDrawer('alerts')
  }
  const startBottomResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const panel = event.currentTarget.closest('.sf-bottom-panel')
    const parentHeight = panel?.parentElement?.getBoundingClientRect().height ?? window.innerHeight
    const minHeight = dragon ? Math.min(180, parentHeight * 0.25) : parentHeight * 0.55
    const maxHeight = parentHeight * (dragon ? 0.38 : 0.65)
    const startHeight = Math.max(panel?.getBoundingClientRect().height ?? bottomHeight, minHeight)
    setBottomExpanded(true)
    setBottomHeight(startHeight)
    const move = (moveEvent: PointerEvent) => setBottomHeight(Math.max(minHeight, Math.min(maxHeight, startHeight + startY - moveEvent.clientY)))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }
  const selectPosition = (position: Mt5Position) => {
    setSelectedPositionTicket(position.ticket)
    setSelectedOrderTicket(null)
    if (symbol !== position.symbol) setSymbol(position.symbol)
    setBottomTab('positions')
    setBottomExpanded(true)
    setDrawer('planner')
  }
  const selectOrder = (order: Mt5Order) => {
    setSelectedOrderTicket(order.ticket)
    setSelectedPositionTicket(null)
    if (symbol !== order.symbol) setSymbol(order.symbol)
    setBottomTab('orders')
    setBottomExpanded(true)
    setDrawer(null)
  }
  const requestEmergencyClose = () => {
    notifyConsole('Zamykanie pozycji z terminalu nie jest jeszcze dostępne. Zamknij je bezpośrednio w MT5.')
    if (!dragon) setToast('Luna › Zamknij pozycje bezpośrednio w MT5. Ta funkcja nie wysyła zleceń zamykających.')
  }
  const candleTimer = formatCountdown(candleRemainingSeconds(timeframe, clockNow))
  const serverTime = formatMt5ServerTime(feed.lastTickAt)
  const plannerTargetLots = allocateTargetLots(metrics?.volume ?? 0, takeProfitAllocations, [plannerTargets.tp1 && planner?.tp1 != null, plannerTargets.tp2 && planner?.tp2 != null, plannerTargets.tp3 && planner?.tp3 != null], symbolInfo?.volume_step ?? 0.01)
  useEffect(() => {
    if (!planner || !sizedPlan?.volume || !brokerPlanKey || feed.status !== 'live') { setBrokerPlan(null); return }
    const controller = new AbortController()
    let dead = false
    let timer = 0
    const targetPrices = [planner.tp1, planner.tp2, planner.tp3]
    const volume = sizedPlan.volume
    const calculate = async () => {
      try {
        const request = (stop: number, lots: number) => fetchMt5Calculation({ action: 'profit', symbol: feed.symbol || symbol, side: planner.side === 'long' ? 'buy' : 'sell', volume: lots, price: planner.entry, stop }, controller.signal)
        const [sl, fullTp, ...targets] = await Promise.all([
          request(planner.sl, volume), request(planner.tp, volume),
          ...targetPrices.map((price, index) => price != null && plannerTargetLots[index] > 0 ? request(price, plannerTargetLots[index]) : Promise.resolve(null)),
        ])
        if (dead) return
        if ([sl, fullTp, ...targets].some(value => value && (value.symbol !== (feed.symbol || symbol) || value.currency !== accountDomain.currency))) throw new Error('Niezgodny instrument lub waluta kalkulacji MT5.')
        setBrokerPlan({ key: brokerPlanKey, fullTp: fullTp.value, loss: Math.max(0, -sl.value), targets: targets.map(value => value?.value ?? null), reward: targets.reduce((sum, value) => sum + (value?.value ?? 0), 0) })
      } catch {
        if (!dead) setBrokerPlan(null)
      } finally {
        if (!dead) timer = window.setTimeout(calculate, 5000)
      }
    }
    timer = window.setTimeout(calculate, 150)
    return () => { dead = true; window.clearTimeout(timer); controller.abort() }
  }, [brokerPlanKey, feed.status])
  const signedProfit = (value: number | null | undefined) => value == null ? null : `${value < 0 ? '−' : '+'}${money(Math.abs(value), accountDomain.currency)}`
  const plannerTargetProfitLabels = [0, 1, 2].map(index => signedProfit(currentBrokerPlan?.targets[index]))
  const plannerFullTpProfitLabel = signedProfit(currentBrokerPlan?.fullTp)
  const plannerFullSlLossLabel = currentBrokerPlan ? `−${money(currentBrokerPlan.loss, accountDomain.currency)}` : null
  useEffect(() => {
    setConsoleNotice(null)
    setDrawingRequest(null)
    setDrawTool('')
  }, [symbol, timeframe])

  return <main className={`${dragon ? 'sf-app sf-dragon sf-matrix' : 'sf-app'}${ambientMotionPaused && dragon ? ' dragon-motion-paused' : ''}`}>
    <header className="sf-topbar">
      <div className="sf-brand" aria-hidden="true" />
      <div className="sf-account-metrics">
        <Metric label="MARGIN" value={money(account?.margin, account?.currency)} />
        <Metric label="WOLNY MARGIN" value={money(account?.margin_free, account?.currency)} />
        <Metric label="WYNIK DNIA" value={money(account?.day_pnl, account?.currency)} positive={(account?.day_pnl ?? 0) >= 0} />
        <Metric label="WIN RATE DZIENNY" value={Number.isFinite(account?.daily_win_rate) ? `${account.daily_win_rate.toFixed(1)}%` : 'N/A'} />
        <Metric label="DO ŚWIECY" value={candleTimer} />
        <Metric label="SERVER (UTC)" value={serverTime} />
      </div>
      <div className="sf-top-right"><span className={`sf-live-dot ${feed.status}`} />{feed.status === 'live' ? 'MT5 · NA ŻYWO' : feed.status === 'error' ? 'MT5 · NIEDOSTĘPNY' : feed.status === 'connecting' ? 'MT5 · ŁĄCZENIE' : feed.status === 'history' ? 'MT5 · HISTORIA' : feed.status === 'closed' ? 'MT5 · ZAMKNIĘTY' : 'MT5 · NIEAKTUALNY'}<button className="sf-terminal-exit" aria-label="Zamknij terminal i most MT5" title="Zamknij terminal i most MT5" onClick={() => window.dispatchEvent(new Event('smartflow-x:shutdown'))}>⏻ WYJDŹ</button></div>
    </header>

    <section className="sf-main-grid">
      <aside className="sf-left-column">
        <div className="sf-panel sf-watchlist">
          <div className="sf-section-title"><span>INSTRUMENTY</span><button onClick={() => openDrawer('instruments')} aria-label="Otwórz wybór instrumentu">⌕</button></div>
          {QUICK_SYMBOLS.map((s, i) => <button key={s} className={`sf-watch-row ${symbol === s ? 'active' : ''}`} onClick={() => setSymbol(s)}>
            <span className={`sf-asset-icon asset-${i}`}>{i === 0 ? 'Au' : i === 1 ? '₿' : '30'}</span><span className="sf-watch-symbol">{s}<small>{i === 0 ? 'GOLD / USD' : i === 1 ? 'BITCOIN / USD' : 'DOW JONES'}</small></span><span className="sf-watch-quote">{symbol === s ? compact(feed.lastPrice) : '—'}<small className={feed.status === 'live' ? 'positive' : ''}>{symbol === s && feed.status === 'live' ? 'LIVE' : 'WATCH'}</small></span>
          </button>)}
        </div>
        <div className="sf-panel sf-vega">
          <div className="sf-section-title"><span>VEGA AI</span><span className="sf-pill"><i /> ANALIZA</span></div>
          <div className="sf-vega-portrait"><img src={vegaPortrait} alt="Zatwierdzona postać VEGA z Main Shell" /></div>
          <p>{vegaAnalysis.summary}</p>
        </div>
      </aside>

      <section className="sf-center-column">
        <div className="sf-chart-toolbar">
          <button className="sf-symbol-trigger" onClick={() => openDrawer('instruments')}><span className="sf-asset-icon">{symbol === 'XAUUSD' ? 'Au' : symbol === 'BTCUSD' ? '₿' : '30'}</span>{symbol}<b>⌄</b></button>
          <div className="sf-timeframes">{TIMEFRAMES.map((tf) => <button key={tf} className={timeframe === tf ? 'active' : ''} onClick={() => setTimeframe(tf)}>{tf}</button>)}</div>
          {dragon && <div className="dragon-chart-navigation" aria-label="Sterowanie wykresem">
            <button type="button" className={autoScrollEnabled ? 'is-active' : ''} aria-label="Automatyczne przewijanie" aria-pressed={autoScrollEnabled} onClick={() => setAutoScrollEnabled(value => !value)} title="Śledź najnowszą cenę">↧ <span>AUTO</span></button>
            <button type="button" className={chartShiftEnabled ? 'is-active' : ''} aria-label="Przesunięcie wykresu" aria-pressed={chartShiftEnabled} onClick={() => setChartShiftEnabled(value => !value)} title="Margines prawej strony">↤ <span>PRZESUŃ</span></button>
          </div>}

          {dragon && <div className="dragon-clock">
            <span className={`dragon-clock-live ${feed.status === 'live' ? 'is-live' : 'is-offline'}`} aria-label={feed.status === 'live' ? 'MT5 na żywo' : `MT5 ${feed.status === 'error' ? 'niedostępny' : feed.status === 'connecting' ? 'łączenie' : feed.status === 'stale' ? 'nieaktualny' : feed.status === 'closed' ? 'zamknięty' : 'historia'}`}><i aria-hidden="true">›</i> MT5 <b>{feed.status === 'live' ? 'NA ŻYWO' : feed.status === 'error' ? 'NIEDOSTĘPNY' : feed.status === 'connecting' ? 'ŁĄCZENIE' : feed.status === 'stale' ? 'NIEAKTUALNY' : feed.status === 'closed' ? 'ZAMKNIĘTY' : 'HISTORIA'}</b></span>
            <span className="dragon-clock-candle"><i aria-hidden="true">◷</i> DO ŚWIECY <b>{candleTimer}</b></span>
            <span className="dragon-clock-server"><i>UTC</i> {serverTime}</span>
            <button type="button" className="dragon-motion-toggle" aria-label={ambientMotionPaused ? 'Wznów animacje interfejsu' : 'Zatrzymaj animacje interfejsu'} aria-pressed={!ambientMotionPaused} title={ambientMotionPaused ? 'Wznów efekty terminalu' : 'Zatrzymaj efekty terminalu'} onClick={() => setAmbientMotionPaused(value => !value)}>{ambientMotionPaused ? 'EFEKTY WYŁ.' : 'EFEKTY WŁ.'}</button>
          </div>}
          <div className="sf-chart-actions">
            <button onClick={() => openDrawer('drawing')}>╱ <span>RYSUJ</span></button><button onClick={() => openDrawer('indicators')}>ƒx <span>WSKAŹNIKI</span></button><button onClick={() => openDrawer('alerts')}>♧ <span>ALERTY</span></button><button className={profileEnabled ? 'active' : ''} title="Profil rynku · pokaż lub ukryj" onClick={() => setProfileEnabled((value) => !value)}>▤ <span>PROFIL</span></button><button className="sf-profile-settings-button" title="Ustawienia profilu rynku" aria-label="Ustawienia profilu rynku" onClick={() => openDrawer('profile')}>⚙</button>{quickDrawTools.map((tool) => <button key={tool} type="button" className={drawTool === tool ? 'sf-quick-draw active' : 'sf-quick-draw'} title={'Szybkie rysowanie: ' + (DRAWING_TOOLS.find(item => item.id === tool)?.label || tool)} onClick={() => activateDrawingTool(tool)}>{({ horizontal: 'H', trend: '↗', fib: 'F' } as Record<string, string>)[tool] || tool.slice(0, 1).toUpperCase()}</button>)}
          </div>
        </div>
        <div className={`sf-chart-box${selectedIndicator.includes('RSI') && indicatorSettings.RSI?.visible !== false ? ' has-rsi-pane' : ''}`}>
        {dragon && <aside className="dragon-art matrix-agent-art" aria-label="Statyczne tło wykresu z agentką AI"><img src={`${import.meta.env.BASE_URL}assets/chart-agent-background-v3.png`} alt="Statyczne, ilustracyjne tło wykresu z agentką AI po lewej stronie" hidden={agentAssetMissing} onError={() => setAgentAssetMissing(true)} />{agentAssetMissing && <p className="matrix-asset-status" role="status">Luna › Nie mogę wczytać tła wykresu.</p>}</aside>}
          <div className="sf-chart-heading"><div><strong>{symbol}</strong><span> · {timeframe} · {symbolInfo?.description || 'MT5'}</span></div><span className={`sf-chart-status ${feed.status}`}><i />{feed.status === 'live' ? 'LIVE' : feed.status.toUpperCase()}</span></div>
          <div className="sf-chart-canvas" data-target-profit-full={plannerFullTpProfitLabel ?? ''} data-target-loss-full={plannerFullSlLossLabel ?? ''} data-target-profit-tp1={plannerTargetProfitLabels[0] ?? ''} data-target-profit-tp2={plannerTargetProfitLabels[1] ?? ''} data-target-profit-tp3={plannerTargetProfitLabels[2] ?? ''}><MarketChart volumeVisible={volumeVisible} compactFeedStatus={dragon} navigationControlsExternal={dragon} autoScrollEnabled={autoScrollEnabled} onAutoScrollChange={setAutoScrollEnabled} chartShiftEnabled={chartShiftEnabled} onChartShiftChange={setChartShiftEnabled} timeframe={timeframe} symbol={symbol} plannerTargets={plannerTargets} plannerTargetProfitLabels={plannerTargetProfitLabels} plannerFullTpProfitLabel={plannerFullTpProfitLabel} plannerFullSlLossLabel={plannerFullSlLossLabel} plannerLevelRequest={plannerLevelRequest} onPlannerLevelPlacementComplete={(nonce) => setPlannerLevelRequest(current => current?.nonce === nonce ? null : current)} breakEvenMode={breakEvenMode} managedPosition={managedPosition} managedOrder={managedOrder} cancelRequest={plannerCancelRequest} onFeedStateChange={setFeed} onPlannerChange={setPlanner} onBarsChange={setBars} plannerRequest={plannerRequest} drawingRequest={drawingRequest} onDrawingComplete={result => { if (result === 'saved') notifyConsole(`${DRAWING_TOOLS.find(t => t.id === drawTool)?.label.toUpperCase() || 'RYSUNEK'} ZAPISANE`); setDrawingRequest(null); setDrawTool('') }} indicators={selectedIndicator} indicatorSettings={indicatorSettings} marketProfile={profileEnabled ? profile : null} marketProfileView={profileView} referenceLevels={referenceLevels} alerts={activeAlerts} onAlertSelect={focusAlert} simulationTickId={simulationTickId} rangeScanId={rangeScan?.id ?? 0} rangeScanDetected={rangeScan?.detected ?? false} /></div>
          {dragon && <CrtChartConsole notice={consoleNotice} motionPaused={ambientMotionPaused} periodPrompt={periodPrompt} onPeriodCancel={() => setPeriodPrompt(null)} onPeriodSubmit={(id, period) => { setIndicatorSettings(current => ({...current,[id]:{...current[id],visible:true,period}})); setSelectedIndicator(current => current.includes(id) ? current : [...current,id]); setPeriodPrompt(null); notifyConsole(`${id.split(' ')[0]} ${period} WŁĄCZONO`) }} />}
          {dragon && <TerminalStatus feed={feed} account={account} positions={positions} orders={orders} positionsObservedAt={positionsObservedAt} ordersObservedAt={ordersObservedAt} clockNow={clockNow} focus={terminalFocus} onFocus={setTerminalFocus} symbol={symbol} alertEvents={alertEvents} />}
          {drawer && <div className={`sf-large-drawer sf-drawer-${drawer}`} role="dialog" aria-label={titleForDrawer(drawer)}>
            <div className="sf-drawer-head"><span><small>&gt; MODUŁ / TERMINAL LOKALNY</small><strong>{titleForDrawer(drawer)}</strong></span><button className="sf-close" onClick={() => setDrawer(null)} aria-label="Zamknij">×</button></div>
            <ModuleDrawer drawer={drawer} plannerTargets={plannerTargets} fullTpProfitLabel={plannerFullTpProfitLabel} setPlannerTargetEnabled={setPlannerTargetEnabled} selectPlannerTarget={selectPlannerTarget} disablePlannerTarget={disablePlannerTarget} takeProfitAllocations={takeProfitAllocations} updateTargetAllocation={updateTargetAllocation} breakEvenMode={breakEvenMode} setBreakEvenMode={setBreakEvenMode} timeframe={timeframe} contextTimeframe={contextTimeframe} symbol={feed.symbol || symbol} feed={feed} planner={planner} metrics={metrics} marginEstimate={currentMarginEstimate} planRisk={plannerRisk} setPlanRisk={setPlannerRisk} requestPlan={requestPlan} exposure={exposure} guard={riskGuard} currencies={currencies} strengthLoading={strengthLoading} sessions={sessions} profile={profile} profileEnabled={profileEnabled} setProfileEnabled={setProfileEnabled} profileSession={profileSession} setProfileSession={setProfileSession} profileCustomStart={profileCustomStart} setProfileCustomStart={setProfileCustomStart} profileCustomEnd={profileCustomEnd} setProfileCustomEnd={setProfileCustomEnd} profileView={profileView} setProfileView={setProfileView} resetMarketProfile={resetMarketProfile} drawTool={drawTool} setDrawTool={activateDrawingTool} drawingNote={drawingNote} setDrawingNote={setDrawingNote} selectedIndicator={selectedIndicator} setSelectedIndicator={setSelectedIndicator} indicatorQuery={indicatorQuery} setIndicatorQuery={setIndicatorQuery} indicatorSettings={indicatorSettings} setIndicatorSettings={setIndicatorSettings} alerts={activeAlerts} setAlerts={updateAlerts} alertEvents={alertEvents} focusedAlertId={focusedAlertId} setFocusedAlertId={setFocusedAlertId} focusAlert={focusAlert} alertDraft={alertDraft} setAlertDraft={setAlertDraft} alertCondition={alertCondition} setAlertCondition={setAlertCondition} addAlert={saveAlert} symbolQuery={symbolQuery} setSymbolQuery={setSymbolQuery} symbolResults={symbolResults} setSymbol={setSymbol} selectInstrument={selectInstrument} instrumentPinned={instrumentPinned} setInstrumentPinned={setInstrumentPinned} setDrawer={setDrawer} mtfDirections={mtfDirections} contextSummary={contextSummary} focusedContextSummary={focusedContextSummary} keyLevels={keyLevels} focusedContextKeyLevels={focusedContextKeyLevels} breakeven={breakeven} breakEvenRule={breakEvenRule} managedPosition={managedPosition} requestEmergencyClose={requestEmergencyClose} pendingOrderCount={orders.length} positions={positions.length} />
          </div>}
        </div>
        <div className="sf-context-strip"><button className="sf-context-title" onClick={() => openDrawer('fx')}>KONTEKST RYNKU <small>KONTEKST WALUTOWY</small></button>{CONTEXT_TIMEFRAMES.map((tf) => { const trend = mtfDirections[tf]; const state = trend === 'bullish' ? 'WZROSTOWY' : trend === 'bearish' ? 'SPADKOWY' : trend === 'unavailable' ? 'BRAK DANYCH' : 'NEUTRALNY'; return <button className={`sf-mtf-card ${trend === 'bullish' ? 'bull' : trend === 'bearish' ? 'bear' : ''}`} key={tf} onClick={() => openContextTimeframe(tf)} aria-label={`${tf}: ${state}`}><span>{tf}</span><i className={`sf-direction-bar sf-direction-${trend}`} aria-hidden="true">{[0,1,2,3,4].map(segment=><i key={segment}/>)}</i><b>{state}</b></button> })}<div className="sf-context-meta"><span>SESJA <b>{contextSummary.activeSession}</b></span><span>WOL. <b>{contextSummary.volatilityState}</b></span><span>SIŁA <b>{contextSummary.strengthValue === null ? '—' : contextSummary.strengthValue.toFixed(2)}</b></span><span>POZIOM <b>{contextSummary.keyLevelRelation}</b></span></div></div>
        {!dragon && <section className={'sf-bottom-panel ' + (bottomExpanded ? 'expanded' : '')} style={{ '--sf-bottom-height-base': bottomExpanded ? bottomHeight + 'px' : '150px' } as CSSProperties} data-bottom-height={bottomHeight}>
          <button type="button" className="sf-bottom-resize" aria-label="Zmień wysokość dolnego panelu" onPointerDown={startBottomResize}><span /></button>
          <div className="sf-bottom-tabs"><button className={bottomTab === 'positions' ? 'active' : ''} onClick={() => { setBottomTab('positions'); setBottomExpanded(true) }}>POZYCJE <small>({positions.length})</small></button><button className={bottomTab === 'orders' ? 'active' : ''} onClick={() => { setBottomTab('orders'); setBottomExpanded(true) }}>ZLECENIA <small>({orders.length})</small></button><button className={bottomTab === 'account' ? 'active' : ''} onClick={() => { setBottomTab('account'); setBottomExpanded(true) }}>KONTO</button><button className="sf-expand-bottom" onClick={() => setBottomExpanded((value) => !value)}>{bottomExpanded ? '⌄' : '⌃'}</button></div>
          <BottomTable expanded={bottomExpanded} tab={bottomTab} positions={positions} orders={orders} account={account} symbol={symbol} selectedPositionTicket={selectedPositionTicket} selectedOrderTicket={selectedOrderTicket} onSelectPosition={selectPosition} onSelectOrder={selectOrder} />
        </section>}
      </section>
      <aside className={dragon ? 'sf-right-column matrix-text-column' : 'sf-right-column'}>
        {dragon ? <MatrixCommandDeck
          quoteSample={`${feed.bid}|${feed.ask}`} executionPanel={<DemoExecutionPanel feed={feed} planner={planner} volume={metrics?.volume ?? null} unsupportedManagement={Object.values(plannerTargets).some(Boolean) || breakEvenMode !== 'off'} />}
          feedStatus={feed.status} contextLive={feed.status === 'live' && contextObservedAt > 0 && Date.now() - contextObservedAt < 65000}
          contextSnapshots={Object.fromEntries(CONTEXT_TIMEFRAMES.map(tf => [tf, JSON.stringify(contextBars[tf]?.at(-1) ?? null)]))}
          onPreviewPhosphor={() => setSimulationTickId(id => id + 1)} onPreviewScan={() => setRangeScan({id:++rangeScanSequence.current,detected:false})} scanRunning={Boolean(rangeScan)}
          symbol={feed.symbol || symbol} contextTimeframe={contextTimeframe} directions={mtfDirections} session={`${contextSummary.activeSession} · ${contextSummary.volatilityState}`}
          onContext={tf => setContextTimeframe(tf as ContextTimeframe)} levels={PRICE_LEVEL_GROUP_OPTIONS} activeLevels={priceLevelGroups} onLevel={togglePriceLevelGroup}
          indicators={selectedIndicator} settings={indicatorSettings} onPeriodRequest={id => setPeriodPrompt({indicator:id as 'SMA 20'|'EMA 50',token:++periodPromptSequence.current})}
          onIndicator={id => { const active = selectedIndicator.includes(id) && indicatorSettings[id]?.visible !== false; const names: Record<string,string> = {'Bollinger Bands':'WSTĘGI BOLLINGERA'}; notifyConsole(`${names[id] || id} ${active ? 'WYŁĄCZONO' : 'WŁĄCZONO'}`); setSelectedIndicator(current => active ? current.filter(x => x !== id) : current.includes(id) ? current : [...current, id]); if (!active) setIndicatorSettings(current => ({...current, [id]: {...current[id], visible:true}})) }}
          onPeriod={(id, period) => setIndicatorSettings(current => ({...current,[id]:{...current[id],visible:current[id]?.visible !== false,period}}))}
          profile={profileEnabled} onProfile={() => {notifyConsole(`PROFIL RYNKU ${profileEnabled ? 'WYŁĄCZONO' : 'WŁĄCZONO'}`); setProfileEnabled(v => !v)}}
          volume={volumeVisible} onVolume={() => {notifyConsole(`WOLUMEN TICKOWY ${volumeVisible ? 'WYŁĄCZONO' : 'WŁĄCZONO'}`); setVolumeVisible(v => !v)}} drawing={drawTool} onDrawing={activateDrawingTool}
          planner={planner} lot={plannerLot} appliedLot={metrics?.volume ?? null} onLot={setPlannerLot} targets={plannerTargets} targetLots={plannerTargetLots}
          allocations={takeProfitAllocations} volumeStep={symbolInfo?.volume_step || .01} placing={plannerLevelRequest?.target ?? null} onTarget={selectPlannerTarget}
          onDisableTarget={disablePlannerTarget} onAllocation={updateTargetAllocation} onPlan={requestPlan} onCancel={cancelPlan} paused={ambientMotionPaused}
        /> : <>
        <div className="sf-panel sf-planner-card">
          <div className="sf-panel-title"><span>{managedPosition ? 'MANAGE POSITION' : 'TRADE PLANNER PRO'}</span>{!dragon && <button aria-label="Otwórz Trade Planner Pro" onClick={() => openDrawer('planner')}>↗</button>}</div>
          <div className="sf-side-buttons"><button className="long" aria-pressed={planner?.side === 'long'} onClick={() => requestPlan('long')}>↗ LONG</button><button className="short" aria-pressed={planner?.side === 'short'} onClick={() => requestPlan('short')}>↘ SHORT</button></div>
          <div className="dragon-planner-risk">
            <label htmlFor="dragon-risk-range"><span>RISK / TRADE</span><output>{plannerRisk.toFixed(1)}%</output></label>
            <input id="dragon-risk-range" aria-label="Ryzyko na transakcję" type="range" min="0.1" max="2" step="0.1" value={plannerRisk} style={{'--crt-fill': `${(plannerRisk - 0.1) / 1.9 * 100}%`} as CSSProperties} onChange={(event) => setPlannerRisk(Number(event.target.value))} />
            <div className="dragon-planner-risk-profit"><span>STRATA PRZY SL <b>{plannerFullSlLossLabel ?? '—'}</b></span><span>ZYSK PRZY TP <b>{planTargets.length ? signedProfit(currentBrokerPlan?.reward) ?? '—' : plannerFullTpProfitLabel ?? '—'}</b></span></div>
          </div>
          {planner ? <>
            <div className="dragon-target-selector" aria-label="Wybierz cel TP do ustawienia">{(['tp1', 'tp2', 'tp3'] as const).map((target) => <button key={target} type="button" aria-pressed={plannerTargets[target]} className={`${plannerTargets[target] ? 'is-active' : ''}${plannerLevelRequest?.target === target ? ' is-placing' : ''}`} onClick={() => selectPlannerTarget(target)}>{target.toUpperCase()}</button>)}</div>
          <div className="dragon-target-allocations">{(['tp1', 'tp2', 'tp3'] as const).map((target, index) => {
            if (!plannerTargets[target]) return null
            const totalLots = metrics?.volume ?? 0
            const step = symbolInfo?.volume_step || 0.01
            const targetLots = plannerTargetLots[index]
            const price = index === 0 ? planner?.tp1 : index === 1 ? planner?.tp2 : planner?.tp3
            return <div className="dragon-target-row" key={target}>
              <span><b>{target.toUpperCase()}</b><small>{price && symbolInfo ? price.toFixed(symbolInfo.digits) : 'SET ON CHART'}</small></span>
              <input type="range" aria-label={`${target.toUpperCase()} lotów do zamknięcia`} min="0" max={Math.max(totalLots, step)} step={step} value={totalLots ? Math.min(totalLots, targetLots) : 0} disabled={!totalLots} style={{'--crt-fill': `${totalLots ? Math.min(100, targetLots / totalLots * 100) : 0}%`} as CSSProperties} onChange={(event) => updateTargetAllocation(index, totalLots ? Number(event.target.value) / totalLots * 100 : 0)} />
              <output>{totalLots ? targetLots.toFixed(2) : '—'} <small>LOT</small></output>
              <button type="button" className="dragon-target-disable" aria-label={`Wyłącz ${target.toUpperCase()}`} title={`Wyłącz ${target.toUpperCase()}`} onClick={() => disablePlannerTarget(target)}>×</button>
            </div>
          })}</div>
          <button type="button" className="sf-danger-button dragon-planner-cancel" onClick={cancelPlan}>ANULUJ PLAN</button>
          </> : <p className="sf-planner-target-hint">USTAW BAZOWĄ POZYCJĘ NA WYKRESIE, ABY WYBRAĆ TP1 / TP2 / TP3</p>}
          <p className="sf-readonly-note">PLAN PODGLĄDOWY · ZLECENIA WYŁĄCZONE</p>
        </div>
        {!dragon && <div className={`sf-panel sf-risk-card ${riskGuard.state.toLowerCase()}`}>
          <div className="sf-panel-title"><span>⬡ RISK GUARD</span><button onClick={() => openDrawer('risk')}>↗</button></div>
          <div className="sf-guard-state"><span className="sf-shield">⬡</span><strong>{riskGuard.state === 'BLOCKED' ? 'BLOCKED' : riskGuard.state}</strong></div>
          <div className="sf-guard-meter"><span style={{ width: `${Math.min(100, exposure.usedRiskPercent / 5 * 100)}%` }} /></div>
          <div className="sf-risk-detail"><span>Maks. ryzyko</span><b>2.00%</b><span>Ekspozycja</span><b>{exposure.usedRiskPercent.toFixed(2)}%</b><span>Limit dzienny</span><b>{money(account?.day_pnl, account?.currency)}</b></div>
          {riskGuard.reasons.length > 0 && <button className="sf-block-reason" onClick={() => openDrawer('risk')}>{lunaRisk(riskGuard.reasons[0])}</button>}
          {riskGuard.reasons.length === 0 && riskGuard.warnings.length > 0 && <button className="sf-warning-reason" onClick={() => openDrawer('risk')}>{lunaRisk(riskGuard.warnings[0])}</button>}
        </div>}
        </>}
      </aside>
    </section>

    {toast && <div className="sf-toast">{toast}</div>}
  </main>
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) { return <div className="sf-metric"><small>{label}</small><strong className={positive ? 'positive' : ''}>{value}</strong></div> }
function Field({ label, value, green, red }: { label: string; value: string; green?: boolean; red?: boolean }) { return <div className="sf-field"><span>{label}</span><b className={green ? 'positive' : red ? 'negative' : ''}>{value}</b></div> }

type BottomTableProps = {
  expanded: boolean
  tab: BottomTab
  positions: Mt5Position[]
  orders: Mt5Order[]
  account: any
  symbol: string
  selectedPositionTicket: number | null
  selectedOrderTicket: number | null
  onSelectPosition: (position: Mt5Position) => void
  onSelectOrder: (order: Mt5Order) => void
}

function AccountSummary({ account }: { account: any }) {
  const metrics: [string, string][] = [
    ['BALANCE', money(account?.balance, account?.currency)],
    ['EQUITY', money(account?.equity, account?.currency)],
    ['MARGIN', money(account?.margin, account?.currency)],
    ['FREE MARGIN', money(account?.margin_free, account?.currency)],
    ['FLOATING P&L', money(account?.profit, account?.currency)],
    ['MARGIN LEVEL', account?.margin_level ? account.margin_level.toFixed(1) + '%' : '—'],
  ]
  return <div className="sf-account-row">{metrics.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>
}

function PositionsTable({ positions, account, symbol, selectedPositionTicket, onSelectPosition }: Pick<BottomTableProps, 'positions' | 'account' | 'symbol' | 'selectedPositionTicket' | 'onSelectPosition'>) {
  return <table className="sf-table"><thead><tr><th>SYMBOL</th><th>TYPE</th><th>VOLUME</th><th>ENTRY</th><th>P&amp;L ({account?.currency || 'USD'})</th><th>SL</th><th>TP</th><th>SWAP / COMM.</th><th>STATUS</th></tr></thead><tbody>
    {positions.length ? positions.map((position) => <tr key={position.ticket} data-position-ticket={position.ticket} className={selectedPositionTicket === position.ticket ? 'sf-row-selected' : ''} tabIndex={0} onClick={() => onSelectPosition(position)} onKeyDown={(event) => { if (event.key === 'Enter') onSelectPosition(position) }}>
      <td>{position.symbol}</td><td className={position.type === 'buy' ? 'positive' : 'negative'}>{position.type.toUpperCase()}</td><td>{position.volume.toFixed(2)}</td><td>{compact(position.price_open)}</td><td className={position.profit >= 0 ? 'positive' : 'negative'}>{money(position.profit, account?.currency)}</td><td>{position.sl ? compact(position.sl) : '—'}</td><td>{position.tp ? compact(position.tp) : '—'}</td><td>{money(position.swap + position.commission, account?.currency)}</td><td>OPEN</td>
    </tr>) : <tr><td colSpan={9} className="sf-empty-row">Brak otwartych pozycji · {symbol} · bridge tylko do odczytu</td></tr>}
  </tbody></table>
}

function OrdersTable({ orders, selectedOrderTicket, onSelectOrder }: Pick<BottomTableProps, 'orders' | 'selectedOrderTicket' | 'onSelectOrder'>) {
  return <table className="sf-table"><thead><tr><th>SYMBOL</th><th>TICKET</th><th>TYPE</th><th>VOLUME</th><th>TRIGGER PRICE</th><th>SL</th><th>TP</th><th>STATUS</th></tr></thead><tbody>
    {orders.length ? orders.map((order) => <tr key={order.ticket} data-order-ticket={order.ticket} className={selectedOrderTicket === order.ticket ? 'sf-row-selected' : ''} tabIndex={0} onClick={() => onSelectOrder(order)} onKeyDown={(event) => { if (event.key === 'Enter') onSelectOrder(order) }}>
      <td>{order.symbol}</td><td>{order.ticket}</td><td>{order.type}</td><td>{order.volume_initial.toFixed(2)}</td><td>{compact(order.price_open)}</td><td>{order.sl ? compact(order.sl) : '—'}</td><td>{order.tp ? compact(order.tp) : '—'}</td><td>PENDING</td>
    </tr>) : <tr><td colSpan={8} className="sf-empty-row">Brak oczekujących zleceń z bridge MT5</td></tr>}
  </tbody></table>
}

function BottomTable({ expanded, tab, positions, orders, account, symbol, selectedPositionTicket, selectedOrderTicket, onSelectPosition, onSelectOrder }: BottomTableProps) {
  if (!expanded && tab === 'account') return <AccountSummary account={account} />
  if (!expanded && tab === 'orders') return <OrdersTable orders={orders} selectedOrderTicket={selectedOrderTicket} onSelectOrder={onSelectOrder} />
  if (!expanded) return <PositionsTable positions={positions} account={account} symbol={symbol} selectedPositionTicket={selectedPositionTicket} onSelectPosition={onSelectPosition} />

  return <div className="sf-bottom-workspace" data-active-tab={tab}>
    <section className={'sf-bottom-section sf-bottom-positions' + (tab === 'positions' ? ' active' : '')} data-bottom-section="positions"><header><strong>POSITIONS</strong><span>{positions.length} OPEN</span></header><div><PositionsTable positions={positions} account={account} symbol={symbol} selectedPositionTicket={selectedPositionTicket} onSelectPosition={onSelectPosition} /></div></section>
    <section className={'sf-bottom-section sf-bottom-orders' + (tab === 'orders' ? ' active' : '')} data-bottom-section="orders"><header><strong>ORDERS</strong><span>{orders.length} PENDING</span></header><div><OrdersTable orders={orders} selectedOrderTicket={selectedOrderTicket} onSelectOrder={onSelectOrder} /></div></section>
    <section className={'sf-bottom-section sf-bottom-account' + (tab === 'account' ? ' active' : '')} data-bottom-section="account"><header><strong>ACCOUNT SUMMARY</strong><span>{account?.currency || 'USD'}</span></header><AccountSummary account={account} /></section>
  </div>
}
