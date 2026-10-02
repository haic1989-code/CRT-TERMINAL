/**
 * RSI over closing prices using Wilder-smoothed average gains and losses.
 * The first value is available after `period` price changes.
 */
export function calculateRsi(closes: readonly number[], requestedPeriod = 14): Array<number | null> {
  const period = Math.max(2, Math.min(500, Math.round(Number.isFinite(requestedPeriod) ? requestedPeriod : 14)))
  const values: Array<number | null> = Array.from({ length: closes.length }, () => null)
  if (closes.length <= period) return values

  let averageGain = 0
  let averageLoss = 0
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1]
    if (change > 0) averageGain += change
    else averageLoss -= change
  }
  averageGain /= period
  averageLoss /= period

  const valueFor = (gain: number, loss: number) => {
    if (gain === 0 && loss === 0) return 50
    if (loss === 0) return 100
    if (gain === 0) return 0
    return Math.max(0, Math.min(100, 100 - 100 / (1 + gain / loss)))
  }

  values[period] = valueFor(averageGain, averageLoss)
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1]
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)
    averageGain = (averageGain * (period - 1) + gain) / period
    averageLoss = (averageLoss * (period - 1) + loss) / period
    values[index] = valueFor(averageGain, averageLoss)
  }

  return values
}
