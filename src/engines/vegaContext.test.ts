import { describe, expect, it } from 'vitest'
import type { MarketContextSnapshot } from '../domain/contracts'
import { VegaContextAdvisor } from './vegaContext'

const snapshot: MarketContextSnapshot = {
  capturedAt: 1000,
  symbol: 'XAUUSD',
  timeframe: 'M15',
  quote: { price: 2300, bid: 2299.9, ask: 2300.1, observedAt: 1000, status: 'live' },
  mtf: { M5: 'bullish', M15: 'bullish', M30: 'bearish', H1: 'bullish', H4: 'neutral', D1: 'unavailable' },
  currencyStrength: { EUR: 0.3, USD: -0.2 },
  sessions: [{ id: 'london', open: true, localTime: '10:00' }],
  keyLevels: [
    { kind: 'support', price: 2290, time: 900 },
    { kind: 'resistance', price: 2310, time: 900 },
  ],
  marketProfile: { source: 'bar_range_tpo', poc: 2301, vah: 2312, val: 2288 },
  portfolioRisk: { usedRiskCash: 80, usedRiskPercent: 0.8, incompleteStops: 0, openPositions: 1, pendingOrders: 0, floatingPnl: 10 },
  riskGuard: { allowed: true, state: 'SAFE', reasons: [], warnings: [] },
  planner: null,
}

describe('VEGA read-only context advisor', () => {
  it('explains a directional MTF majority using the structured snapshot', () => {
    const analysis = VegaContextAdvisor.analyze(snapshot)
    expect(analysis.bias).toBe('BULLISH')
    expect(analysis.proposalSide).toBe('long')
    expect(analysis.summary).toContain('3/4')
    expect(analysis.observations.join(' ')).toContain('wsparcie: 2290')
    expect(analysis.observations.join(' ')).toContain('Risk Guard: SAFE')
  })

  it('does not create a setup suggestion from stale quotes', () => {
    const analysis = VegaContextAdvisor.analyze({ ...snapshot, quote: { ...snapshot.quote, status: 'stale' } })
    expect(analysis.proposalSide).toBeNull()
    expect(analysis.summary).toContain('Brak świeżej ceny')
  })

  it('surfaces Risk Guard veto without changing its state', () => {
    const blocked = { ...snapshot, riskGuard: { allowed: false, state: 'BLOCKED' as const, reasons: ['stale quote'], warnings: [] } }
    const analysis = VegaContextAdvisor.analyze(blocked)
    expect(analysis.observations.join(' ')).toContain('RISK GUARD VETO')
    expect(blocked.riskGuard.state).toBe('BLOCKED')
  })

  it('explains soft warnings without turning them into a veto', () => {
    const warning = { ...snapshot, riskGuard: { allowed: true, state: 'WARNING' as const, reasons: [], warnings: ['daily loss near limit'] } }
    const analysis = VegaContextAdvisor.analyze(warning)
    expect(analysis.observations.join(' ')).toContain('RISK GUARD SOFT WARNING')
    expect(warning.riskGuard.allowed).toBe(true)
  })

  it('uses a 2R target when the nearest structural level is too close', () => {
    const proposal = VegaContextAdvisor.propose(snapshot, 0.1)
    expect(proposal).not.toBeNull()
    expect(proposal).toMatchObject({ side: 'long', entry: 2300.1, stopReference: 2290, targetReference: null, targetMethod: '2R FALLBACK', riskAllowed: true })
    expect(proposal!.stopLoss).toBeLessThan(proposal!.stopReference)
    expect(proposal!.takeProfit).toBeGreaterThan(2300.1)
    expect(proposal!.rewardRisk).toBeCloseTo(2, 1)
  })

  it('uses a structural target when it offers at least 1.5R', () => {
    const proposal = VegaContextAdvisor.propose({
      ...snapshot,
      keyLevels: [
        { kind: 'support', price: 2290, time: 900 },
        { kind: 'resistance', price: 2330, time: 900 },
      ],
    }, 0.1)
    expect(proposal).toMatchObject({ targetReference: 2330, targetMethod: 'KEY LEVEL' })
    expect(proposal!.rewardRisk).toBeGreaterThanOrEqual(1.5)
  })

  it('uses a transparent 2R objective when no structural target is above the live price', () => {
    const oneSided = { ...snapshot, keyLevels: [{ kind: 'support' as const, price: 2290, time: 900 }], marketProfile: null }
    const proposal = VegaContextAdvisor.propose(oneSided, 0.1)
    expect(proposal?.targetMethod).toBe('2R FALLBACK')
    expect(proposal?.rewardRisk).toBeCloseTo(2, 1)
    expect(proposal?.targetReference).toBeNull()
  })

  it('does not use a nearby key level as a target when it offers less than 1.5R', () => {
    const nearbyTarget = {
      ...snapshot,
      keyLevels: [
        { kind: 'support' as const, price: 2290, time: 900 },
        { kind: 'resistance' as const, price: 2302, time: 900 },
      ],
      marketProfile: null,
    }
    const proposal = VegaContextAdvisor.propose(nearbyTarget, 0.1)
    expect(proposal?.targetMethod).toBe('2R FALLBACK')
    expect(proposal?.targetReference).toBeNull()
    expect(proposal?.rewardRisk).toBeCloseTo(2, 1)
    expect(proposal?.resistance).toBe(2302)
  })

  it('does not invent a stop when no valid structure exists below a long entry', () => {
    const noStop = { ...snapshot, keyLevels: [{ kind: 'resistance' as const, price: 2310, time: 900 }], marketProfile: null }
    expect(VegaContextAdvisor.propose(noStop)).toBeNull()
  })

  it('can display a proposal while preserving Risk Guard veto state', () => {
    const blocked = { ...snapshot, riskGuard: { allowed: false, state: 'BLOCKED' as const, reasons: ['margin unavailable'], warnings: [] } }
    const proposal = VegaContextAdvisor.propose(blocked)
    expect(proposal?.riskAllowed).toBe(false)
    expect(proposal?.riskVetoes).toEqual(['margin unavailable'])
  })

})
