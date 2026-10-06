import type { ReplayTick } from './mt5Client'

export type ReplayCandle = { time: number; open: number; high: number; low: number; close: number }

// Build once per downloaded window, never scan its whole prefix on every frame.
export function indexReplayCandles(ticks: ReplayTick[], intervalMs: number) {
  const candles: ReplayCandle[] = []
  const slots = new Int32Array(ticks.length).fill(-1)
  const highs = new Float64Array(ticks.length)
  const lows = new Float64Array(ticks.length)
  const closes = new Float64Array(ticks.length)
  for (let i = 0; i < ticks.length; i++) {
    const { time_msc: timestamp, bid } = ticks[i]
    if (bid > 0) {
      const time = Math.floor(timestamp / intervalMs) * intervalMs
      let candle = candles[candles.length - 1]
      if (!candle || candle.time !== time) {
        candle = { time, open: bid, high: bid, low: bid, close: bid }
        candles.push(candle)
      } else {
        candle.high = Math.max(candle.high, bid)
        candle.low = Math.min(candle.low, bid)
        candle.close = bid
      }
    }
    const candle = candles[candles.length - 1]
    if (candle) {
      slots[i] = candles.length - 1
      highs[i] = candle.high
      lows[i] = candle.low
      closes[i] = candle.close
    }
  }
  return { candles, slots, highs, lows, closes }
}

export function replayCandlesAt(index: ReturnType<typeof indexReplayCandles>, cursor: number) {
  const slot = index.slots[cursor]
  if (slot === undefined || slot < 0) return []
  // Completed candles are immutable; the current candle uses only past ticks.
  return [...index.candles.slice(Math.max(0, slot - 139), slot), {
    ...index.candles[slot], high: index.highs[cursor], low: index.lows[cursor], close: index.closes[cursor],
  }]
}

export function replayCursorAt(ticks: ReplayTick[], timestamp: number, direction: 1 | -1) {
  let low = 0
  let high = ticks.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (ticks[middle].time_msc < timestamp || (direction > 0 && ticks[middle].time_msc === timestamp)) low = middle + 1
    else high = middle
  }
  return Math.max(0, Math.min(ticks.length - 1, direction > 0 ? low - 1 : low))
}
