import { describe, expect, it } from 'vitest'
import { candleRemainingSeconds, formatCountdown, formatMt5ServerTime } from './telemetry'

describe('terminal telemetry', () => {
  it('counts down to the next candle boundary for the active timeframe', () => {
    expect(candleRemainingSeconds('M1', 30_000)).toBe(30)
    expect(candleRemainingSeconds('M15', 14 * 60_000 + 30_000)).toBe(30)
    expect(candleRemainingSeconds('H1', 30 * 60_000)).toBe(30 * 60)
  })

  it('starts a full countdown exactly on a new candle boundary', () => {
    expect(candleRemainingSeconds('M5', 10 * 60_000)).toBe(5 * 60)
  })

  it('formats compact countdowns and MT5 tick time without inventing broker timezone', () => {
    expect(formatCountdown(59)).toBe('00:59')
    expect(formatCountdown(3661)).toBe('01:01:01')
    expect(formatMt5ServerTime(Date.UTC(2026, 8, 27, 18, 42, 5) / 1000)).toBe('18:42:05 UTC')
    expect(formatMt5ServerTime(null)).toBe('N/A')
  })
})
