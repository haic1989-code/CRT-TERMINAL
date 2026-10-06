import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getReplayImportRange } from './replayImportRange'

declare const process: { env: Record<string, string | undefined> }

const originalTimeZone = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'Europe/London'
})

afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimeZone
})

describe('getReplayImportRange for whole local days', () => {
  it('includes the full range from local midnight through the final millisecond', () => {
    const range = getReplayImportRange('2025-01-14', '2025-01-14', true, Date.parse('2025-02-01T12:00:00Z'))
    expect(range.fromMs).toBe(Date.parse('2025-01-14T00:00:00Z'))
    expect(range.toMs).toBe(Date.parse('2025-01-14T23:59:59.999Z'))
  })

  it('includes both endpoints across a multi-day range', () => {
    const range = getReplayImportRange('2025-01-14', '2025-01-16', true, Date.parse('2025-02-01T12:00:00Z'))
    expect(range.fromMs).toBe(Date.parse('2025-01-14T00:00:00Z'))
    expect(range.toMs).toBe(Date.parse('2025-01-16T23:59:59.999Z'))
  })

  it('clips today at the import start time', () => {
    const nowMs = Date.parse('2025-01-14T12:34:56.789Z')
    const range = getReplayImportRange('2025-01-14', '2025-01-14', true, nowMs)
    expect(range.fromMs).toBe(Date.parse('2025-01-14T00:00:00Z'))
    expect(range.toMs).toBe(nowMs)
  })

  it.each([
    ['spring transition (23 hours)', '2025-03-30', 23],
    ['autumn transition (25 hours)', '2025-10-26', 25],
  ])('uses calendar boundaries for the %s', (_label, day, hours) => {
    const range = getReplayImportRange(day, day, true, Date.parse('2025-12-01T00:00:00Z'))
    expect(range.toMs - range.fromMs + 1).toBe(Number(hours) * 60 * 60 * 1000)
  })

  it('rejects future starts, invalid calendar days, and reversed ranges', () => {
    const nowMs = Date.parse('2025-01-14T12:00:00Z')
    expect(() => getReplayImportRange('2025-01-15', '2025-01-15', true, nowMs)).toThrow(RangeError)
    expect(() => getReplayImportRange('2025-02-30', '2025-02-30', true, nowMs)).toThrow(RangeError)
    expect(() => getReplayImportRange('2025-01-16', '2025-01-14', true, nowMs)).toThrow(RangeError)
  })
})

describe('getReplayImportRange for exact timestamps', () => {
  it('clips the end to now and rejects invalid, reversed, and future ranges', () => {
    const nowMs = Date.parse('2025-01-14T12:00:00Z')
    expect(getReplayImportRange('2025-01-14T10:00', '2025-01-14T13:00', false, nowMs).toMs).toBe(nowMs)
    expect(() => getReplayImportRange('not-a-date', '2025-01-14T10:00', false, nowMs)).toThrow(RangeError)
    expect(() => getReplayImportRange('2025-01-14T11:00', '2025-01-14T10:00', false, nowMs)).toThrow(RangeError)
    expect(() => getReplayImportRange('2025-01-15T10:00', '2025-01-15T11:00', false, nowMs)).toThrow(RangeError)
  })
})
