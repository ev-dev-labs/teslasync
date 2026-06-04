import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  detectMissingFeatures,
  isCompatWarningDismissed,
  dismissCompatWarning,
  __resetCompatWarningForTests,
  COMPAT_WARNING_STORAGE_KEY,
} from '../browserCompat'

/**
 * browserCompat helper contract.
 *
 * Each test redefines a single global to simulate an unsupported
 * browser. Globals are restored via the original-value snapshot in
 * beforeEach so cross-test bleed is impossible.
 */

type Snapshot = {
  BroadcastChannel?: unknown
  ResizeObserver?: unknown
  Intl?: unknown
  crypto?: unknown
  CSS?: unknown
  structuredClone?: unknown
}

function snapshotGlobals(): Snapshot {
  const g = globalThis as unknown as Snapshot
  return {
    BroadcastChannel: g.BroadcastChannel,
    ResizeObserver: g.ResizeObserver,
    Intl: g.Intl,
    crypto: g.crypto,
    CSS: g.CSS,
    structuredClone: g.structuredClone,
  }
}

function restoreGlobals(snap: Snapshot) {
  for (const key of Object.keys(snap) as (keyof Snapshot)[]) {
    Object.defineProperty(globalThis, key, {
      value: snap[key],
      configurable: true,
      writable: true,
    })
  }
}

function setGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  })
}

function ensureCSSSupports(returnValue: boolean) {
  setGlobal('CSS', { supports: () => returnValue })
}

describe('detectMissingFeatures', () => {
  let snap: Snapshot

  beforeEach(() => {
    snap = snapshotGlobals()
    // Provide stubs that satisfy every check by default so each spec
    // can knock out exactly ONE feature and assert on it in isolation.
    setGlobal('BroadcastChannel', class {})
    setGlobal('ResizeObserver', class {})
    setGlobal('Intl', { RelativeTimeFormat: class {} })
    setGlobal('crypto', { randomUUID: () => 'stub' })
    ensureCSSSupports(true)
    setGlobal('structuredClone', () => ({}))
  })

  afterEach(() => {
    restoreGlobals(snap)
  })

  it('returns [] when every feature is present', () => {
    expect(detectMissingFeatures()).toEqual([])
  })

  it('flags missing BroadcastChannel', () => {
    setGlobal('BroadcastChannel', undefined)
    expect(detectMissingFeatures()).toContain('BroadcastChannel')
  })

  it('flags missing ResizeObserver', () => {
    setGlobal('ResizeObserver', undefined)
    expect(detectMissingFeatures()).toContain('ResizeObserver')
  })

  it('flags missing Intl.RelativeTimeFormat', () => {
    setGlobal('Intl', {})
    expect(detectMissingFeatures()).toContain('Intl.RelativeTimeFormat')
  })

  it('does not flag a missing crypto.randomUUID — it is no longer required', () => {
    /* crypto.randomUUID is restricted to secure contexts and undefined
     * over LAN IPs / custom HTTP hostnames. The app routes UUID
     * generation through @/lib/safeUUID#safeRandomUUID which falls
     * back to crypto.getRandomValues / Math.random, so its absence
     * must not block the boot sequence. */
    setGlobal('crypto', {})
    expect(detectMissingFeatures()).not.toContain('crypto.randomUUID')
  })

  it('flags missing CSS @supports', () => {
    setGlobal('CSS', undefined)
    expect(detectMissingFeatures()).toContain('CSS @supports')
  })

  it('flags missing CSS :has() when @supports returns false', () => {
    ensureCSSSupports(false)
    expect(detectMissingFeatures()).toContain('CSS :has()')
  })

  it('flags missing structuredClone', () => {
    setGlobal('structuredClone', undefined)
    expect(detectMissingFeatures()).toContain('structuredClone')
  })

  it('aggregates multiple missing features in deterministic order', () => {
    setGlobal('BroadcastChannel', undefined)
    setGlobal('structuredClone', undefined)
    const missing = detectMissingFeatures()
    expect(missing).toEqual(['BroadcastChannel', 'structuredClone'])
  })

  it('treats a thrown CSS.supports as evidence of incompatibility', () => {
    setGlobal('CSS', {
      supports: () => {
        throw new Error('boom')
      },
    })
    expect(detectMissingFeatures()).toContain('CSS @supports')
  })

  it('does not crash when crypto access throws (ITP / locked iframe)', () => {
    /* crypto.randomUUID is no longer required (see safeUUID.ts), but
     * a thrown property access must still not crash detection. */
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      get() {
        throw new Error('blocked by ITP')
      },
    })
    expect(() => detectMissingFeatures()).not.toThrow()
    expect(detectMissingFeatures()).not.toContain('crypto.randomUUID')
  })
})

describe('compat warning dismissal persistence', () => {
  beforeEach(() => {
    __resetCompatWarningForTests()
  })

  afterEach(() => {
    __resetCompatWarningForTests()
  })

  it('returns false before the user has dismissed', () => {
    expect(isCompatWarningDismissed()).toBe(false)
  })

  it('returns true after dismissCompatWarning() is called', () => {
    dismissCompatWarning()
    expect(isCompatWarningDismissed()).toBe(true)
  })

  it('persists under the canonical storage key', () => {
    dismissCompatWarning()
    expect(globalThis.localStorage.getItem(COMPAT_WARNING_STORAGE_KEY)).toBe('1')
  })

  it('survives __resetCompatWarningForTests() — the reset clears it', () => {
    dismissCompatWarning()
    expect(isCompatWarningDismissed()).toBe(true)
    __resetCompatWarningForTests()
    expect(isCompatWarningDismissed()).toBe(false)
  })
})
