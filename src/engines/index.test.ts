import { describe, expect, it } from 'vitest'
import type { MarketBar, SymbolSpec } from '../domain/contracts'
import { AlertEngine, BreakevenEngine, ContextSummaryEngine, CurrencyStrengthEngine, KeyLevelsEngine, MarketProfileEngine, MTFContextEngine, PlannerBreakEvenEngine, planRisk, PositionSizingEngine, PortfolioRiskEngine, RiskGuardEngine, SessionEngine } from './index'

const spec: SymbolSpec = { symbol: 'XAUUSD', digits: 2, tickSize: 0.01, tickValue: 1, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 }
const bars: MarketBar[] = Array.from({ length: 9 }, (_, i) => ({ time: i, open: 10+i, high: 12+i, low: 9+i, close: 11+i, tickVolume: 10 }))

describe('SmartFlow domain engines', () => {
  it('sizes down to the broker volume step and risk budget', () => {
    const r = PositionSizingEngine.calculate({ entry: 2000, stopLoss: 1990, riskPercent: 1, equity: 10000, spec })
    expect(r.volume).toBe(0.1); expect(r.lossAtStop).toBe(100)
  })
  it('reports the selected margin-capped plan volume rather than recalculating an uncapped size', () => {
    const r = planRisk({ symbol: 'XAUUSD', side: 'long', entry: 2000, stopLoss: 1990, takeProfits: [2020], volume: 0.04, riskPercent: 1 }, spec, 10000)
    expect(r.volume).toBe(0.04)
    expect(r.riskCash).toBeCloseTo(40)
  })
  it('weights planner reward across targets by allocation and records a selected break-even trigger', () => {
    const r = planRisk({ symbol: 'XAUUSD', side: 'long', entry: 2000, stopLoss: 1990, takeProfits: [2010, 2030], takeProfitAllocations: [75, 25], breakEvenMode: 'after_tp1', volume: 0.04, riskPercent: 1 }, spec, 10000)
    expect(r.rewardCash).toBeCloseTo(60)
    expect(r.rewardRisk).toBeCloseTo(1.5)
  })
  it('weights reward across three targets using explicit allocations', () => {
    const r = planRisk({ symbol: 'XAUUSD', side: 'long', entry: 2000, stopLoss: 1990, takeProfits: [2010, 2020, 2040], takeProfitAllocations: [50, 30, 20], volume: 0.1, riskPercent: 1 }, spec, 10000)
    expect(r.rewardCash).toBeCloseTo(190)
    expect(r.rewardRisk).toBeCloseTo(1.9)
  })
  it('evaluates manual and target-triggered planner break-even rules without live execution', () => {
    const base = { symbol: 'XAUUSD', side: 'long' as const, entry: 2000, stopLoss: 1990, takeProfits: [2010, 2020, 2030], volume: 0.1, riskPercent: 1, breakEvenPrice: 2001 }
    expect(PlannerBreakEvenEngine.evaluate({ plan: { ...base, breakEvenMode: 'off' }, reachedTargetCount: 3 })).toEqual({ enabled: false, triggered: false, triggerTargetIndex: null, price: null })
    expect(PlannerBreakEvenEngine.evaluate({ plan: { ...base, breakEvenMode: 'manual' }, reachedTargetCount: 0 })).toMatchObject({ enabled: true, triggered: true, price: 2001 })
    expect(PlannerBreakEvenEngine.evaluate({ plan: { ...base, breakEvenMode: 'after_tp2' }, reachedTargetCount: 1 }).triggered).toBe(false)
    expect(PlannerBreakEvenEngine.evaluate({ plan: { ...base, breakEvenMode: 'after_tp2' }, reachedTargetCount: 2 }).triggered).toBe(true)
  })
  it('adds open and pending stop risk by symbol', () => {
    const r = PortfolioRiskEngine.calculate({ equity: 10000, specs: { XAUUSD: spec }, positions: [{ id: 1, symbol: 'XAUUSD', side: 'long', volume: 1, openPrice: 2000, stopLoss: 1999, takeProfit: 0, profit: 0, swap: 0, commission: 0, openedAt: 0 }], orders: [] })
    expect(r.usedRiskCash).toBe(100); expect(r.usedRiskPercent).toBe(1)
  })
  it('computes net break-even including swap, commission and profit', () => {
    const r = BreakevenEngine.calculate({ symbol: 'XAUUSD', spec, currentPrice: 2000, positions: [{ id: 1, symbol: 'XAUUSD', side: 'long', volume: 1, openPrice: 2000, stopLoss: 0, takeProfit: 0, profit: 25, swap: -2, commission: -3, openedAt: 0 }] })
    expect(r).toBeCloseTo(1999.8)
  })
  it('fails Risk Guard closed when quotes are stale', () => {
    const r = RiskGuardEngine.evaluate({ now: 100000, quoteObservedAt: 1, quoteMaxAgeMs: 1000, account: { currency: 'USD', balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, marginLevel: null, floatingPnl: 0, tradeAllowed: true, observedAt: 99999 }, proposed: null, exposure: { usedRiskCash: 0, usedRiskPercent: 0, incompleteStops: 0, bySymbol: {} }, maxRiskPerTradePct: 1, maxTotalRiskPct: 3, maxDailyLossPct: 5, maxMarginUsagePct: 50 })
    expect(r.allowed).toBe(false); expect(r.state).toBe('BLOCKED')
  })
  it('fails Risk Guard closed when positions or orders snapshots are missing or stale', () => {
    const base = {
      now: 100000,
      quoteObservedAt: 99999,
      quoteMaxAgeMs: 1000,
      account: { currency: 'USD', balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, marginLevel: null, floatingPnl: 0, tradeAllowed: true, observedAt: 99999 },
      proposed: null,
      exposure: { usedRiskCash: 0, usedRiskPercent: 0, incompleteStops: 0, bySymbol: {} },
      maxRiskPerTradePct: 1,
      maxTotalRiskPct: 3,
      maxDailyLossPct: 5,
      maxMarginUsagePct: 50,
      portfolioMaxAgeMs: 15000,
    }
    const missing = RiskGuardEngine.evaluate({ ...base, portfolioObservedAt: null })
    const stale = RiskGuardEngine.evaluate({ ...base, portfolioObservedAt: 80000 })
    const fresh = RiskGuardEngine.evaluate({ ...base, portfolioObservedAt: 99999 })
    expect(missing.allowed).toBe(false)
    expect(missing.reasons.join(' ')).toContain('Positions or orders snapshot is stale')
    expect(stale.allowed).toBe(false)
    expect(fresh.allowed).toBe(true)
  })
  it('keeps trading allowed while surfacing soft warnings near portfolio and daily-loss limits', () => {
    const r = RiskGuardEngine.evaluate({ now: 100000, quoteObservedAt: 99999, quoteMaxAgeMs: 1000, account: { currency: 'USD', balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, marginLevel: null, floatingPnl: 0, dayPnl: -450, tradeAllowed: true, observedAt: 99999 }, proposed: null, exposure: { usedRiskCash: 410, usedRiskPercent: 4.1, incompleteStops: 0, bySymbol: {} }, maxRiskPerTradePct: 2, maxTotalRiskPct: 5, maxDailyLossPct: 5, maxMarginUsagePct: 60 })
    expect(r.allowed).toBe(true)
    expect(r.state).toBe('WARNING')
    expect(r.reasons).toEqual([])
    expect(r.warnings).toHaveLength(2)
  })
  it('vetoes a plan when margin is active but the broker margin level is invalid', () => {
    const r = RiskGuardEngine.evaluate({ now: 100000, quoteObservedAt: 99999, quoteMaxAgeMs: 1000, account: { currency: 'USD', balance: 10000, equity: 10000, margin: 100, freeMargin: 9900, marginLevel: 0, floatingPnl: 0, tradeAllowed: true, observedAt: 99999 }, proposed: null, exposure: { usedRiskCash: 0, usedRiskPercent: 0, incompleteStops: 0, bySymbol: {} }, maxRiskPerTradePct: 1, maxTotalRiskPct: 3, maxDailyLossPct: 5, maxMarginUsagePct: 50 })
    expect(r.allowed).toBe(false)
    expect(r.reasons.join(' ')).toContain('invalid')
  })
  it('vetoes a plan whose projected margin exceeds free margin', () => {
    const r = RiskGuardEngine.evaluate({ now: 100000, quoteObservedAt: 99999, quoteMaxAgeMs: 1000, account: { currency: 'USD', balance: 10000, equity: 10000, margin: 100, freeMargin: 1000, marginLevel: 10000, floatingPnl: 0, tradeAllowed: true, observedAt: 99999 }, proposed: { symbol: 'XAUUSD', side: 'long', entry: 2000, stopLoss: 1990, takeProfits: [2020], volume: 1, riskPercent: 1 }, proposedMargin: 1200, exposure: { usedRiskCash: 0, usedRiskPercent: 0, incompleteStops: 0, bySymbol: {} }, maxRiskPerTradePct: 2, maxTotalRiskPct: 5, maxDailyLossPct: 5, maxMarginUsagePct: 60 })
    expect(r.allowed).toBe(false)
    expect(r.reasons.join(' ')).toContain('free margin')
  })
  it('vetoes an active plan while its margin estimate is unavailable', () => {
    const r = RiskGuardEngine.evaluate({ now: 100000, quoteObservedAt: 99999, quoteMaxAgeMs: 1000, account: { currency: 'USD', balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, marginLevel: null, floatingPnl: 0, tradeAllowed: true, observedAt: 99999 }, proposed: { symbol: 'XAUUSD', side: 'long', entry: 2000, stopLoss: 1990, takeProfits: [2020], volume: 0.1, riskPercent: 1 }, proposedMargin: null, exposure: { usedRiskCash: 0, usedRiskPercent: 0, incompleteStops: 0, bySymbol: {} }, maxRiskPerTradePct: 2, maxTotalRiskPct: 5, maxDailyLossPct: 5, maxMarginUsagePct: 60 })
    expect(r.allowed).toBe(false)
    expect(r.reasons.join(' ')).toContain('margin requirement is unavailable')
  })
  it('enforces max-lot, spread, slippage and block-new-trades hard policies', () => {
    const base = {
      now: 100000, quoteObservedAt: 99999, quoteMaxAgeMs: 1000,
      account: { currency: 'USD', balance: 10000, equity: 10000, margin: 100, freeMargin: 9900, marginLevel: 10000, floatingPnl: 0, tradeAllowed: true, observedAt: 99999 },
      proposed: { symbol: 'XAUUSD', side: 'long' as const, entry: 2000, stopLoss: 1990, takeProfits: [2020], volume: 2, riskPercent: 1 },
      proposedMargin: 500,
      exposure: { usedRiskCash: 100, usedRiskPercent: 1, incompleteStops: 0, bySymbol: {} },
      maxRiskPerTradePct: 2, maxTotalRiskPct: 5, maxDailyLossPct: 5, maxMarginUsagePct: 60,
    }
    const lot = RiskGuardEngine.evaluate({ ...base, maxLot: 1 })
    expect(lot.reasons.join(' ')).toContain('max-lot')
    const spread = RiskGuardEngine.evaluate({ ...base, maxLot: 3, maxSpreadPoints: 20, spreadPoints: 25 })
    expect(spread.reasons.join(' ')).toContain('spread')
    const slip = RiskGuardEngine.evaluate({ ...base, maxLot: 3, maxSlippagePoints: 5, slippagePoints: 7 })
    expect(slip.reasons.join(' ')).toContain('slippage')
    const blocked = RiskGuardEngine.evaluate({ ...base, maxLot: 3, blockNewTrades: true })
    expect(blocked.reasons.join(' ')).toContain('disabled')
  })
  it('returns projected risk, projected margin usage and daily loss for the compact guard UI', () => {
    const r = RiskGuardEngine.evaluate({
      now: 100000, quoteObservedAt: 99999, quoteMaxAgeMs: 1000,
      account: { currency: 'USD', balance: 10000, equity: 10000, margin: 1000, freeMargin: 9000, marginLevel: 1000, floatingPnl: 0, dayPnl: -200, tradeAllowed: true, observedAt: 99999 },
      proposed: { symbol: 'XAUUSD', side: 'long', entry: 2000, stopLoss: 1990, takeProfits: [2020], volume: 0.1, riskPercent: 1 },
      proposedMargin: 500,
      exposure: { usedRiskCash: 200, usedRiskPercent: 2, incompleteStops: 0, bySymbol: {} },
      maxRiskPerTradePct: 2, maxTotalRiskPct: 5, maxDailyLossPct: 5, maxMarginUsagePct: 60,
    })
    expect(r.projectedRiskPercent).toBeCloseTo(3)
    expect(r.projectedMarginUsagePct).toBeCloseTo(15)
    expect(r.dailyLossPct).toBeCloseTo(2)
  })
  it('finds confirmed two-bar fractal pivots', () => {
    const swing = bars.map((bar, index) => ({ ...bar, high: index === 4 ? 99 : 20 + index, low: index === 4 ? 3 : 10 + index }))
    expect(KeyLevelsEngine.calculate(swing).some((l) => l.kind === 'resistance')).toBe(true)
    expect(KeyLevelsEngine.calculate(swing).some((l) => l.kind === 'support')).toBe(true)
  })
  it('limits displayed S/R to the closest confirmed pivot on each side of price', () => {
    const levels = [
      { price: 95, kind: 'support' as const, time: 1 }, { price: 99, kind: 'support' as const, time: 2 },
      { price: 103, kind: 'resistance' as const, time: 3 }, { price: 110, kind: 'resistance' as const, time: 4 },
    ]
    expect(KeyLevelsEngine.nearest(levels, 100)).toEqual([levels[1], levels[2]])
    expect(KeyLevelsEngine.nearest(levels, null)).toEqual([])
  })
  it('ranks the base currency against the quote currency', () => {
    const r = CurrencyStrengthEngine.calculate({ EURUSD: [{ ...bars[0], close: 1 }, { ...bars[1], close: 1.1 }] })
    expect(r.EUR).toBeGreaterThan(0); expect(r.USD).toBeLessThan(0)
  })
  it('uses IANA zones for session clock conversion', () => expect(SessionEngine.getSessions(new Date('2026-01-15T08:00:00Z')).map((s) => s.localTime).length).toBe(3))
  it('summarizes volatility, relative strength, session and nearest key level', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({ time: i, open: 100 + i * .1, high: 101 + i * .1, low: 99 + i * .1, close: 100 + i * .1 }))
    const result = ContextSummaryEngine.calculate({
      bars: history,
      price: 106,
      keyLevels: [{ price: 105.9, kind: 'support', time: 1 }, { price: 107, kind: 'resistance', time: 2 }],
      sessions: [{ id: 'london', open: true, localTime: '10:00' }, { id: 'tokyo', open: false, localTime: '18:00' }, { id: 'new_york', open: false, localTime: '05:00' }],
      strength: { EUR: .4, USD: -.2 },
      symbol: 'EURUSD',
    })
    expect(result.activeSession).toContain('LONDON')
    expect(result.strengthValue).toBeCloseTo(.6)
    expect(result.keyLevelRelation).toContain('SUPPORT')
    expect(result.volatilityState).not.toBe('UNAVAILABLE')
  })
  it('returns a neutral trend when history is too short', () => expect(MTFContextEngine.supertrend(bars, 100).at(-1)?.direction).toBe('neutral'))
  it('warms up Supertrend before returning a line and recognizes a sharp trend reversal', () => {
    const history: MarketBar[] = Array.from({ length: 10 }, (_, i) => ({ time: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i }))
    history.push({ time: 10, open: 99, high: 101, low: 93, close: 94 })
    const result = MTFContextEngine.supertrend(history, 3, 2)
    expect(result.slice(0, 3).every((point) => point.value === null)).toBe(true)
    expect(result[3].value).not.toBeNull()
    expect(result.at(-1)?.direction).toBe('bearish')
  })
  it('produces one TPO profile with one POC and value area', () => {
    const p = MarketProfileEngine.calculate(bars, 1)
    expect(p?.source).toBe('bar_range_tpo'); expect(p?.vah).toBeGreaterThanOrEqual(p?.val ?? Infinity)
  })
  it('keeps price rows contiguous when compressing a wide profile', () => {
    const wideBar: MarketBar = { time: 1, open: 1000, high: 2000, low: 0, close: 1000 }
    const p = MarketProfileEngine.calculate([wideBar], 1)
    expect(p).not.toBeNull()
    expect(p!.bins.length).toBeLessThanOrEqual(1000)
    expect(p!.bins.length).toBeGreaterThan(1)
    expect(p!.bins.every((bin, index, all) => index === 0 || bin.price > all[index - 1].price)).toBe(true)
    expect(p!.vah).toBeGreaterThan(p!.val)
    expect(p!.totalTpo).toBe(p!.bins.reduce((sum, bin) => sum + bin.tpo, 0))
  })
  it('breaks equal adjacent TPO counts by choosing the row nearer to the POC', () => {
    const counts = [1, 1, 5, 10, 6, 5, 1]
    const profileBars = counts.flatMap((count, price) => Array.from({ length: count }, (_, index): MarketBar => ({
      time: price * 100 + index,
      open: price,
      high: price,
      low: price,
      close: price,
    })))
    const p = MarketProfileEngine.calculate(profileBars, 1, 0.7)
    expect(p?.poc).toBe(3)
    expect(p?.val).toBe(2)
    expect(p?.vah).toBe(4)
  })
  it('selects rolling profile windows by elapsed time instead of chart bar count', () => {
    const latest = 1_800_000_000
    const history: MarketBar[] = [-8 * 86400, -7 * 86400, -86401, -86400, -3600, 0].map((offset) => ({ time: latest + offset, open: 1, high: 2, low: 0.5, close: 1 }))
    expect(MarketProfileEngine.selectRange(history, 'day').map((bar) => bar.time)).toEqual(history.slice(3).map((bar) => bar.time))
    expect(MarketProfileEngine.selectRange(history, 'week').map((bar) => bar.time)).toEqual(history.slice(1).map((bar) => bar.time))
  })
  it('honors custom Market Profile boundaries', () => {
    const history = bars.map((bar) => ({ ...bar, time: bar.time * 3600 }))
    const start = new Date(2 * 3600 * 1000).toISOString()
    const end = new Date(5 * 3600 * 1000).toISOString()
    expect(MarketProfileEngine.selectRange(history, 'custom', start, end).map((bar) => bar.time)).toEqual([7200, 10800, 14400, 18000])
  })
  it('fires cross only when price changes sides', () => {
    const rule = { id: 'a', symbol: 'XAUUSD', level: 100, condition: 'cross' as const, enabled: true }
    const first = AlertEngine.evaluate(rule, 99); const second = AlertEngine.evaluate(first.rule, 101)
    expect(first.event).toBeNull(); expect(second.event?.price).toBe(101)
  })
  it('fires a one-sided alert once until price returns and crosses again', () => {
    const rule = { id: 'b', symbol: 'XAUUSD', level: 100, condition: 'above' as const, enabled: true }
    const first = AlertEngine.evaluate(rule, 101)
    const repeated = AlertEngine.evaluate(first.rule, 102)
    const returned = AlertEngine.evaluate(repeated.rule, 99)
    const firedAgain = AlertEngine.evaluate(returned.rule, 101)
    expect(first.event).not.toBeNull(); expect(repeated.event).toBeNull(); expect(firedAgain.event).not.toBeNull()
  })
  it('does not evaluate an alert against a different active instrument', () => {
    const rule = { id: 'c', symbol: 'XAUUSD', level: 100, condition: 'above' as const, enabled: true }
    expect(AlertEngine.evaluate(rule, 101, 123, 'BTCUSD')).toEqual({ rule, event: null })
  })
})
