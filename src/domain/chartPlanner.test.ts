import { describe, expect, it } from 'vitest'
import {
  clampLots,
  clampPlannerLevel,
  createPlannerAtPrice,
  estimatePlannerOutcome,
  plannerMetrics,
} from './chartPlanner'

const precision = { digits: 2, tickSize: 0.01 }

describe('chart planner model', () => {
  it('creates side-aware levels and only enables selected targets', () => {
    const basic = createPlannerAtPrice(2300, 'long', precision)
    const ladder = createPlannerAtPrice(2300, 'long', precision, { tp2: true, tp3: true }, 'off')
    const short = createPlannerAtPrice(2300, 'short', precision, { tp2: true, tp3: false })

    expect(basic.tp1).toBeNull()
    expect(basic.tp2).toBeNull()
    expect(basic.tp3).toBeNull()
    expect(basic.be).toBe(basic.entry)
    expect(ladder.tp2).toBeGreaterThan(ladder.entry)
    expect(ladder.tp3).toBeGreaterThan(ladder.tp2!)
    expect(ladder.be).toBeNull()
    expect(short.tp2).toBeLessThan(short.entry)
    expect(short.tp3).toBeNull()
  })

  it('clamps optional targets in tick order for long and short plans', () => {
    const long = createPlannerAtPrice(2300, 'long', precision, { tp2: true, tp3: true })
    const movedLong = clampPlannerLevel('long', 'tp1', 2400, long, precision)
    expect(movedLong.tp1).toBe(long.tp2! - precision.tickSize)

    const short = createPlannerAtPrice(2300, 'short', precision, { tp2: true, tp3: true })
    const movedShort = clampPlannerLevel('short', 'tp1', 2200, short, precision)
    expect(movedShort.tp1).toBe(short.tp2! + precision.tickSize)
  })

  it('keeps the full target and stop on valid sides and snaps break-even', () => {
    const plan = createPlannerAtPrice(2300, 'long', precision, { tp2: true, tp3: false })
    const target = clampPlannerLevel('long', 'tp', plan.entry, plan, precision)
    const stop = clampPlannerLevel('long', 'sl', plan.entry + 50, target, precision)
    const breakEven = clampPlannerLevel('long', 'be', 2300.017, stop, precision)

    expect(target.tp).toBeGreaterThan(target.entry)
    expect(stop.sl).toBeLessThanOrEqual(stop.entry - precision.tickSize)
    expect(breakEven.be).toBe(2300.02)
  })

  it('calculates reward, risk, ratio, and broker-value estimates', () => {
    const plan = createPlannerAtPrice(100, 'long', precision)
    const metrics = plannerMetrics('long', plan)!
    expect(metrics.reward).toBeCloseTo(0.19)
    expect(metrics.risk).toBeCloseTo(0.1)
    expect(metrics.rr).toBeCloseTo(1.9)
    const outcome = estimatePlannerOutcome('long', plan, 0.3, { tickSize: 0.01, profitTickValue: 2, lossTickValue: 1 })!
    expect(outcome.tpMoney).toBeCloseTo(11.4)
    expect(outcome.slMoney).toBeCloseTo(3)
    expect(outcome.rr).toBeCloseTo(1.9)
    expect(estimatePlannerOutcome('long', plan, 0.3, { tickSize: 0.01, profitTickValue: 0, lossTickValue: 1 })).toBeNull()
    expect(plannerMetrics('long', null)).toBeNull()
  })

  it('snaps lots to broker bounds and volume steps', () => {
    const constraints = { min: 0.1, max: 1, step: 0.05 }
    expect(clampLots(0.12, constraints)).toBe(0.1)
    expect(clampLots(0.13, constraints)).toBe(0.15)
    expect(clampLots(2, constraints)).toBe(1)
    expect(clampLots(0, constraints)).toBe(0.1)
  })
})
