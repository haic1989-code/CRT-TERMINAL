/** Split a broker-valid total lot size over enabled take-profits in volume-step units. */
export function allocateTargetLots(totalLots: number, allocations: number[], enabled: boolean[], volumeStep: number): number[] {
  const step = Number.isFinite(volumeStep) && volumeStep > 0 ? volumeStep : 0.01
  const total = Number.isFinite(totalLots) && totalLots > 0 ? totalLots : 0
  const totalUnits = Math.max(0, Math.round(total / step))
  const indexes = enabled.map((active, index) => active ? index : -1).filter(index => index >= 0)
  const result = Array.from({ length: enabled.length }, () => 0)
  const weightTotal = indexes.reduce((sum, index) => sum + Math.max(0, Number(allocations[index]) || 0), 0)
  let remaining = totalUnits
  indexes.forEach((index, activeIndex) => {
    const desiredUnits = activeIndex === indexes.length - 1
      ? remaining
      : Math.round(totalUnits * (weightTotal > 0 ? Math.max(0, Number(allocations[index]) || 0) / weightTotal : 1 / indexes.length))
    const units = Math.min(remaining, desiredUnits)
    result[index] = Number((units * step).toFixed(8))
    remaining -= units
  })
  return result
}
