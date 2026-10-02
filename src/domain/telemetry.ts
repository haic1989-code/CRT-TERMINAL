import type { ChartTimeframe } from '../MarketChart'

export const TIMEFRAME_SECONDS: Record<ChartTimeframe, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: 24 * 60 * 60,
}

export function candleRemainingSeconds(timeframe: ChartTimeframe, nowMs = Date.now()): number {
  const duration = TIMEFRAME_SECONDS[timeframe]
  const nowSeconds = Math.floor(Math.max(0, nowMs) / 1000)
  const elapsed = nowSeconds % duration
  return elapsed === 0 ? duration : duration - elapsed
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function formatMt5ServerTime(lastTickAtSeconds: number | null | undefined): string {
  if (!lastTickAtSeconds || !Number.isFinite(lastTickAtSeconds) || lastTickAtSeconds <= 0) return 'N/A'
  const date = new Date(lastTickAtSeconds * 1000)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')} UTC`
}
