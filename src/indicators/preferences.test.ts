import { describe, expect, it } from 'vitest'
import { createDefaultIndicatorPreferences, parseIndicatorPreferences, serializeIndicatorPreferences, withActiveIndicator, withIndicatorPeriod, withIndicatorVisibility, withoutActiveIndicator } from './preferences'

describe('indicator preferences', () => {
  it('round-trips active indicators and settings', () => {
    const initial = createDefaultIndicatorPreferences()
    const changed = withIndicatorPeriod(withIndicatorVisibility(withActiveIndicator(initial, 'RSI'), 'RSI', false), 'RSI', 9)
    const restored = parseIndicatorPreferences(serializeIndicatorPreferences(changed))

    expect(restored.active).toEqual(['RSI'])
    expect(restored.settings.RSI).toEqual({ visible: false, period: 9 })
  })

  it('removes chart activation while retaining settings for a later add', () => {
    const added = withActiveIndicator(createDefaultIndicatorPreferences(), 'EMA 50')
    const tuned = withIndicatorPeriod(added, 'EMA 50', 34)
    const removed = withoutActiveIndicator(tuned, 'EMA 50')

    expect(removed.active).toEqual([])
    expect(removed.settings['EMA 50']).toEqual({ visible: true, period: 34 })
  })

  it('fails closed to defaults for malformed or unsupported saved state', () => {
    expect(parseIndicatorPreferences('{broken')).toEqual(createDefaultIndicatorPreferences())
    expect(parseIndicatorPreferences(JSON.stringify({ version: 9, active: ['SMA 20'], settings: {} }))).toEqual(createDefaultIndicatorPreferences())
  })
})
