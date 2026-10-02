import type {
  AccountSnapshot, AlertEvent, AlertRule, MarketBar, MarketProfile, PendingOrder,
  Position, PriceLevel, SymbolSpec, TradePlan,
} from '../domain/contracts'
import { allocateTargetLots } from '../domain/targetAllocations'

export type SizingResult = { volume: number; riskCash: number; lossAtStop: number; marginEstimate: number; cappedByMargin: boolean }

export const PositionSizingEngine = {
  calculate(input: { entry: number; stopLoss: number; riskPercent: number; equity: number; spec: SymbolSpec; commissionPerLot?: number; marginPerLot?: number; freeMargin?: number }): SizingResult {
    const { entry, stopLoss, riskPercent, equity, spec } = input
    const distance = Math.abs(entry - stopLoss)
    if (!(distance > 0) || !(spec.tickSize > 0) || !(spec.volumeStep > 0) || equity <= 0) {
      return { volume: 0, riskCash: Math.max(0, equity * riskPercent / 100), lossAtStop: 0, marginEstimate: 0, cappedByMargin: false }
    }
    const riskCash = equity * Math.max(0, riskPercent) / 100
    const tickValue = spec.tickValueLoss ?? spec.tickValue
    const cashLossPerLot = distance / spec.tickSize * tickValue + Math.max(0, input.commissionPerLot ?? 0)
    if (!(cashLossPerLot > 0)) return { volume: 0, riskCash, lossAtStop: 0, marginEstimate: 0, cappedByMargin: false }
    const raw = riskCash / cashLossPerLot
    const stepped = Math.floor((Math.min(raw, spec.volumeMax) + 1e-10) / spec.volumeStep) * spec.volumeStep
    let volume = stepped < spec.volumeMin ? 0 : Number(stepped.toFixed(8))
    let cappedByMargin = false
    const marginPerLot = input.marginPerLot
    if (volume > 0 && marginPerLot && marginPerLot > 0) {
      const marginCap = Math.floor((Math.max(0, input.freeMargin ?? Infinity) / marginPerLot) / spec.volumeStep) * spec.volumeStep
      if (marginCap < volume) { volume = Math.max(0, marginCap); cappedByMargin = true }
    }
    const marginEstimate = volume * (marginPerLot ?? 0)
    return { volume, riskCash, lossAtStop: volume * cashLossPerLot, marginEstimate, cappedByMargin }
  },
}

export type PortfolioExposure = { usedRiskCash: number; usedRiskPercent: number; incompleteStops: number; bySymbol: Record<string, number> }

export const PortfolioRiskEngine = {
  calculate(input: { equity: number; positions: Position[]; orders: PendingOrder[]; specs: Record<string, SymbolSpec> }): PortfolioExposure {
    let usedRiskCash = 0
    let incompleteStops = 0
    const bySymbol: Record<string, number> = {}
    const add = (symbol: string, volume: number, open: number, stop: number) => {
      const spec = input.specs[symbol]
      if (!spec || !(stop > 0) || !(spec.tickSize > 0)) { incompleteStops++; return }
      const loss = Math.abs(open - stop) / spec.tickSize * (spec.tickValueLoss ?? spec.tickValue) * volume
      usedRiskCash += loss
      bySymbol[symbol] = (bySymbol[symbol] ?? 0) + loss
    }
    input.positions.forEach((p) => add(p.symbol, p.volume, p.openPrice, p.stopLoss))
    input.orders.forEach((o) => add(o.symbol, o.volume, o.price, o.stopLoss))
    return { usedRiskCash, usedRiskPercent: input.equity > 0 ? usedRiskCash / input.equity * 100 : Infinity, incompleteStops, bySymbol }
  },
}

export const BreakevenEngine = {
  calculate(input: { positions: Position[]; symbol: string; spec: SymbolSpec; currentPrice?: number }): number | null {
    const positions = input.positions.filter((p) => p.symbol === input.symbol && p.volume > 0)
    if (!positions.length || !(input.spec.tickSize > 0) || !(input.spec.tickValue > 0)) return null
    const volume = positions.reduce((sum, p) => sum + p.volume, 0)
    const netCash = positions.reduce((sum, p) => sum + p.profit + p.swap + p.commission, 0)
    const signedVolume = positions.reduce((sum, p) => sum + (p.side === 'long' ? p.volume : -p.volume), 0)
    if (Math.abs(signedVolume) < 1e-8) return null
    const cashPerPriceUnit = input.spec.tickValue / input.spec.tickSize
    if (!(cashPerPriceUnit > 0)) return null
    if (input.currentPrice && input.currentPrice > 0) return input.currentPrice - netCash / (signedVolume * cashPerPriceUnit)
    if (positions.some((p) => p.side !== positions[0].side)) return null
    const weightedEntry = positions.reduce((sum, p) => sum + p.openPrice * p.volume, 0) / volume
    return weightedEntry - netCash / (volume * cashPerPriceUnit * Math.sign(signedVolume))
  },
}

export type RiskGuardInput = {
  now: number; account: AccountSnapshot; quoteObservedAt: number; proposed: TradePlan | null
  proposedMargin?: number | null
  portfolioObservedAt?: number | null; portfolioMaxAgeMs?: number
  exposure: PortfolioExposure; maxRiskPerTradePct: number; maxTotalRiskPct: number
  maxDailyLossPct: number; maxMarginUsagePct: number; quoteMaxAgeMs: number
  maxLot?: number | null; maxSpreadPoints?: number | null; maxSlippagePoints?: number | null
  spreadPoints?: number | null; slippagePoints?: number | null; blockNewTrades?: boolean
}
export type RiskGuardResult = {
  allowed: boolean; state: 'SAFE' | 'WARNING' | 'BLOCKED'; reasons: string[]; warnings: string[]
  projectedRiskPercent: number; projectedMarginUsagePct: number; dailyLossPct: number
}

export const RiskGuardEngine = {
  evaluate(input: RiskGuardInput): RiskGuardResult {
    const reasons: string[] = []
    const warnings: string[] = []
    const block = (message: string) => reasons.push(message)
    if (!input.account.tradeAllowed) block('Broker account is not permitted to trade.')
    if (input.now - input.quoteObservedAt > input.quoteMaxAgeMs || input.quoteObservedAt > input.now + 1000) block('Market quote is stale or has an invalid timestamp.')
    if (input.account.observedAt <= 0 || input.now - input.account.observedAt > input.quoteMaxAgeMs * 4) block('Account snapshot is stale.')
    if (input.portfolioObservedAt !== undefined) {
      const maxAgeMs = input.portfolioMaxAgeMs ?? 15000
      if (
        input.portfolioObservedAt === null
        || !Number.isFinite(input.portfolioObservedAt)
        || input.portfolioObservedAt <= 0
        || input.now - input.portfolioObservedAt > maxAgeMs
        || input.portfolioObservedAt > input.now + 1000
      ) block('Positions or orders snapshot is stale.')
    }
    if (input.proposed) {
      if (input.blockNewTrades) block('New trades are disabled by the Risk Guard hard policy.')
      if (input.proposed.riskPercent > input.maxRiskPerTradePct) block('Proposed risk exceeds the per-trade hard limit.')
      if (!(input.proposed.volume > 0)) block('Plan volume is unavailable or below the broker minimum.')
      if (input.maxLot != null && Number.isFinite(input.maxLot) && input.maxLot > 0 && input.proposed.volume > input.maxLot) block('Proposed volume exceeds the max-lot hard limit.')
      if (input.maxSpreadPoints != null && Number.isFinite(input.maxSpreadPoints) && input.maxSpreadPoints > 0) {
        if (input.spreadPoints == null || !Number.isFinite(input.spreadPoints) || input.spreadPoints < 0) block('Current spread is unavailable for the configured spread guard.')
        else if (input.spreadPoints > input.maxSpreadPoints) block('Current spread exceeds the configured hard limit.')
      }
      if (input.maxSlippagePoints != null && Number.isFinite(input.maxSlippagePoints) && input.maxSlippagePoints > 0) {
        if (input.slippagePoints == null || !Number.isFinite(input.slippagePoints) || input.slippagePoints < 0) block('Slippage estimate is unavailable for the configured slippage guard.')
        else if (input.slippagePoints > input.maxSlippagePoints) block('Estimated slippage exceeds the configured hard limit.')
      }
      if (input.proposed.volume > 0 && (input.proposedMargin == null || !Number.isFinite(input.proposedMargin) || input.proposedMargin <= 0)) block('Proposed margin requirement is unavailable.')
      else if (input.proposedMargin != null && Number.isFinite(input.proposedMargin) && input.proposedMargin > input.account.freeMargin) block('Proposed margin exceeds free margin.')
      if (!(input.proposed.entry > 0 && input.proposed.stopLoss > 0) || input.proposed.entry === input.proposed.stopLoss) block('Plan has no valid stop-loss distance.')
      if (input.proposed.side === 'long' && !(input.proposed.stopLoss < input.proposed.entry)) block('Long plan stop must be below entry.')
      if (input.proposed.side === 'short' && !(input.proposed.stopLoss > input.proposed.entry)) block('Short plan stop must be above entry.')
    }
    if (input.exposure.incompleteStops > 0) block('At least one open or pending position has no reliable stop-risk estimate.')
    const proposedRisk = input.proposed ? input.proposed.riskPercent : 0
    const projectedRiskPercent = input.exposure.usedRiskPercent + proposedRisk
    if (projectedRiskPercent > input.maxTotalRiskPct) block('Combined portfolio risk exceeds the hard limit.')
    const lossPct = input.account.equity > 0 ? Math.max(0, -(input.account.dayPnl ?? 0)) / input.account.equity * 100 : Infinity
    if (lossPct >= input.maxDailyLossPct) block('Daily loss limit reached.')
    if (input.account.margin > 0) {
      if (input.account.marginLevel === null || !Number.isFinite(input.account.marginLevel) || input.account.marginLevel <= 0) {
        block('Margin level is unavailable or invalid while margin is in use.')
      }
    }
    const projectedMargin = input.account.margin + (input.proposed ? input.proposedMargin ?? 0 : 0)
    const marginUsage = input.account.equity > 0 ? projectedMargin / input.account.equity * 100 : Infinity
    if (marginUsage >= input.maxMarginUsagePct) block('Projected margin usage exceeds the hard limit.')
    const nearLimit = (value: number, limit: number) => limit > 0 && value >= limit * 0.8 && value < limit
    if (input.proposed && nearLimit(proposedRisk, input.maxRiskPerTradePct)) warnings.push('Proposed risk is approaching the per-trade hard limit.')
    if (input.proposed && input.maxLot != null && Number.isFinite(input.maxLot) && nearLimit(input.proposed.volume, input.maxLot)) warnings.push('Proposed volume is approaching the max-lot hard limit.')
    if (input.maxSpreadPoints != null && input.spreadPoints != null && Number.isFinite(input.spreadPoints) && nearLimit(input.spreadPoints, input.maxSpreadPoints)) warnings.push('Current spread is approaching the configured hard limit.')
    if (input.maxSlippagePoints != null && input.slippagePoints != null && Number.isFinite(input.slippagePoints) && nearLimit(input.slippagePoints, input.maxSlippagePoints)) warnings.push('Estimated slippage is approaching the configured hard limit.')
    if (nearLimit(projectedRiskPercent, input.maxTotalRiskPct)) warnings.push('Combined portfolio risk is approaching the hard limit.')
    if (nearLimit(lossPct, input.maxDailyLossPct)) warnings.push('Daily loss is approaching the hard limit.')
    if (nearLimit(marginUsage, input.maxMarginUsagePct)) warnings.push('Projected margin usage is approaching the hard limit.')
    const allowed = reasons.length === 0
    return { allowed, state: !allowed ? 'BLOCKED' : warnings.length ? 'WARNING' : 'SAFE', reasons, warnings, projectedRiskPercent, projectedMarginUsagePct: marginUsage, dailyLossPct: lossPct }
  },
}

export type PlannerBreakEvenState = { enabled: boolean; triggered: boolean; triggerTargetIndex: number | null; price: number | null }

export const PlannerBreakEvenEngine = {
  evaluate(input: { plan: TradePlan; reachedTargetCount: number }): PlannerBreakEvenState {
    const mode = input.plan.breakEvenMode ?? 'off'
    const price = Number.isFinite(input.plan.breakEvenPrice) ? input.plan.breakEvenPrice! : input.plan.entry
    if (mode === 'off') return { enabled: false, triggered: false, triggerTargetIndex: null, price: null }
    if (mode === 'manual') return { enabled: true, triggered: true, triggerTargetIndex: null, price }
    const triggerTargetIndex = mode === 'after_tp1' ? 1 : mode === 'after_tp2' ? 2 : 3
    return { enabled: true, triggered: input.reachedTargetCount >= triggerTargetIndex, triggerTargetIndex, price }
  },
}

export const KeyLevelsEngine = {
  calculate(bars: MarketBar[], lookback = 2): PriceLevel[] {
    const levels: PriceLevel[] = []
    for (let i = lookback; i < bars.length - lookback; i++) {
      let high = true; let low = true
      for (let k = i - lookback; k <= i + lookback; k++) if (k !== i) {
        if (bars[k].high >= bars[i].high) high = false
        if (bars[k].low <= bars[i].low) low = false
      }
      if (high) levels.push({ price: bars[i].high, kind: 'resistance', time: bars[i].time })
      if (low) levels.push({ price: bars[i].low, kind: 'support', time: bars[i].time })
    }
    return levels
  },
  nearest(levels: PriceLevel[], price: number | null | undefined): PriceLevel[] {
    if (!Number.isFinite(price) || !(Number(price) > 0)) return []
    const current = Number(price)
    const support = levels.filter((level) => level.kind === 'support' && level.price < current).sort((a, b) => b.price - a.price)[0]
    const resistance = levels.filter((level) => level.kind === 'resistance' && level.price > current).sort((a, b) => a.price - b.price)[0]
    return [support, resistance].filter((level): level is PriceLevel => Boolean(level)).sort((a, b) => a.price - b.price)
  },
}

export const CurrencyStrengthEngine = {
  calculate(pairs: Record<string, MarketBar[]>): Record<string, number> {
    const raw: Record<string, number> = {}
    for (const [symbol, bars] of Object.entries(pairs)) {
      const base = symbol.slice(0, 3).toUpperCase(); const quote = symbol.slice(3, 6).toUpperCase()
      if (bars.length < 2 || base.length !== 3 || quote.length !== 3) continue
      const first = bars[0].close; const last = bars[bars.length - 1].close
      if (!(first > 0 && last > 0)) continue
      const delta = (last / first - 1) * 100
      raw[base] = (raw[base] ?? 0) + delta; raw[quote] = (raw[quote] ?? 0) - delta
    }
    const count: Record<string, number> = {}
    for (const [symbol, bars] of Object.entries(pairs)) if (bars.length >= 2) {
      const base = symbol.slice(0, 3).toUpperCase(); const quote = symbol.slice(3, 6).toUpperCase()
      if (base.length === 3 && quote.length === 3) { count[base] = (count[base] ?? 0) + 1; count[quote] = (count[quote] ?? 0) + 1 }
    }
    for (const code of Object.keys(raw)) raw[code] /= count[code] ?? 1
    return raw
  },
}

export type TradingSession = { id: 'tokyo' | 'london' | 'new_york'; open: boolean; localTime: string }
export const SessionEngine = {
  getSessions(now = new Date()): TradingSession[] {
    const specs = [
      { id: 'tokyo' as const, zone: 'Asia/Tokyo', start: 9, end: 18 },
      { id: 'london' as const, zone: 'Europe/London', start: 8, end: 17 },
      { id: 'new_york' as const, zone: 'America/New_York', start: 8, end: 17 },
    ]
    return specs.map((s) => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: s.zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
      const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
      const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
      const weekday = parts.find(p => p.type === 'weekday')?.value
      return { id: s.id, open: weekday !== 'Sat' && weekday !== 'Sun' && hour >= s.start && hour < s.end, localTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
    })
  },
}

export type ContextSummary = {
  volatilityState: 'LOW' | 'NORMAL' | 'HIGH' | 'UNAVAILABLE'
  volatilityRatio: number | null
  activeSession: string
  strengthValue: number | null
  strengthLabel: string
  nearestSupport: number | null
  nearestResistance: number | null
  keyLevelRelation: string
  structure: 'BULLISH' | 'BEARISH' | 'BALANCED' | 'UNAVAILABLE'
  summary: string
}

export const ContextSummaryEngine = {
  calculate(input: { bars: MarketBar[]; price?: number | null; keyLevels: PriceLevel[]; sessions: TradingSession[]; strength: Record<string, number>; symbol: string }): ContextSummary {
    const bars = input.bars.slice(-60)
    let volatilityRatio: number | null = null
    let volatilityState: ContextSummary['volatilityState'] = 'UNAVAILABLE'
    if (bars.length >= 20) {
      const ranges = bars.map((bar, index) => index === 0 ? bar.high - bar.low : Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index - 1].close), Math.abs(bar.low - bars[index - 1].close)))
      const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
      const recent = average(ranges.slice(-10))
      const baseline = average(ranges.slice(-Math.min(40, ranges.length)))
      if (baseline > 0) {
        volatilityRatio = recent / baseline
        volatilityState = volatilityRatio > 1.2 ? 'HIGH' : volatilityRatio < 0.8 ? 'LOW' : 'NORMAL'
      }
    }
    const active = input.sessions.filter((session) => session.open).map((session) => session.id.replace('_', ' ').toUpperCase())
    const activeSession = active.length ? active.join(' + ') : 'BRAK AKTYWNEJ'
    const cleanSymbol = input.symbol.replace(/[^A-Za-z]/g, '').toUpperCase()
    const base = cleanSymbol.slice(0, 3)
    const quote = cleanSymbol.slice(3, 6)
    const baseStrength = input.strength[base]
    const quoteStrength = input.strength[quote]
    const strengthValue = Number.isFinite(baseStrength) && Number.isFinite(quoteStrength) ? baseStrength - quoteStrength : null
    const strengthLabel = strengthValue === null ? 'N/A' : strengthValue > 0.05 ? `${base} SILNIEJSZY` : strengthValue < -0.05 ? `${quote} SILNIEJSZY` : 'ZRÓWNOWAŻONE'
    const price = input.price && input.price > 0 ? input.price : bars.at(-1)?.close ?? null
    const supports = price === null ? [] : input.keyLevels.filter((level) => level.kind === 'support' && level.price <= price).sort((a, b) => b.price - a.price)
    const resistances = price === null ? [] : input.keyLevels.filter((level) => level.kind === 'resistance' && level.price >= price).sort((a, b) => a.price - b.price)
    const nearestSupport = supports[0]?.price ?? null
    const nearestResistance = resistances[0]?.price ?? null
    const candidates = price === null ? [] : [
      ...(nearestSupport !== null ? [{ kind: 'SUPPORT', price: nearestSupport, distance: Math.abs(price - nearestSupport) / price * 100 }] : []),
      ...(nearestResistance !== null ? [{ kind: 'RESISTANCE', price: nearestResistance, distance: Math.abs(nearestResistance - price) / price * 100 }] : []),
    ].sort((a, b) => a.distance - b.distance)
    const nearest = candidates[0]
    const keyLevelRelation = nearest ? `${nearest.distance <= 0.25 ? 'PRZY' : 'DO'} ${nearest.kind} · ${nearest.distance.toFixed(2)}%` : 'BRAK POTWIERDZONEGO POZIOMU'
    let structure: ContextSummary['structure'] = 'UNAVAILABLE'
    if (bars.length >= 10) {
      const first = bars[Math.max(0, bars.length - 20)].close
      const last = bars.at(-1)!.close
      const change = first > 0 ? last / first - 1 : 0
      structure = change > 0.001 ? 'BULLISH' : change < -0.001 ? 'BEARISH' : 'BALANCED'
    }
    const summary = `${structure} · VOL ${volatilityState} · ${keyLevelRelation}`
    return { volatilityState, volatilityRatio, activeSession, strengthValue, strengthLabel, nearestSupport, nearestResistance, keyLevelRelation, structure, summary }
  },
}

export type TrendPoint = { time: number; value: number | null; direction: 'bullish' | 'bearish' | 'neutral' }
export const MTFContextEngine = {
  supertrend(bars: MarketBar[], period = 100, multiplier = 2): TrendPoint[] {
    if (!Number.isInteger(period) || period < 1 || !(multiplier > 0) || bars.length < period + 1) {
      return bars.map((b) => ({ time: b.time, value: null, direction: 'neutral' }))
    }
    const trs = bars.map((b, i) => i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)))
    const out: TrendPoint[] = bars.slice(0, period).map((bar) => ({ time: bar.time, value: null, direction: 'neutral' }))
    let atr = trs.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period
    let upper = 0
    let lower = 0
    let direction: 'bullish' | 'bearish' = 'bullish'
    for (let i = period; i < bars.length; i++) {
      if (i > period) atr = (atr * (period - 1) + trs[i]) / period
      const midpoint = (bars[i].high + bars[i].low) / 2
      const basicUpper = midpoint + multiplier * atr
      const basicLower = midpoint - multiplier * atr
      if (i === period) {
        upper = basicUpper
        lower = basicLower
        direction = bars[i].close >= midpoint ? 'bullish' : 'bearish'
      } else {
        const previousClose = bars[i - 1].close
        upper = basicUpper < upper || previousClose > upper ? basicUpper : upper
        lower = basicLower > lower || previousClose < lower ? basicLower : lower
        if (direction === 'bullish' && bars[i].close < lower) direction = 'bearish'
        else if (direction === 'bearish' && bars[i].close > upper) direction = 'bullish'
      }
      out.push({ time: bars[i].time, value: direction === 'bullish' ? lower : upper, direction })
    }
    return out
  },
}

export const MarketProfileEngine = {
  selectRange(bars: MarketBar[], range: 'day' | 'week' | 'custom', customStart = '', customEnd = ''): MarketBar[] {
    if (range === 'custom') {
      const start = customStart ? Date.parse(customStart) / 1000 : -Infinity
      const end = customEnd ? Date.parse(customEnd) / 1000 : Infinity
      return bars.filter((bar) => bar.time >= start && bar.time <= end)
    }
    const latest = bars.at(-1)?.time
    if (latest === undefined) return []
    const lookbackSeconds = range === 'day' ? 24 * 60 * 60 : 7 * 24 * 60 * 60
    const start = latest - lookbackSeconds
    return bars.filter((bar) => bar.time >= start && bar.time <= latest)
  },
  calculate(bars: MarketBar[], tickSize: number, valueAreaFraction = 0.7): MarketProfile | null {
    if (!bars.length || !(tickSize > 0)) return null
    const validBars = bars.filter((bar) => Number.isFinite(bar.low) && Number.isFinite(bar.high) && bar.high >= bar.low)
    if (!validBars.length) return null

    // Keep rows contiguous when a profile spans more than 1,000 ticks. The old
    // stride sampled every Nth tick, leaving gaps that could terminate VA growth.
    const tickIndex = (price: number) => Math.round(price / tickSize)
    const firstTick = Math.min(...validBars.map((bar) => tickIndex(bar.low)))
    const lastTick = Math.max(...validBars.map((bar) => tickIndex(bar.high)))
    const ticksPerRow = Math.max(1, Math.ceil((lastTick - firstTick + 1) / 1000))
    const firstRow = 0
    const lastRow = Math.floor((lastTick - firstTick) / ticksPerRow)
    const counts = Array.from({ length: lastRow - firstRow + 1 }, (_, idx) => ({
      idx,
      price: (firstTick + idx * ticksPerRow) * tickSize,
      tpo: 0,
    }))

    for (const bar of validBars) {
      const lo = Math.floor((tickIndex(bar.low) - firstTick) / ticksPerRow)
      const hi = Math.floor((tickIndex(bar.high) - firstTick) / ticksPerRow)
      for (let idx = lo; idx <= hi; idx += 1) counts[idx].tpo += 1
    }
    const rows = counts
    const maxTpo = Math.max(...rows.map((row) => row.tpo))
    if (maxTpo <= 0) return null
    const profileMidpoint = (rows[0].price + rows.at(-1)!.price) / 2
    const pocIndex = rows
      .filter((row) => row.tpo === maxTpo)
      .sort((a, b) => Math.abs(a.price - profileMidpoint) - Math.abs(b.price - profileMidpoint) || a.price - b.price)[0].idx

    let lo = pocIndex
    let hi = pocIndex
    const total = countsTotal(rows)
    const target = total * Math.max(0, Math.min(1, valueAreaFraction))
    let covered = rows[pocIndex].tpo
    while (covered < target) {
      const below = lo > firstRow ? rows[lo - 1] : undefined
      const above = hi < lastRow ? rows[hi + 1] : undefined
      if (!below && !above) break
      let selected: typeof below
      if (!above) selected = below
      else if (!below) selected = above
      else if (below.tpo !== above.tpo) selected = below.tpo > above.tpo ? below : above
      else {
        const belowDistance = pocIndex - below.idx
        const aboveDistance = above.idx - pocIndex
        selected = belowDistance < aboveDistance ? below : above
      }
      if (!selected) break
      if (selected.idx < lo) lo = selected.idx
      else hi = selected.idx
      covered += selected.tpo
    }
    return {
      bins: rows.map(({ price, tpo }) => ({ price, tpo })),
      poc: rows[pocIndex].price,
      vah: rows[hi].price,
      val: rows[lo].price,
      totalTpo: total,
      source: 'bar_range_tpo',
    }
  },
}
function countsTotal(rows: Array<{ tpo: number }>) { return rows.reduce((sum, r) => sum + r.tpo, 0) }

export const AlertEngine = {
  evaluate(rule: AlertRule, price: number, now = Date.now(), activeSymbol = rule.symbol): { rule: AlertRule; event: AlertEvent | null } {
    if (!rule.enabled || !Number.isFinite(price) || rule.symbol !== activeSymbol) return { rule, event: null }
    const side: 'above' | 'below' = price >= rule.level ? 'above' : 'below'
    const fired = rule.condition === 'above'
      ? side === 'above' && rule.lastSide !== 'above'
      : rule.condition === 'below'
        ? side === 'below' && rule.lastSide !== 'below'
        : rule.lastSide !== undefined && rule.lastSide !== side
    const next = { ...rule, lastSide: side }
    return { rule: next, event: fired ? { ruleId: rule.id, symbol: rule.symbol, price, firedAt: now } : null }
  },
}

export function planRisk(plan: TradePlan, spec: SymbolSpec, equity: number) {
  const sizing = PositionSizingEngine.calculate({ entry: plan.entry, stopLoss: plan.stopLoss, riskPercent: plan.riskPercent, equity, spec, commissionPerLot: plan.commissionPerLot })
  const lossPerLot = spec.tickSize > 0 ? Math.abs(plan.entry - plan.stopLoss) / spec.tickSize * (spec.tickValueLoss ?? spec.tickValue) + (plan.commissionPerLot ?? 0) : 0
  const targetCount = plan.takeProfits.length
  const configuredAllocations = plan.takeProfitAllocations
  const allocationTotal = configuredAllocations?.slice(0, targetCount).reduce((sum, allocation) => sum + Math.max(0, allocation), 0) ?? 0
  const lots = allocateTargetLots(plan.volume, plan.takeProfits.map((_, index) => allocationTotal > 0 ? Math.max(0, configuredAllocations?.[index] ?? 0) / allocationTotal * 100 : 100 / Math.max(1, targetCount)), plan.takeProfits.map(price => Number.isFinite(price) && price > 0), spec.volumeStep)
  const rewardCash = plan.takeProfits.reduce((sum, price, index) => {
    const distance = plan.side === 'long' ? price - plan.entry : plan.entry - price
    return sum + Math.max(0, distance) / (spec.tickSize || 1) * (spec.tickValueProfit ?? spec.tickValue) * lots[index]
  }, 0)
  return { ...sizing, volume: plan.volume, lossAtStop: lossPerLot * plan.volume, rewardCash, riskCash: lossPerLot * plan.volume, rewardRisk: lossPerLot * plan.volume > 0 ? rewardCash / (lossPerLot * plan.volume) : 0 }
}

export type EngineInput = { account: AccountSnapshot; positions: Position[]; orders: PendingOrder[]; specs: Record<string, SymbolSpec> }
