/**
 * Privacy-safe support bundle (HELP-08).
 *
 * A support bundle is the fastest way to turn "it's broken" into a diagnosis,
 * and the fastest way to leak a customer's data. This module resolves that
 * tension with a construction rule, not a review process:
 *
 *   **The bundle is built by explicit projection, never by spreading.**
 *
 * Nothing reaches the output unless a named field in {@link buildSupportBundle}
 * puts it there. There is no `...rest`, no `Object.assign`, no passthrough of
 * an API response. Adding a field to the bundle requires editing this file,
 * which is exactly where the redaction tests live.
 *
 * On top of that, every free-text value is run through the shared redaction
 * pipeline (`lib/privacy` + `lib/routeTemplate`) as defence in depth, so even
 * a value that *should* be safe — an error message, a service name — cannot
 * smuggle a VIN, an e-mail, a token or a coordinate pair.
 *
 * Explicitly excluded, permanently:
 *   VIN · latitude/longitude · access tokens / refresh tokens / API keys ·
 *   e-mail addresses · usernames · raw console or server logs ·
 *   request/response bodies · saved views · vehicle names
 *
 * Included, deliberately:
 *   app version + release channel · browser capability flags (not the raw
 *   user-agent string) · aggregate health status per service · redacted error
 *   digests · trace IDs (opaque hex identifiers that resolve to a server-side
 *   trace and carry no user data on their own).
 */

import { redactSensitiveText } from './privacy'
import { normalizeRouteTemplate, redactLocationInText } from './routeTemplate'
import { isDemoModeEnabled } from './demoMode'

/** Bumped whenever the emitted shape changes. Consumed by support tooling. */
export const SUPPORT_BUNDLE_SCHEMA_VERSION = 1

/** Hard cap on error digests so a bundle stays reviewable by a human. */
export const MAX_BUNDLE_ERRORS = 10

/** Hard cap on trace IDs. */
export const MAX_BUNDLE_TRACE_IDS = 20

/** Trace/span IDs are lower-case hex of a known width. Anything else is dropped. */
const TRACE_ID_PATTERN = /^[0-9a-f]{16,32}$/

export interface SupportBundleAppInfo {
  version: string
  release_channel: string
  git_sha: string
}

export interface SupportBundleBrowserInfo {
  /** Coarse engine family — never the raw user-agent string. */
  family: string
  /** Major version only. Minor/patch add fingerprinting surface, not signal. */
  major_version: string
  language: string
  /** Required web platform features the browser is missing. */
  missing_features: readonly string[]
  online: boolean
  /** Bucketed viewport — exact pixel size is a weak fingerprint. */
  viewport_bucket: string
  reduced_motion: boolean
}

export interface SupportBundleHealthService {
  name: string
  status: string
}

export interface SupportBundleHealth {
  overall: string
  services: readonly SupportBundleHealthService[]
}

export interface SupportBundleErrorDigest {
  name: string
  message: string
  /** Route TEMPLATE (`/drives/:id`), never the raw pathname. */
  route_template: string
  occurred_at: string
}

export interface SupportBundle {
  schema_version: number
  generated_at: string
  app: SupportBundleAppInfo
  browser: SupportBundleBrowserInfo
  health: SupportBundleHealth
  errors: readonly SupportBundleErrorDigest[]
  trace_ids: readonly string[]
  demo_mode: boolean
}

/** Raw error input — accepts the errorReporter's `FeedbackErrorReport` shape. */
export interface SupportBundleErrorInput {
  name?: string
  message?: string
  route?: string
  occurred_at?: string
}

export interface SupportBundleInput {
  /** Defaults to `new Date().toISOString()`; injected for deterministic tests. */
  generatedAt?: string
  appVersion?: string
  releaseChannel?: string
  gitSha?: string
  userAgent?: string
  language?: string
  missingFeatures?: readonly string[]
  online?: boolean
  viewportWidth?: number
  reducedMotion?: boolean
  healthOverall?: string
  healthServices?: readonly { name?: string; status?: string }[]
  errors?: readonly SupportBundleErrorInput[]
  traceIds?: readonly string[]
  demoMode?: boolean
}

/** Bounded scalar sanitiser: redact, collapse whitespace, truncate. */
function safeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value === '') return ''
  // Order matters: URL/location scrubbing first (a `[REDACTED]` marker injected
  // into a query string would break URL boundary detection), then secrets.
  const scrubbed = redactSensitiveText(redactLocationInText(value))
  return scrubbed.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

/**
 * Reduce a user-agent string to an engine family + major version.
 *
 * The full UA string is a fingerprint and routinely carries enterprise build
 * tags and device model names. Family + major answers every question support
 * actually asks ("does this reproduce on Safari 16?").
 */
export function browserFamily(userAgent: string | undefined): {
  family: string
  major_version: string
} {
  const ua = typeof userAgent === 'string' ? userAgent : ''
  if (ua === '') return { family: 'unknown', major_version: '' }

  // Order matters — Edge and Chrome both claim "Chrome", Chrome claims "Safari".
  const rules: ReadonlyArray<{ family: string; pattern: RegExp }> = [
    { family: 'Edge', pattern: /\bEdg(?:e|A|iOS)?\/(\d+)/ },
    { family: 'Opera', pattern: /\bOPR\/(\d+)/ },
    { family: 'Firefox', pattern: /\bFirefox\/(\d+)/ },
    { family: 'Chrome', pattern: /\bChrome\/(\d+)/ },
    { family: 'Safari', pattern: /\bVersion\/(\d+)[\d.]* Safari\// },
  ]
  for (const rule of rules) {
    const match = rule.pattern.exec(ua)
    if (match) return { family: rule.family, major_version: match[1] ?? '' }
  }
  return { family: 'unknown', major_version: '' }
}

/** Viewport bucket rather than exact pixels. */
export function viewportBucket(width: number | undefined): string {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return 'unknown'
  if (width < 480) return 'xs'
  if (width < 768) return 'sm'
  if (width < 1024) return 'md'
  if (width < 1440) return 'lg'
  return 'xl'
}

/**
 * Keep only well-formed opaque trace identifiers.
 *
 * A trace ID is safe precisely because it is meaningless without the server's
 * trace store. Anything that is not lower-case hex of the expected width is
 * not a trace ID — it is some other string that reached this field by mistake,
 * so it is dropped rather than redacted.
 */
export function sanitizeTraceIds(input: readonly string[] | undefined): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const candidate = raw.trim().toLowerCase()
    if (TRACE_ID_PATTERN.test(candidate)) seen.add(candidate)
    if (seen.size >= MAX_BUNDLE_TRACE_IDS) break
  }
  return [...seen]
}

function toErrorDigest(input: SupportBundleErrorInput): SupportBundleErrorDigest {
  return {
    name: safeText(input?.name, 80) || 'Error',
    message: safeText(input?.message, 300),
    route_template: normalizeRouteTemplate(
      typeof input?.route === 'string' ? input.route : '/',
    ),
    occurred_at: safeText(input?.occurred_at, 40),
  }
}

/**
 * Build the bundle by explicit projection.
 *
 * Every field below is named. There is intentionally no way to pass an
 * arbitrary object through this function.
 */
export function buildSupportBundle(input: SupportBundleInput = {}): SupportBundle {
  const { family, major_version } = browserFamily(input.userAgent)

  return {
    schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
    generated_at: safeText(input.generatedAt, 40) || new Date().toISOString(),
    app: {
      version: safeText(input.appVersion, 40) || 'unknown',
      release_channel: safeText(input.releaseChannel, 20) || 'unknown',
      git_sha: safeText(input.gitSha, 40),
    },
    browser: {
      family,
      major_version,
      language: safeText(input.language, 20),
      missing_features: (input.missingFeatures ?? [])
        .filter((feature): feature is string => typeof feature === 'string')
        .map((feature) => safeText(feature, 40))
        .filter((feature) => feature !== '')
        .slice(0, 20),
      online: input.online !== false,
      viewport_bucket: viewportBucket(input.viewportWidth),
      reduced_motion: input.reducedMotion === true,
    },
    health: {
      overall: safeText(input.healthOverall, 40) || 'unknown',
      services: (input.healthServices ?? [])
        .map((service) => ({
          name: safeText(service?.name, 60),
          status: safeText(service?.status, 40),
        }))
        .filter((service) => service.name !== '')
        .slice(0, 30),
    },
    errors: (input.errors ?? []).slice(-MAX_BUNDLE_ERRORS).map(toErrorDigest),
    trace_ids: sanitizeTraceIds(input.traceIds),
    demo_mode: input.demoMode ?? isDemoModeEnabled(),
  }
}

/** Stable, pretty-printed JSON — what the user copies or downloads. */
export function serializeSupportBundle(bundle: SupportBundle): string {
  return JSON.stringify(bundle, null, 2)
}

/** Deterministic filename. No identifiers, safe to paste into a ticket. */
export function supportBundleFilename(bundle: SupportBundle): string {
  const stamp = (bundle.generated_at || '').replace(/[:.]/g, '-').slice(0, 19)
  return `teslasync-support-${stamp || 'bundle'}.json`
}

/**
 * Patterns that must never appear in a serialised bundle.
 *
 * Exported so both the unit tests and any future bundle-producing code can
 * assert against the same list instead of maintaining a second copy.
 */
export const FORBIDDEN_BUNDLE_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'vin', pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/ },
  { label: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: 'jwt', pattern: /\beyJ[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}/i },
  { label: 'bearer', pattern: /\bBearer\s+[A-Z0-9._~+/=-]{8,}/i },
  {
    label: 'coordinates',
    pattern:
      /\b-?(?:[1-8]?\d(?:\.\d+)?|90(?:\.0+)?)\s*,\s*-?(?:(?:1[0-7]\d|[1-9]?\d)(?:\.\d+)?|180(?:\.0+)?)\b/,
  },
]

/**
 * Returns the labels of every forbidden pattern found in a serialised bundle.
 * Empty array means the bundle is clean.
 */
export function findForbiddenContent(serialized: string): string[] {
  return FORBIDDEN_BUNDLE_PATTERNS.filter((rule) => rule.pattern.test(serialized)).map(
    (rule) => rule.label,
  )
}
