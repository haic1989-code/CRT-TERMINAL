import type { CandlestickData, UTCTimestamp } from 'lightweight-charts'
import { mergeLatestBar, type IndicatorBar } from './calculations'

type VolumeBar = { time: UTCTimestamp; value: number; color: string }

export function getIndicatorBars(
  data: readonly CandlestickData<UTCTimestamp>[],
  latest: CandlestickData<UTCTimestamp> | null,
  volumes: readonly VolumeBar[],
): IndicatorBar[] {
  const merged = mergeLatestBar(data, latest)
  const volumeByTime = new Map(volumes.map((item) => [Number(item.time), item.value]))
  return merged.map((bar) => ({
    time: Number(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    tickVolume: volumeByTime.get(Number(bar.time)) ?? 0,
  }))
}
