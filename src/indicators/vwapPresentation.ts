/** Show only the active UTC day's VWAP points, never earlier daily segments. */
export function vwapPresentation<T extends { time: number; value: number }>(
  points: readonly T[],
  color = '#b594ff',
  utcDay = Math.floor(Date.now() / 86_400_000),
): Array<T & { color: string }> {
  return points
    .filter((point) => Math.floor(point.time / 86_400) === utcDay)
    .map((point) => ({ ...point, color }))
}
