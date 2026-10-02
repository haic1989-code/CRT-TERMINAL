import { describe, expect, it } from 'vitest'
import { clampPlannerPrice, createPlannerGeometry, snapToSymbolTick, translatePlannerGeometry } from './plannerGeometry'

describe('instrument-aware planner geometry', () => {
  it.each([
    ['XAUUSD', 2312.347, { digits: 2, tickSize: 0.01 }, 2312.35],
    ['BTCUSD', 67321.237, { digits: 2, tickSize: 0.01 }, 67321.24],
    ['DJ30', 43127.36, { digits: 1, tickSize: 0.1 }, 43127.4],
  ])('snaps %s prices to the broker tick', (_symbol, price, precision, expected) => {
    expect(snapToSymbolTick(price as number, precision)).toBe(expected)
  })

  it('creates valid long and short levels on the instrument tick', () => {
    const precision = { digits: 1, tickSize: 0.1 }
    const long = createPlannerGeometry(43127.36, 'long', precision)
    const short = createPlannerGeometry(43127.36, 'short', precision)
    expect(long.stopLoss).toBeLessThan(long.entry)
    expect(long.takeProfit).toBeGreaterThan(long.entry)
    expect(short.stopLoss).toBeGreaterThan(short.entry)
    expect(short.takeProfit).toBeLessThan(short.entry)
    expect(long.entry.toFixed(1)).toBe(String(long.entry))
  })

  it('keeps dragged entry, stop and target separated by at least one symbol tick', () => {
    const precision = { digits: 2, tickSize: 0.01 }
    const current = createPlannerGeometry(2300, 'long', precision)
    const target = clampPlannerPrice('long', 'takeProfit', current.entry, current, precision)
    const stop = clampPlannerPrice('long', 'stopLoss', current.entry, target, precision)
    expect(target.takeProfit - target.entry).toBeCloseTo(precision.tickSize)
    expect(stop.entry - stop.stopLoss).toBeCloseTo(precision.tickSize)
  })

  it('moves the whole plan without introducing off-tick prices', () => {
    const precision = { digits: 1, tickSize: 0.1 }
    const geometry = createPlannerGeometry(43100, 'short', precision)
    const moved = translatePlannerGeometry(geometry, -3.27, precision)
    expect(moved.entry).toBe(43096.7)
    expect(moved.stopLoss - moved.entry).toBeGreaterThan(0)
    expect(moved.takeProfit - moved.entry).toBeLessThan(0)
  })
})
