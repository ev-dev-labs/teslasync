/**
 * Cookie consent storage helper tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONSENT_CHANGED_EVENT,
  CONSENT_STORAGE_KEY,
  clearConsent,
  getConsent,
  isReportingAllowed,
  setConsent,
  subscribeConsent,
} from '../cookieConsent'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('cookieConsent storage round-trip', () => {
  it('returns "unknown" when nothing is stored', () => {
    expect(getConsent()).toBe('unknown')
  })

  it('persists "accepted" and reads it back', () => {
    setConsent('accepted')
    expect(getConsent()).toBe('accepted')
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('accepted')
  })

  it('persists "declined" and reads it back', () => {
    setConsent('declined')
    expect(getConsent()).toBe('declined')
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('declined')
  })

  it('clearConsent wipes the stored value', () => {
    setConsent('accepted')
    expect(getConsent()).toBe('accepted')
    clearConsent()
    expect(getConsent()).toBe('unknown')
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull()
  })

  it('treats junk values as "unknown" without throwing', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'garbage')
    expect(getConsent()).toBe('unknown')
  })
})

describe('cookieConsent storage failures are non-fatal', () => {
  it('returns "unknown" when getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => getConsent()).not.toThrow()
    expect(getConsent()).toBe('unknown')
    spy.mockRestore()
  })

  it('does not throw when setItem throws (e.g. private mode quota)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setConsent('accepted')).not.toThrow()
    spy.mockRestore()
  })

  it('does not throw when removeItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('locked')
    })
    expect(() => clearConsent()).not.toThrow()
    spy.mockRestore()
  })
})

describe('cookieConsent change notifications', () => {
  it('fires CONSENT_CHANGED_EVENT on setConsent and includes the new state', () => {
    const listener = vi.fn()
    window.addEventListener(CONSENT_CHANGED_EVENT, listener as EventListener)
    setConsent('accepted')
    expect(listener).toHaveBeenCalledTimes(1)
    const ev = listener.mock.calls[0][0] as CustomEvent
    expect(ev.detail).toBe('accepted')
    window.removeEventListener(CONSENT_CHANGED_EVENT, listener as EventListener)
  })

  it('fires CONSENT_CHANGED_EVENT with "unknown" on clearConsent', () => {
    setConsent('declined')
    const listener = vi.fn()
    window.addEventListener(CONSENT_CHANGED_EVENT, listener as EventListener)
    clearConsent()
    expect(listener).toHaveBeenCalledTimes(1)
    const ev = listener.mock.calls[0][0] as CustomEvent
    expect(ev.detail).toBe('unknown')
    window.removeEventListener(CONSENT_CHANGED_EVENT, listener as EventListener)
  })

  it('subscribeConsent invokes the callback and returns an unsubscribe', () => {
    const cb = vi.fn()
    const unsub = subscribeConsent(cb)
    setConsent('accepted')
    expect(cb).toHaveBeenCalledWith('accepted')

    unsub()
    cb.mockClear()
    setConsent('declined')
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('isReportingAllowed', () => {
  it('returns true when consent is not required', () => {
    expect(isReportingAllowed(false)).toBe(true)
    setConsent('declined')
    expect(isReportingAllowed(false)).toBe(true)
  })

  it('returns false when consent is required and state is unknown', () => {
    expect(isReportingAllowed(true)).toBe(false)
  })

  it('returns false when consent is required and the user declined', () => {
    setConsent('declined')
    expect(isReportingAllowed(true)).toBe(false)
  })

  it('returns true when consent is required and the user accepted', () => {
    setConsent('accepted')
    expect(isReportingAllowed(true)).toBe(true)
  })
})
