import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PRODUCT_PREFERENCES,
  PRODUCT_PREFERENCES_STORAGE_KEY,
  getProductPreferencesSnapshot,
  resetProductPreferences,
} from '@/lib/productPreferences'
import { useProductPreferences } from './useProductPreferences'

describe('useProductPreferences', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
    resetProductPreferences()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    resetProductPreferences()
    window.localStorage.clear()
  })

  it('uses production-safe defaults when no preference is stored', () => {
    const { result } = renderHook(() => useProductPreferences())
    expect(result.current.preferences).toEqual(DEFAULT_PRODUCT_PREFERENCES)
  })

  it('persists same-tab updates and notifies every consumer', () => {
    const first = renderHook(() => useProductPreferences())
    const second = renderHook(() => useProductPreferences())

    act(() => {
      first.result.current.updatePreferences({
        persona: 'analyst',
        landingPage: '/analytics',
        contextualHelp: false,
      })
    })

    expect(second.result.current.preferences).toMatchObject({
      persona: 'analyst',
      landingPage: '/analytics',
      contextualHelp: false,
    })
    expect(
      JSON.parse(
        window.localStorage.getItem(PRODUCT_PREFERENCES_STORAGE_KEY) ?? '{}',
      ),
    ).toMatchObject({
      version: 1,
      persona: 'analyst',
      landingPage: '/analytics',
      contextualHelp: false,
    })
  })

  it('preserves sequential in-memory updates when storage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const first = renderHook(() => useProductPreferences())

    act(() => {
      first.result.current.updatePreferences({
        persona: 'analyst',
        landingPage: '/analytics',
      })
    })
    act(() => {
      first.result.current.updatePreferences({
        contextualHelp: false,
      })
    })

    expect(getProductPreferencesSnapshot()).toMatchObject({
      persona: 'analyst',
      landingPage: '/analytics',
      contextualHelp: false,
    })

    const second = renderHook(() => useProductPreferences())
    expect(second.result.current.preferences).toMatchObject({
      persona: 'analyst',
      landingPage: '/analytics',
      contextualHelp: false,
    })
  })

  it('keeps a failed reset authoritative for later in-memory updates', () => {
    const { result } = renderHook(() => useProductPreferences())
    act(() => {
      result.current.updatePreferences({
        persona: 'administrator',
        landingPage: '/analytics',
      })
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    act(() => {
      result.current.resetPreferences()
    })
    expect(getProductPreferencesSnapshot()).toEqual(
      DEFAULT_PRODUCT_PREFERENCES,
    )

    act(() => {
      result.current.updatePreferences({ releaseHighlights: false })
    })

    expect(result.current.preferences).toEqual({
      ...DEFAULT_PRODUCT_PREFERENCES,
      releaseHighlights: false,
    })
  })

  it('falls back field-by-field when persisted data is corrupted', () => {
    window.localStorage.setItem(
      PRODUCT_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        persona: 'invented-role',
        landingPage: 'https://example.com',
        defaultVehicleId: -8,
        defaultAnalysisRange: 'century',
        contextualHelp: 'yes',
        releaseHighlights: false,
      }),
    )

    const { result } = renderHook(() => useProductPreferences())
    expect(result.current.preferences).toEqual({
      ...DEFAULT_PRODUCT_PREFERENCES,
      releaseHighlights: false,
    })
  })

  it('recovers from malformed JSON without throwing', () => {
    window.localStorage.setItem(
      PRODUCT_PREFERENCES_STORAGE_KEY,
      '{not-json',
    )
    const { result } = renderHook(() => useProductPreferences())
    expect(result.current.preferences).toEqual(DEFAULT_PRODUCT_PREFERENCES)
  })

  it('applies cross-tab storage updates', () => {
    const { result } = renderHook(() => useProductPreferences())
    const next = {
      version: 1,
      ...DEFAULT_PRODUCT_PREFERENCES,
      persona: 'fleet_operator',
      defaultVehicleId: 42,
    }

    act(() => {
      window.localStorage.setItem(
        PRODUCT_PREFERENCES_STORAGE_KEY,
        JSON.stringify(next),
      )
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PRODUCT_PREFERENCES_STORAGE_KEY,
          newValue: JSON.stringify(next),
        }),
      )
    })

    expect(result.current.preferences.persona).toBe('fleet_operator')
    expect(result.current.preferences.defaultVehicleId).toBe(42)
  })

  it('resets every preference as one atomic update', () => {
    const { result } = renderHook(() => useProductPreferences())
    act(() => {
      result.current.updatePreferences({
        persona: 'administrator',
        releaseHighlights: false,
      })
    })
    act(() => {
      result.current.resetPreferences()
    })

    expect(result.current.preferences).toEqual(DEFAULT_PRODUCT_PREFERENCES)
    expect(
      window.localStorage.getItem(PRODUCT_PREFERENCES_STORAGE_KEY),
    ).toBeNull()
  })
})
