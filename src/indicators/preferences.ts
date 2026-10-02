import { INDICATOR_CATALOG, isIndicatorId, normalizeIndicatorPeriod, type IndicatorId, type IndicatorPreferences, type IndicatorSettings } from './catalog'

export const INDICATOR_PREFERENCES_KEY = 'smartflow-x:indicators:v1'
const STORAGE_VERSION = 1

export function createDefaultIndicatorPreferences(): IndicatorPreferences {
  const settings: IndicatorSettings = {}
  for (const indicator of INDICATOR_CATALOG) {
    settings[indicator.id] = {
      visible: true,
      ...(indicator.defaultPeriod !== undefined ? { period: indicator.defaultPeriod } : {}),
    }
  }
  return { active: [], settings }
}

export function parseIndicatorPreferences(serialized: string | null): IndicatorPreferences {
  const fallback = createDefaultIndicatorPreferences()
  if (!serialized) return fallback

  try {
    const parsed = JSON.parse(serialized) as { version?: unknown; active?: unknown; settings?: unknown }
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.active) || !parsed.settings || typeof parsed.settings !== 'object') return fallback

    const active = [...new Set(parsed.active.filter(isIndicatorId))]
    const storedSettings = parsed.settings as Record<string, unknown>
    const settings: IndicatorSettings = { ...fallback.settings }
    for (const indicator of INDICATOR_CATALOG) {
      const value = storedSettings[indicator.id]
      if (!value || typeof value !== 'object') continue
      const stored = value as { visible?: unknown; period?: unknown }
      settings[indicator.id] = {
        visible: typeof stored.visible === 'boolean' ? stored.visible : true,
        ...(indicator.defaultPeriod !== undefined
          ? { period: normalizeIndicatorPeriod(indicator.id, Number(stored.period) || indicator.defaultPeriod) }
          : {}),
      }
    }
    return { active, settings }
  } catch {
    return fallback
  }
}

export function serializeIndicatorPreferences(preferences: IndicatorPreferences) {
  return JSON.stringify({ version: STORAGE_VERSION, active: preferences.active, settings: preferences.settings })
}

export function readIndicatorPreferences(): IndicatorPreferences {
  if (typeof window === 'undefined') return createDefaultIndicatorPreferences()
  try {
    return parseIndicatorPreferences(window.localStorage.getItem(INDICATOR_PREFERENCES_KEY))
  } catch {
    return createDefaultIndicatorPreferences()
  }
}

export function writeIndicatorPreferences(preferences: IndicatorPreferences) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(INDICATOR_PREFERENCES_KEY, serializeIndicatorPreferences(preferences))
  } catch {
    // Browser storage may be disabled or full; indicator use remains available for this session.
  }
}

export function withActiveIndicator(preferences: IndicatorPreferences, id: IndicatorId): IndicatorPreferences {
  const current = preferences.settings[id] ?? { visible: true }
  return {
    ...preferences,
    active: preferences.active.includes(id) ? preferences.active : [...preferences.active, id],
    settings: { ...preferences.settings, [id]: { ...current, visible: true } },
  }
}

export function withIndicatorVisibility(preferences: IndicatorPreferences, id: IndicatorId, visible: boolean): IndicatorPreferences {
  return {
    ...preferences,
    settings: { ...preferences.settings, [id]: { ...(preferences.settings[id] ?? { visible: true }), visible } },
  }
}

export function withIndicatorPeriod(preferences: IndicatorPreferences, id: IndicatorId, period: number): IndicatorPreferences {
  const normalized = normalizeIndicatorPeriod(id, period)
  if (normalized === undefined) return preferences
  return {
    ...preferences,
    settings: { ...preferences.settings, [id]: { ...(preferences.settings[id] ?? { visible: true }), period: normalized } },
  }
}

export function withoutActiveIndicator(preferences: IndicatorPreferences, id: IndicatorId): IndicatorPreferences {
  return { ...preferences, active: preferences.active.filter((activeId) => activeId !== id) }
}
