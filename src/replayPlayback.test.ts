import { describe, expect, it } from 'vitest'
import { indexReplayCandles, replayCandlesAt, replayCursorAt } from './replayPlayback'
import type { ReplayTick } from './mt5Client'

const tick = (time: number, bid: number, sequence = 0): ReplayTick => ({ time_msc: time, bid, ask: bid + 1, last: 999, volume: 0, volume_real: 0, flags: 6, sequence })

describe('FX Replay clock and candle index', () => {
  it('never exposes future high/low when going forwards or backwards', () => {
    const index = indexReplayCandles([tick(0, 100), tick(100, 90), tick(200, 150), tick(60_000, 200)], 60_000)
    expect(replayCandlesAt(index, 0)[0]).toEqual({ time: 0, open: 100, high: 100, low: 100, close: 100 })
    expect(replayCandlesAt(index, 2)[0].high).toBe(150)
    expect(replayCandlesAt(index, 1)[0].high).toBe(100)
    expect(replayCandlesAt(index, 3)).toHaveLength(2)
  })
  it('uses recorded time independently of tick density', () => {
    const ticks = [tick(0, 100), tick(1, 100), tick(2, 100), tick(10_000, 101)]
    expect(replayCursorAt(ticks, 5000, 1)).toBe(2)
    expect(replayCursorAt(ticks, 5000, -1)).toBe(3)
  })
  it('handles every tick with an identical millisecond timestamp', () => {
    const ticks = [tick(0, 100), tick(100, 101), tick(100, 102), tick(200, 103)]
    expect(replayCursorAt(ticks, 100, 1)).toBe(2)
    expect(replayCursorAt(ticks, 100, -1)).toBe(1)
  })
  it('does not replace a missing Bid with Last', () => {
    const index = indexReplayCandles([tick(0, 0), tick(100, 100), tick(200, 0)], 60_000)
    expect(replayCandlesAt(index, 0)).toEqual([])
    expect(replayCandlesAt(index, 2)[0].close).toBe(100)
  })
})
