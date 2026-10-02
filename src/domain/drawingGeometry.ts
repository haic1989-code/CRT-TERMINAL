export function drawingTimeAtLogical(logical: number, bars: readonly { time: number }[], stepSeconds: number): number | null {
  if (!Number.isFinite(logical) || !bars.length || stepSeconds <= 0) return null
  const index = Math.round(logical)
  if (index < 0) return bars[0].time + index * stepSeconds
  if (index >= bars.length) return bars[bars.length - 1].time + (index - bars.length + 1) * stepSeconds
  return bars[index].time
}

export function drawingLogicalAtTime(time: number, bars: readonly { time: number }[], stepSeconds: number): number | null {
  if (!Number.isFinite(time) || !bars.length || stepSeconds <= 0) return null
  if (time < bars[0].time) return (time - bars[0].time) / stepSeconds
  const last = bars.length - 1
  if (time > bars[last].time) return last + (time - bars[last].time) / stepSeconds
  let low = 0
  let high = last
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (bars[middle].time === time) return middle
    if (bars[middle].time < time) low = middle + 1
    else high = middle - 1
  }
  const span = bars[low].time - bars[high].time
  return high + (time - bars[high].time) / span
}

/** Anchors follow the impulse: start is 100%, end is 0% retracement. */
export function fibonacciRetracementPrice(startPrice: number, endPrice: number, ratio: number): number {
  return endPrice + (startPrice - endPrice) * ratio
}
