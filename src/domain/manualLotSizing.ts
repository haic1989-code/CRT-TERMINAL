import type { SymbolSpec } from './contracts'
import type { SizingResult } from '../engines'

/** Broker-aligned preview volume. An unsupported minimum never rounds the request up. */
export function manualLotSizing(lots: number, entry: number, stop: number, spec: SymbolSpec, marginPerLot?: number): SizingResult {
  const empty = { volume: 0, riskCash: 0, lossAtStop: 0, marginEstimate: 0, cappedByMargin: false }
  if (![lots, entry, stop, spec.tickSize, spec.tickValueLoss ?? spec.tickValue, spec.volumeStep, spec.volumeMin, spec.volumeMax].every(Number.isFinite)
    || lots < .01 || lots > 1 || spec.tickSize <= 0 || spec.volumeStep <= 0 || spec.volumeMin <= 0 || spec.volumeMax < spec.volumeMin || entry <= 0 || stop <= 0 || entry === stop) return empty
  const volume = Number((Math.floor((Math.min(lots, spec.volumeMax) + 1e-10) / spec.volumeStep) * spec.volumeStep).toFixed(8))
  if (volume < spec.volumeMin || (spec.tickValueLoss ?? spec.tickValue) <= 0) return empty
  const riskCash = Math.abs(entry - stop) / spec.tickSize * (spec.tickValueLoss ?? spec.tickValue) * volume
  return { volume, riskCash, lossAtStop: riskCash, marginEstimate: volume * (marginPerLot ?? 0), cappedByMargin: false }
}
