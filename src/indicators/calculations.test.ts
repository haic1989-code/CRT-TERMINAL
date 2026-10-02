import { describe, expect, it } from 'vitest'
import { calculateBollingerBands, calculateEma, calculateSessionVwap, calculateSma, mergeLatestBar } from './calculations'
import type { IndicatorBar } from './calculations'

const bar = (time: number, price: number, tickVolume: number): IndicatorBar => ({
  time, open: price, high: price + 1, low: price - 1, close: price, tickVolume,
})

describe('indicator calculations', () => {
  it('calculates rolling SMA and EMA with a full-period SMA seed', () => {
    expect(calculateSma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
    expect(calculateEma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
  })

  it('calculates population-standard-deviation Bollinger bands', () => {
    expect(calculateBollingerBands([1, 3, 5], 2)).toEqual({
      upper: [null, 4, 6],
      lower: [null, 0, 2],
    })
  })

  it('keeps rolling windows invalid only while a non-finite close remains inside them', () => {
    expect(calculateSma([1, Number.NaN, 3, 4, 5], 2)).toEqual([null, null, null, 3.5, 4.5])
    expect(calculateBollingerBands([1, Number.NaN, 3, 4, 5], 2)).toEqual({
      upper: [null, null, null, 4.5, 5.5],
      lower: [null, null, null, 2.5, 3.5],
    })
  })

  it('retains precision for small price variation around large market prices', () => {
    const bands = calculateBollingerBands([4000.01, 4000.02, 4000.03], 3)
    expect(calculateSma([4000.01, 4000.02, 4000.03], 3)?.[2]).toBeCloseTo(4000.02, 8)
    expect(bands.upper[2]).toBeCloseTo(4000.0363299, 6)
    expect(bands.lower[2]).toBeCloseTo(4000.0036701, 6)
  })

  it('uses typical price, resets VWAP at each UTC day, and carries across zero-volume bars', () => {
    const values = calculateSessionVwap([
      { time: 86_399, open: 1, high: 6, low: 4, close: 5, tickVolume: 2 },
      { time: 86_399, open: 1, high: 9, low: 7, close: 8, tickVolume: 2 },
      { time: 86_400, open: 9, high: 12, low: 9, close: 9, tickVolume: 1 },
      { time: 86_401, open: 9, high: 11, low: 9, close: 10, tickVolume: 0 },
    ])
    expect(values).toEqual([5, 6.5, 10, 10])
    expect(calculateSessionVwap([{ ...bar(1, 1, 0) }])).toEqual([null])
  })

  it('replaces the current bar and appends a new live bar without mutating history', () => {
    const history = [{ time: 10, close: 1 }, { time: 20, close: 2 }]
    const replaced = mergeLatestBar(history, { time: 20, close: 3 })
    const appended = mergeLatestBar(history, { time: 30, close: 4 })
    expect(history[1].close).toBe(2)
    expect(replaced).toEqual([{ time: 10, close: 1 }, { time: 20, close: 3 }])
    expect(appended).toEqual([...history, { time: 30, close: 4 }])
  })
})

