export type ReplayImportRange = { fromMs: number; toMs: number }

export function getReplayImportRange(from: string, to: string, wholeDays: boolean, nowMs: number): ReplayImportRange {
  if (!Number.isFinite(nowMs)) throw new RangeError('Import time must be a valid timestamp')

  if (!wholeDays) {
    const fromMs = new Date(from).getTime()
    const toMs = new Date(to).getTime()
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      throw new RangeError('Import range must contain valid dates in ascending order')
    }
    if (fromMs > nowMs) throw new RangeError('Import range cannot start in the future')
    return { fromMs, toMs: Math.min(toMs, nowMs) }
  }

  const fromDate = from.slice(0, 10)
  const toDate = to.slice(0, 10)
  const start = new Date(`${fromDate}T00:00:00`)
  const end = new Date(`${toDate}T00:00:00`)
  const isValidDate = (value: string, parsed: Date) => {
    const [year, month, day] = value.split('-').map(Number)
    return Number.isFinite(parsed.getTime()) && parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day
  }
  if (!isValidDate(fromDate, start) || !isValidDate(toDate, end) || start > end) {
    throw new RangeError('Import range must contain valid calendar days in ascending order')
  }
  if (start.getTime() > nowMs) throw new RangeError('Import range cannot start in the future')

  // Advance a calendar day in local time, rather than adding 24 hours: DST
  // days can have 23/25 hours. The backend's end timestamp is inclusive.
  end.setDate(end.getDate() + 1)
  return { fromMs: start.getTime(), toMs: Math.min(end.getTime() - 1, nowMs) }
}
