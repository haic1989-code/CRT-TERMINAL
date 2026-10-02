import { describe, expect, it } from 'vitest'
import { vwapPresentation } from './vwapPresentation'

describe('VWAP session presentation', () => {
  it('shows only the selected UTC day and omits older daily VWAP segments', () => {
    const points = [{time: 85800, value: 2000}, {time: 86100, value: 2001}, {time: 86400, value: 2050}, {time: 86700, value: 2051}]
    const shown = vwapPresentation(points, '#b594ff', 1)
    expect(shown.map(p => p.color)).toEqual(['#b594ff', '#b594ff'])
    expect(shown.map(({color, ...point}) => point)).toEqual(points.slice(2))
  })
  it('shows no VWAP until the selected UTC day has chart data', () => {
    expect(vwapPresentation([{time: 86100, value: 2001}], '#b594ff', 1)).toEqual([])
    expect(vwapPresentation([{time: 86400, value: 2050}], '#b594ff', 1)).toEqual([{time: 86400, value: 2050, color: '#b594ff'}])
  })
})
