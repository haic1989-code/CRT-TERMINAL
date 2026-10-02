import { describe, expect, it } from 'vitest'
import type { MarketBar } from './contracts'
import { calculateReferenceLevels } from './referenceLevels'

const bars = (rows: Array<[number, number, number, number]>): MarketBar[] => rows.map(([time, open, high, low]) => ({
  time, open, high, low, close: open,
}))

describe('MT5 reference price levels', () => {
  it('builds selectable current/previous day and week levels from native broker bars', () => {
    const levels = calculateReferenceLevels(
      bars([[1, 100, 110, 90], [2, 104, 112, 96], [3, 108, 118, 101]]),
      bars([[10, 97, 121, 89], [20, 108, 125, 99]]),
    )
    expect(levels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'day-high', title: 'D-H', price: 118, group: 'today' }),
      expect.objectContaining({ id: 'day-low', title: 'D-L', price: 101, group: 'today' }),
      expect.objectContaining({ id: 'previous-day-high', title: 'PDH', price: 112, group: 'previous-day' }),
      expect.objectContaining({ id: 'previous-week-low', title: 'PWL', price: 89, group: 'previous-week' }),
      expect.objectContaining({ id: 'day-open', title: 'D-O', price: 108, group: 'opens' }),
      expect.objectContaining({ id: 'week-open', title: 'W-O', price: 108, group: 'opens' }),
    ]))
  })

  it('omits a previous-period level until the bridge provides that candle', () => {
    const levels = calculateReferenceLevels(bars([[1, 100, 110, 90]]), [])
    expect(levels.map(level => level.id)).toEqual(['day-high', 'day-low', 'day-open'])
  })

  it('ignores invalid OHLC rows rather than drawing fabricated zero prices', () => {
    const levels = calculateReferenceLevels(bars([[1, 0, 0, 0], [2, 100, 110, 90]]), [])
    expect(levels.map(level => level.price)).toEqual([110, 90, 100])
  })
})
