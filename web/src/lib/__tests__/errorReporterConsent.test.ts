import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  __getBufferedCountForTests,
  __getBufferedPayloadsForTests,
  __resetErrorReporterForTests,
  __setErrorReporterEnabledForTests,
  installGlobalErrorReporting,
  reportFrontendError,
  setErrorReporterConsentRequirement,
  getRecentReportsForFeedback,
} from '../errorReporter'
import {
  CONSENT_POLICY_STORAGE_KEY,
  __reinitVitalsConsentPolicyFromStorageForTests,
  resetVitalsConsentRequirementForTests,
} from '../webVitalsConsent'
import { clearConsent, setConsent } from '../cookieConsent'

/**
 * Error-reporter consent gate.
 *
 * The reporter shares ONE tri-state policy store with the Web Vitals reporter
 * (`webVitalsConsent.ts`), so the two gates cannot drift apart. These specs
 * pin the three states plus the races that matter for a reporter which is
 * installed *before* React and the version query exist:
 *
 *   hold — policy unresolved: buffer, transmit nothing, do NOT drain the
 *          offline buffer (not even on an `online` event).
 *   drop — required + declined/unanswered: transmit nothing AND destroy the
 *          buffer so a later Accept cannot resurrect pre-consent reports.
 *   send — resolved `not-required`, or `required` + `accepted`.
 *
 * `__setErrorReporterEnabledForTests(true)` simulates a production build; it
 * does not bypass the consent gate.
 */

let fetchSpy: ReturnType<typeof vi.fn>

function online(): void {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
}

function offline(): void {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
}

describe('errorReporter — tri-state consent gate', () => {
  beforeEach(() => {
    localStorage.clear()
    clearConsent()
    __resetErrorReporterForTests()
    __setErrorReporterEnabledForTests(true) // simulate a production build
    resetVitalsConsentRequirementForTests('unknown')
    fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
    online()
  })

  afterEach(() => {
    localStorage.clear()
    clearConsent()
    __resetErrorReporterForTests()
    online()
  })

  // ── hold ────────────────────────────────────────────────────────────────

  it('an early global error before the policy resolves is buffered, not sent', () => {
    // This is the real boot sequence: installGlobalErrorReporting() runs in
    // main.tsx long before React mounts and the version query resolves.
    installGlobalErrorReporting()
    window.dispatchEvent(
      new ErrorEvent('error', { error: new TypeError('boot exploded'), message: 'boot exploded' }),
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(1)
  })

  it('holds an error reported directly before the policy resolves', () => {
    reportFrontendError(new Error('pre-resolution'), 'react')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(1)
  })

  it('does NOT drain the offline buffer while the policy is unresolved', () => {
    installGlobalErrorReporting()
    reportFrontendError(new Error('held-a'), 'window')
    reportFrontendError(new Error('held-b'), 'query')
    expect(__getBufferedCountForTests()).toBe(2)

    // Coming back online must not be enough — the policy is still unknown.
    window.dispatchEvent(new Event('online'))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(2)
  })

  it('still records held reports in the local feedback ring', () => {
    reportFrontendError(new Error('held-for-feedback'), 'react')
    const ring = getRecentReportsForFeedback()
    expect(ring).toHaveLength(1)
    expect(ring[0].message).toContain('held-for-feedback')
    // …but nothing left the browser.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a cached not-required hint cannot authorise sending before resolution', () => {
    localStorage.setItem(
      CONSENT_POLICY_STORAGE_KEY,
      JSON.stringify({ policy: 'not-required', at: Date.now() }),
    )
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBeNull()

    reportFrontendError(new Error('cached-permissive'), 'window')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(1)
  })

  // ── send ────────────────────────────────────────────────────────────────

  it('drains the held buffer once the policy resolves to not-required', () => {
    installGlobalErrorReporting()
    reportFrontendError(new Error('held-1'), 'window')
    reportFrontendError(new Error('held-2'), 'query')
    expect(__getBufferedCountForTests()).toBe(2)

    setErrorReporterConsentRequirement(false)

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(__getBufferedCountForTests()).toBe(0)
  })

  it('sends immediately once the policy is resolved not-required', () => {
    setErrorReporterConsentRequirement(false)
    reportFrontendError(new Error('post-resolution'), 'react')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(__getBufferedCountForTests()).toBe(0)
  })

  it('sends when the policy requires consent and the user accepted', () => {
    setConsent('accepted')
    setErrorReporterConsentRequirement(true)
    reportFrontendError(new Error('accepted-basis'), 'react')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // ── drop ────────────────────────────────────────────────────────────────

  it('drops when the policy requires consent and the user declined', () => {
    setConsent('declined')
    setErrorReporterConsentRequirement(true)
    reportFrontendError(new Error('declined'), 'react')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(0)
  })

  it('drops when the policy requires consent and the user has not answered', () => {
    setErrorReporterConsentRequirement(true)
    reportFrontendError(new Error('unanswered'), 'react')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(0)
  })

  it('destroys the held buffer when the policy resolves to required with no answer', () => {
    installGlobalErrorReporting()
    reportFrontendError(new Error('held-then-refused'), 'window')
    expect(__getBufferedCountForTests()).toBe(1)

    setErrorReporterConsentRequirement(true)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(0)
  })

  it('honours an explicit decline even on a not-required deployment', () => {
    setErrorReporterConsentRequirement(false)
    setConsent('declined')
    reportFrontendError(new Error('declined-anyway'), 'react')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ── consent transition races ────────────────────────────────────────────

  it('hold -> accept: buffered pre-consent reports never cross the accept', () => {
    installGlobalErrorReporting()
    reportFrontendError(new Error('pre-accept'), 'window')
    expect(__getBufferedCountForTests()).toBe(1)

    // Synchronous purge inside setConsent().
    setConsent('accepted')
    expect(__getBufferedCountForTests()).toBe(0)

    setErrorReporterConsentRequirement(true)
    expect(fetchSpy).not.toHaveBeenCalled()

    reportFrontendError(new Error('post-accept'), 'window')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('accept -> decline: buffered reports are discarded synchronously', () => {
    installGlobalErrorReporting()
    setConsent('accepted')
    setErrorReporterConsentRequirement(true)
    offline()
    reportFrontendError(new Error('while-accepted'), 'window')
    expect(__getBufferedCountForTests()).toBe(1)

    setConsent('declined')
    expect(__getBufferedCountForTests()).toBe(0)

    online()
    window.dispatchEvent(new Event('online'))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('offline buffer drains normally once online AND permitted', () => {
    installGlobalErrorReporting()
    setErrorReporterConsentRequirement(false)
    offline()
    reportFrontendError(new Error('offline-1'), 'window')
    reportFrontendError(new Error('offline-2'), 'query')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(2)

    online()
    window.dispatchEvent(new Event('online'))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(__getBufferedCountForTests()).toBe(0)
  })

  it('an offline buffer collected while unresolved is not drained by going online', () => {
    installGlobalErrorReporting()
    offline()
    reportFrontendError(new Error('offline-unresolved'), 'window')
    online()
    window.dispatchEvent(new Event('online'))
    expect(fetchSpy).not.toHaveBeenCalled()

    // …and is delivered only once the policy actually permits it.
    setErrorReporterConsentRequirement(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('publishing undefined returns the reporter to the fail-closed hold state', () => {
    setErrorReporterConsentRequirement(false)
    reportFrontendError(new Error('sent'), 'react')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    setErrorReporterConsentRequirement(undefined)
    reportFrontendError(new Error('held-again'), 'window')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(__getBufferedCountForTests()).toBe(1)
  })
})

describe('errorReporter — buffered payloads never carry raw route/query/hash', () => {
  const originalLocation = window.location

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    clearConsent()
    __resetErrorReporterForTests()
    __setErrorReporterEnabledForTests(true)
    resetVitalsConsentRequirementForTests('unknown')
    fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
    online()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true })
    localStorage.clear()
    sessionStorage.clear()
    clearConsent()
    __resetErrorReporterForTests()
  })

  function at(pathname: string, search = '', hash = ''): void {
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        href: `https://app.example.com${pathname}${search}${hash}`,
        pathname,
        search,
        hash,
      },
      configurable: true,
    })
  }

  /**
   * Everything the reporter can be holding, in one string: the buffered
   * payloads (what WOULD be POSTed), the local feedback ring, every fetch body
   * actually sent, and both web storages.
   */
  function everythingRetained(): string {
    const bodies = fetchSpy.mock.calls.map(call => String((call[1] as RequestInit)?.body ?? ''))
    const storage: string[] = []
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (key) storage.push(key, store.getItem(key) ?? '')
      }
    }
    return JSON.stringify({
      buffered: __getBufferedPayloadsForTests(),
      feedbackRing: getRecentReportsForFeedback(),
      bodies,
      storage,
    })
  }

  const SECRETS = ['share-token-abc', 'hunter2', 'deep-link-target', 'secret=', '#frag']

  it('early boot hold -> send on /s/:token never discloses the token, query or hash', () => {
    at('/s/share-token-abc', '?secret=hunter2', '#deep-link-target#frag')

    // Boot sequence: listeners installed long before React or the version query.
    installGlobalErrorReporting()
    const err = new TypeError('render failed at /s/share-token-abc?secret=hunter2#frag')
    err.stack =
      'TypeError: render failed\n' +
      '    at Share (https://app.example.com/s/share-token-abc?secret=hunter2#frag)\n' +
      '    at commit (https://app.example.com/assets/index-abc123.js:1:2)'
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }))

    // Fail closed: nothing has been transmitted yet.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(1)
    expect(__getBufferedPayloadsForTests()[0].route).toBe('/s/:id')

    // Nothing sensitive is retained anywhere while held.
    for (const secret of SECRETS) {
      expect(everythingRetained()).not.toContain(secret)
    }

    // The policy resolves and the held report is delivered — still clean.
    setErrorReporterConsentRequirement(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>
    expect(body.route).toBe('/s/:id')
    for (const secret of SECRETS) {
      expect(everythingRetained()).not.toContain(secret)
    }
    // The non-sensitive stack frame survives, so the report stays debuggable.
    expect(body.stack).toContain('index-abc123.js')
  })

  it('templates /year-review/:year', () => {
    at('/year-review/2024', '?share=abc')
    installGlobalErrorReporting()
    reportFrontendError(new Error('year review boom'), 'react')
    setErrorReporterConsentRequirement(false)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>
    expect(body.route).toBe('/year-review/:id')
    expect(everythingRetained()).not.toContain('2024')
    expect(everythingRetained()).not.toContain('share=abc')
  })

  it('templates numeric entity IDs', () => {
    at('/drives/48291', '', '#segment-7')
    installGlobalErrorReporting()
    reportFrontendError(new Error('drive detail boom'), 'query')
    setErrorReporterConsentRequirement(false)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>
    expect(body.route).toBe('/drives/:id')
    expect(everythingRetained()).not.toContain('48291')
    expect(everythingRetained()).not.toContain('segment-7')
  })

  it('templates a VIN in the path', () => {
    at('/vehicles/5YJ3E1EA7JF000316')
    installGlobalErrorReporting()
    reportFrontendError(new Error('vehicle boom'), 'react')
    setErrorReporterConsentRequirement(false)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>
    expect(body.route).toBe('/vehicles/:id')
    expect(everythingRetained()).not.toContain('5YJ3E1EA7JF000316')
  })

  it('keeps ordinary static routes readable', () => {
    at('/analytics/battery-degradation')
    installGlobalErrorReporting()
    reportFrontendError(new Error('analytics boom'), 'react')
    setErrorReporterConsentRequirement(false)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>
    expect(body.route).toBe('/analytics/battery-degradation')
  })

  it('a held /s/:token report is destroyed, not disclosed, when consent is refused', () => {
    at('/s/share-token-abc', '?secret=hunter2', '#frag')
    installGlobalErrorReporting()
    reportFrontendError(new Error('boot boom'), 'window')
    expect(__getBufferedCountForTests()).toBe(1)

    // Policy resolves to "consent required" with no answer: fail closed.
    setErrorReporterConsentRequirement(true)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(0)
    for (const secret of SECRETS) {
      expect(everythingRetained()).not.toContain(secret)
    }
  })

  it('a consent transition still discards a held /s/:token report', () => {
    at('/s/share-token-abc', '?secret=hunter2')
    installGlobalErrorReporting()
    reportFrontendError(new Error('pre-accept boom'), 'window')
    expect(__getBufferedCountForTests()).toBe(1)

    setConsent('accepted')
    expect(__getBufferedCountForTests()).toBe(0)

    setErrorReporterConsentRequirement(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ── URLs other than the current page ────────────────────────────────────

  it('a STATIC page referencing another share URL never leaks that token', () => {
    // The crash happens on an ordinary static page. The message and stack
    // reference a DIFFERENT share link, in every spelling a browser produces.
    at('/analytics/tco')
    installGlobalErrorReporting()

    const err = new TypeError('failed to load https://app.example.com/s/another-token?k=v#frag')
    err.stack = [
      'TypeError: failed to load',
      '    at fetchShare (https://app.example.com/s/another-token?k=v#frag)',
      '    at retry (//cdn.example.com/s/protocol-relative-token)',
      '    at rel (/s/root-relative-token?secret=hunter2)',
      '    at enc (/s/%61nother-encoded-token)',
      '    at bad (/s/%zz-malformed)',
      '    at trips (/trips/customer-private-slug);',
      '    at edit (/automations/private-name/edit);',
      '    at commit (https://app.example.com/assets/index-abc123.js:118:27)',
    ].join('\n')

    window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(1)

    const OTHER_SECRETS = [
      'another-token',
      'protocol-relative-token',
      'root-relative-token',
      'another-encoded-token',
      '%61nother',
      '%zz',
      'customer-private-slug',
      'private-name',
      'hunter2',
      'k=v',
      '#frag',
    ]

    // Held: nothing sensitive anywhere.
    for (const secret of OTHER_SECRETS) {
      expect(everythingRetained()).not.toContain(secret)
    }

    setErrorReporterConsentRequirement(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Sent: still nothing sensitive, in the body or anywhere else.
    for (const secret of OTHER_SECRETS) {
      expect(everythingRetained()).not.toContain(secret)
    }

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>
    expect(body.route).toBe('/analytics/tco')
    expect(body.message).toContain('/s/:id')
    expect(body.stack).toContain('/s/:id')
    expect(body.stack).toContain('/trips/:id')
    expect(body.stack).toContain('/automations/:id/edit')
    // The build artifact — with its source position — survives, so the report
    // is still actionable.
    expect(body.stack).toContain('/assets/index-abc123.js:118:27')
  })

  it('root-relative API paths in a message are conservatively redacted', () => {
    at('/dashboard')
    installGlobalErrorReporting()
    reportFrontendError(
      new Error('GET /api/v1/vehicles/48291 -> 500; GET /unknown/customer-private-slug -> 500'),
      'query',
    )
    setErrorReporterConsentRequirement(false)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>
    expect(body.message).toContain('/api/v1/vehicles/:id')
    expect(everythingRetained()).not.toContain('48291')
    expect(everythingRetained()).not.toContain('customer-private-slug')
  })

  it('malformed percent-encoding is redacted rather than decoded', () => {
    at('/search/%zz')
    installGlobalErrorReporting()
    reportFrontendError(new Error('bad encoding at /search/%zz and /search/%2'), 'window')
    setErrorReporterConsentRequirement(false)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>
    expect(body.route).toBe('/search/:id')
    expect(everythingRetained()).not.toContain('%zz')
    expect(everythingRetained()).not.toContain('%2')
  })

  it('an asset URL cannot smuggle a token through its parent directory', () => {
    at('/dashboard')
    installGlobalErrorReporting()

    const err = new TypeError('chunk load failed')
    err.stack = [
      'ChunkLoadError: loading chunk failed',
      '    at a (/share/SECRETTOKENVALUE/index.html)',
      '    at b (https://app.example.com/s/tok-private-abc/main.js:1:2)',
      '    at c (//cdn.example.com/trips/customer-private-slug/report.css:4)',
      '    at d (https://app.example.com/assets/index-abc123.js:118:27)',
    ].join('\n')
    reportFrontendError(err, 'window')
    setErrorReporterConsentRequirement(false)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>

    for (const secret of [
      'SECRETTOKENVALUE',
      'tok-private-abc',
      'customer-private-slug',
    ]) {
      expect(everythingRetained()).not.toContain(secret)
    }
    expect(body.stack).toContain('/share/:id/index.html')
    expect(body.stack).toContain('/s/:id/main.js:1:2')
    expect(body.stack).toContain('/trips/:id/report.css:4')
    // The genuine build artifact keeps its path AND source position.
    expect(body.stack).toContain('/assets/index-abc123.js:118:27')
  })

  it('an authority-only URL retains no query or fragment parameters', () => {
    at('/dashboard')
    installGlobalErrorReporting()
    reportFrontendError(
      new Error(
        'redirect to https://host?code=SECRETCODE/x then https://host#share=SECRETFRAG/bb and //host?invite=SECRETINVITE/y',
      ),
      'query',
    )
    setErrorReporterConsentRequirement(false)

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, string>

    for (const secret of [
      'SECRETCODE',
      'SECRETFRAG',
      'SECRETINVITE',
      'code=',
      'share=',
      'invite=',
    ]) {
      expect(everythingRetained()).not.toContain(secret)
    }
    expect(body.message).toContain('https://host')
    expect(body.message).toContain('//host')
  })
})
