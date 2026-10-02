import { describe, expect, it } from 'vitest'
import { calculateRsi } from './rsi'

describe('calculateRsi', () => {
  it('waits for a complete period of price changes and uses Wilder smoothing', () => {
    expect(calculateRsi([1, 2, 1, 2], 2)).toEqual([null, null, 50, 75])
  })

  it('handles rising, falling, and flat prices without non-finite values', () => {
    expect(calculateRsi([1, 2, 3, 4], 2)).toEqual([null, null, 100, 100])
    expect(calculateRsi([4, 3, 2, 1], 2)).toEqual([null, null, 0, 0])
    expect(calculateRsi([7, 7, 7, 7], 2)).toEqual([null, null, 50, 50])
  })

  it('returns only unavailable values when history is shorter than the selected period', () => {
    expect(calculateRsi([1, 2, 3], 3)).toEqual([null, null, null])
  })
})
