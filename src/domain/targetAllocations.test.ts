import { describe, expect, it } from 'vitest'
import { allocateTargetLots } from './targetAllocations'

describe('allocateTargetLots', () => {
  it('keeps every take profit on broker volume-step increments and totals the position', () => {
    const result = allocateTargetLots(0.03, [50, 50, 0], [true, true, false], 0.01)
    expect(result).toEqual([0.02, 0.01, 0])
    expect(result.reduce((sum, lots) => sum + lots, 0)).toBeCloseTo(0.03)
  })

  it('assigns all volume to the last enabled target when earlier targets have zero allocation', () => {
    expect(allocateTargetLots(0.03, [0, 100, 0], [true, true, false], 0.01)).toEqual([0, 0.03, 0])
  })

  it('leaves disabled targets at zero and returns zero when there is no valid volume', () => {
    expect(allocateTargetLots(0.04, [25, 25, 50], [true, false, true], 0.01)).toEqual([0.01, 0, 0.03])
    expect(allocateTargetLots(0, [100, 0, 0], [true, false, false], 0.01)).toEqual([0, 0, 0])
  })
})
