/**
 * Demo / sample mode (HELP-12).
 *
 * Demo mode exists so the product can be shown without a linked vehicle. That
 * is a legitimate need and a serious hazard: the moment synthetic data can
 * reach a real deployment, every number on screen becomes untrustworthy, and
 * a screenshot of fake degradation is indistinguishable from a real one.
 *
 * The design is therefore fail-closed on every axis:
 *
 *  1. **Never on by default.** Absence of configuration means disabled. The
 *     flag must be the exact string `'true'` — `'1'`, `'yes'`, `'TRUE'` and
 *     anything else are rejected, so a sloppy env file cannot enable it.
 *  2. **Isolated data source.** Enabling also requires an explicitly
 *     configured demo API base that is NOT the production base. Without it,
 *     synthetic UI would be pointed at real endpoints — so the guard refuses
 *     to enable rather than risk the mix.
 *  3. **Isolated storage and cache.** All demo persistence goes through
 *     {@link demoStorageKey}, and all demo query keys through
 *     {@link demoQueryKey}. Both are namespaced, so a demo session cannot
 *     overwrite a real session's saved views, drafts or query cache — and
 *     purging demo state cannot touch real state.
 *  4. **Unmistakable.** {@link DEMO_MODE_LABEL} is rendered persistently by
 *     `<DemoModeBanner>`; the label is not dismissible.
 *
 * Every guard returns a machine-readable reason so the state is debuggable
 * without reading the source.
 */

export type DemoModeDisabledReason =
  | 'flag_absent'
  | 'flag_not_exact_true'
  | 'demo_api_base_missing'
  | 'demo_api_base_collides_with_production'

export interface DemoModeState {
  enabled: boolean
  /** Populated only when `enabled` is false. */
  reason?: DemoModeDisabledReason
  /** The isolated API base, only when enabled. */
  apiBase?: string
}

type EnvRecord = Record<string, string | undefined>

/** The production API base the shared client prefixes onto every request. */
export const PRODUCTION_API_BASE = '/api/v1'

/** Storage namespace for every value written while demo mode is active. */
export const DEMO_STORAGE_NAMESPACE = 'teslasync:demo:'

/** Query-key namespace for every TanStack Query key used in demo mode. */
export const DEMO_QUERY_KEY_PREFIX = '__demo__'

/** Non-dismissible banner text. Intentionally blunt. */
export const DEMO_MODE_LABEL = 'DEMO DATA — synthetic sample, not your vehicle'

function readEnv(env?: EnvRecord): EnvRecord {
  if (env) return env
  if (typeof import.meta === 'undefined') return {}
  return (import.meta.env as unknown as EnvRecord) ?? {}
}

function normalizeBase(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

/**
 * The app's origin, or a stable placeholder when there is no DOM.
 *
 * A placeholder rather than `''` so `new URL()` below always has something to
 * resolve against — an unresolvable base must fail the collision check, not
 * throw past it.
 */
function currentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'http://localhost'
}

/**
 * Resolve a base to an absolute `origin + pathname`, with no trailing slash.
 *
 * Returns null when the value cannot be resolved, which callers treat as a
 * collision (fail closed) rather than as "definitely fine".
 */
function resolveBase(value: string): string | null {
  const trimmed = normalizeBase(value)
  if (trimmed === '') return null
  try {
    const url = new URL(trimmed, currentOrigin())
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/**
 * Does the demo base collide with the production API base?
 *
 * String equality against the literal `/api/v1` was not enough. All of these
 * resolve to the production API and previously passed the guard, enabling demo
 * mode over real data — the worst possible outcome, because it stamps "DEMO
 * DATA" on genuine vehicle readings:
 *
 *   `https://app.example.com/api/v1`   (absolute, same origin)
 *   `/api/v1/`                          (trailing slash)
 *   `api/v1`                            (no leading slash)
 *   `/api/v1/vehicles`                  (nested INSIDE the production API)
 *
 * Both bases are resolved against the current origin and compared as
 * origin+path, then checked for containment in either direction on a PATH
 * BOUNDARY. The boundary matters: `/api/v1-demo` merely starts with the
 * production string and is a legitimately separate base, so a naive
 * `startsWith` would reject it.
 */
function collidesWithProduction(demoBase: string): boolean {
  const demo = resolveBase(demoBase)
  const production = resolveBase(PRODUCTION_API_BASE)
  // An unresolvable demo base cannot be proven safe.
  if (demo === null || production === null) return true
  if (demo === production) return true

  // Different hosts cannot alias one another.
  const demoUrl = demo.slice(0, demo.length - new URL(demo).pathname.length)
  const productionUrl = production.slice(
    0,
    production.length - new URL(production).pathname.length,
  )
  if (demoUrl !== productionUrl) return false

  const demoPath = new URL(demo).pathname.replace(/\/+$/, '')
  const productionPath = new URL(production).pathname.replace(/\/+$/, '')

  // Containment either way is a collision: demo nested under production would
  // hit real endpoints, and production nested under demo would route real
  // traffic at fixtures.
  const nests = (outer: string, inner: string) =>
    outer !== '' && inner.startsWith(`${outer}/`)
  return nests(productionPath, demoPath) || nests(demoPath, productionPath)
}

/**
 * Resolve demo-mode state from configuration.
 *
 * Pure and injectable so the guard itself is testable: production callers pass
 * nothing and read `import.meta.env`.
 */
export function resolveDemoMode(env?: EnvRecord): DemoModeState {
  const source = readEnv(env)
  const flag = source.VITE_DEMO_MODE

  if (flag === undefined || flag === null || flag === '') {
    return { enabled: false, reason: 'flag_absent' }
  }
  if (flag !== 'true') {
    return { enabled: false, reason: 'flag_not_exact_true' }
  }

  const apiBase = normalizeBase(source.VITE_DEMO_API_BASE)
  if (apiBase === '') {
    return { enabled: false, reason: 'demo_api_base_missing' }
  }
  if (collidesWithProduction(apiBase)) {
    return { enabled: false, reason: 'demo_api_base_collides_with_production' }
  }

  return { enabled: true, apiBase }
}

/** Convenience predicate. False for every configuration that is not complete. */
export function isDemoModeEnabled(env?: EnvRecord): boolean {
  return resolveDemoMode(env).enabled
}

/**
 * Namespace a storage key for demo mode.
 *
 * Throws when called while demo mode is disabled: a demo-namespaced key
 * appearing in a production session would mean the isolation boundary has
 * already been crossed, and silently returning the real key would hide that.
 */
export function demoStorageKey(key: string, env?: EnvRecord): string {
  if (!isDemoModeEnabled(env)) {
    throw new Error('demoStorageKey called while demo mode is disabled')
  }
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('demoStorageKey requires a non-empty key')
  }
  return key.startsWith(DEMO_STORAGE_NAMESPACE) ? key : `${DEMO_STORAGE_NAMESPACE}${key}`
}

/** True when a storage key belongs to the demo namespace. */
export function isDemoStorageKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(DEMO_STORAGE_NAMESPACE)
}

/**
 * Namespace a TanStack Query key so demo responses can never be served from —
 * or written into — the production query cache.
 */
export function demoQueryKey(key: readonly unknown[], env?: EnvRecord): unknown[] {
  if (!isDemoModeEnabled(env)) {
    throw new Error('demoQueryKey called while demo mode is disabled')
  }
  return [DEMO_QUERY_KEY_PREFIX, ...key]
}

/** True when a query key is demo-namespaced. */
export function isDemoQueryKey(key: readonly unknown[]): boolean {
  return Array.isArray(key) && key[0] === DEMO_QUERY_KEY_PREFIX
}

/**
 * Removes every demo-namespaced localStorage value.
 *
 * Safe to call in any mode: it only ever touches keys carrying the demo
 * prefix, so it cannot delete real user state.
 */
export function purgeDemoStorage(): number {
  if (typeof window === 'undefined') return 0
  try {
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && isDemoStorageKey(key)) toRemove.push(key)
    }
    toRemove.forEach((key) => window.localStorage.removeItem(key))
    return toRemove.length
  } catch {
    return 0
  }
}

/**
 * Guard for any code path that produces synthetic data.
 *
 * Call it *before* generating or rendering sample data. It throws when demo
 * mode is not fully configured, which turns "synthetic data leaked into a
 * production session" from a silent data-integrity bug into a loud crash in
 * the one build where it can be noticed.
 */
export function assertDemoModeEnabled(env?: EnvRecord): void {
  const state = resolveDemoMode(env)
  if (!state.enabled) {
    throw new Error(`demo mode is disabled (${state.reason ?? 'unknown'})`)
  }
}

// ─── Request routing ────────────────────────────────────────────────────────

/**
 * The API base every request must go to, or `null` in normal mode.
 *
 * This is the function that makes demo mode mean anything. Without it the
 * validated `apiBase` was computed and thrown away, so a "DEMO DATA" banner
 * sat above real vehicle data pulled from the production API — the single
 * worst outcome available, because it labels true data as synthetic and
 * teaches the user to distrust the banner.
 *
 * Returns `null` for every incompletely-configured state, so the caller's
 * fallback is always the ordinary production path. There is no way for a
 * partially-configured demo build to produce a partially-demo request.
 */
export function getDemoApiBase(env?: EnvRecord): string | null {
  const state = resolveDemoMode(env)
  return state.enabled ? (state.apiBase ?? null) : null
}

/**
 * True when the demo base points at a different origin than the app.
 *
 * Cross-origin demo fixtures are a normal deployment (a static bucket, a
 * public sandbox), and shipping production credentials to them would be a
 * real disclosure. Callers use this to force `credentials: 'omit'` and to
 * drop bearer/sudo headers.
 */
export function isDemoBaseCrossOrigin(env?: EnvRecord): boolean {
  const base = getDemoApiBase(env)
  if (base === null) return false
  if (!/^https?:\/\//i.test(base)) return false
  if (typeof window === 'undefined' || !window.location) return true
  try {
    return new URL(base).origin !== window.location.origin
  } catch {
    // Unparseable absolute base — treat as cross-origin and withhold
    // credentials. Being wrong in this direction costs a failed demo
    // request; being wrong the other way leaks a token.
    return true
  }
}

/** Header names that carry caller identity and must never cross to a demo host. */
const CREDENTIAL_HEADERS = ['authorization', 'x-sudo-token', 'cookie'] as const

/**
 * Strip credential-bearing headers when the request is going to a
 * cross-origin demo base. Returns the input untouched in every other case, so
 * normal-mode requests are byte-identical to before.
 */
export function stripCredentialHeadersForDemo(headers: Headers, env?: EnvRecord): Headers {
  if (!isDemoBaseCrossOrigin(env)) return headers
  for (const name of CREDENTIAL_HEADERS) headers.delete(name)
  return headers
}

/**
 * `credentials` value for an outbound request.
 *
 * `'omit'` for a cross-origin demo base so the browser withholds cookies;
 * `undefined` (the fetch default of `same-origin`) everywhere else.
 */
export function demoCredentialsMode(env?: EnvRecord): RequestCredentials | undefined {
  return isDemoBaseCrossOrigin(env) ? 'omit' : undefined
}
