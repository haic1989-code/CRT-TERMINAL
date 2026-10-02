import type { IndicatorId } from './catalog'
import { calculateRsi } from './rsi'

export type IndicatorBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  tickVolume: number
}

export type IndicatorSeriesValues = {
  key: 'main' | 'upper' | 'lower'
  values: Array<number | null>
}

function normalizedPeriod(requested: number, fallback: number) {
  return Math.max(2, Math.min(500, Math.round(Number.isFinite(requested) ? requested : fallback)))
}

export function mergeLatestBar<T extends { time: number }>(bars: readonly T[], latest: T | null | undefined): T[] {
  if (!latest) return [...bars]
  if (!bars.length) return [latest]
  const last = bars[bars.length - 1]
  if (latest.time < last.time) return [...bars]
  if (latest.time === last.time) return [...bars.slice(0, -1), latest]
  return [...bars, latest]
}

export function calculateSma(closes: readonly number[], requestedPeriod = 20): Array<number | null> {
  const period = normalizedPeriod(requestedPeriod, 20)
  const values: Array<number | null> = Array.from({ length: closes.length }, () => null)
  let sum = 0
  let finiteCount = 0

  for (let index = 0; index < closes.length; index += 1) {
    if (index >= period) {
      const outgoing = closes[index - period]
      if (Number.isFinite(outgoing)) {
        sum -= outgoing
        finiteCount -= 1
      }
    }

    const incoming = closes[index]
    if (Number.isFinite(incoming)) {
      sum += incoming
      finiteCount += 1
    }

    if (index >= period - 1 && finiteCount === period) values[index] = sum / period
  }

  return values
}

export function calculateEma(closes: readonly number[], requestedPeriod = 50): Array<number | null> {
  const period = normalizedPeriod(requestedPeriod, 50)
  const values: Array<number | null> = Array.from({ length: closes.length }, () => null)
  if (closes.length < period) return values
  const seed = closes.slice(0, period)
  if (seed.some((value) => !Number.isFinite(value))) return values
  let previous = seed.reduce((sum, value) => sum + value, 0) / period
  values[period - 1] = previous
  const alpha = 2 / (period + 1)
  for (let index = period; index < closes.length; index += 1) {
    const close = closes[index]
    if (!Number.isFinite(close)) {
      previous = Number.NaN
      continue
    }
    previous = Number.isFinite(previous) ? close * alpha + previous * (1 - alpha) : close
    values[index] = previous
  }
  return values
}

export function calculateBollingerBands(closes: readonly number[], requestedPeriod = 20): { upper: Array<number | null>; lower: Array<number | null> } {
  const period = normalizedPeriod(requestedPeriod, 20)
  const upper: Array<number | null> = Array.from({ length: closes.length }, () => null)
  const lower: Array<number | null> = Array.from({ length: closes.length }, () => null)
  let count = 0
  let mean = 0
  let m2 = 0

  for (let index = 0; index < closes.length; index += 1) {
    if (index >= period) {
      const outgoing = closes[index - period]
      if (Number.isFinite(outgoing)) {
        if (count === 1) {
          count = 0
          mean = 0
          m2 = 0
        } else {
          const nextMean = (count * mean - outgoing) / (count - 1)
          m2 = Math.max(0, m2 - (outgoing - mean) * (outgoing - nextMean))
          mean = nextMean
          count -= 1
        }
      }
    }

    const incoming = closes[index]
    if (Number.isFinite(incoming)) {
      count += 1
      const delta = incoming - mean
      mean += delta / count
      m2 += delta * (incoming - mean)
    }

    if (index >= period - 1 && count === period) {
      const deviation = Math.sqrt(Math.max(0, m2 / period))
      upper[index] = mean + 2 * deviation
      lower[index] = mean - 2 * deviation
    }
  }

  return { upper, lower }
}

/** UTC calendar-day VWAP using typical price and MT5 tick volume. */
export function calculateSessionVwap(bars: readonly IndicatorBar[]): Array<number | null> {
  const values: Array<number | null> = []
  let activeSession: number | null = null
  let cumulativePriceVolume = 0
  let cumulativeVolume = 0

  for (const bar of bars) {
    const timestamp = Number(bar.time)
    if (!Number.isFinite(timestamp)) {
      values.push(null)
      continue
    }
    const session = Math.floor(timestamp / 86400)
    if (session !== activeSession) {
      activeSession = session
      cumulativePriceVolume = 0
      cumulativeVolume = 0
    }
    const volume = Number.isFinite(bar.tickVolume) ? Math.max(0, bar.tickVolume) : 0
    const typicalPrice = (bar.high + bar.low + bar.close) / 3
    if (volume > 0 && Number.isFinite(typicalPrice)) {
      cumulativePriceVolume += typicalPrice * volume
      cumulativeVolume += volume
    }
    values.push(cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null)
  }
  return values
}

export function calculateIndicatorSeries(
  id: IndicatorId,
  bars: readonly IndicatorBar[],
  requestedPeriod?: number,
): IndicatorSeriesValues[] {
  const closes = bars.map((bar) => bar.close)
  if (id === 'SMA 20') return [{ key: 'main', values: calculateSma(closes, requestedPeriod ?? 20) }]
  if (id === 'EMA 50') return [{ key: 'main', values: calculateEma(closes, requestedPeriod ?? 50) }]
  if (id === 'VWAP') return [{ key: 'main', values: calculateSessionVwap(bars) }]
  if (id === 'Bollinger Bands') {
    const bands = calculateBollingerBands(closes, requestedPeriod ?? 20)
    return [{ key: 'upper', values: bands.upper }, { key: 'lower', values: bands.lower }]
  }
  return [{ key: 'main', values: calculateRsi(closes, requestedPeriod ?? 14) }]
}

