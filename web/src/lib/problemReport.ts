/**
 * Report-a-problem from the current page (HELP-09).
 *
 * The goal is a report that is actually diagnosable without turning the
 * report itself into a data-leak vector. Three rules do the work:
 *
 *  1. **Route template, never the raw path.** `/s/share-token-abc` and
 *     `/drives/91827` both identify a user or a record. The submission carries
 *     `/s/:id` and `/drives/:id`, which are equally useful for reproduction
 *     and carry nothing.
 *  2. **Diagnostics are opt-in and shown before sending.** The user sees the
 *     exact JSON that will be attached. Consent is a positive act; the default
 *     is off.
 *  3. **A closed attachment policy.** No files, no screenshots, no console
 *     tail, no server logs — ever, at any consent level. Those are the four
 *     channels through which raw customer data historically escapes, and the
 *     redacted support bundle already answers the questions they would.
 *
 * Delivery is deterministic and audited: the submission goes to the existing
 * `POST /api/v1/feedback` endpoint, which persists a row, enforces a
 * per-submitter throttle, records submitter + IP, and logs the acceptance.
 * There is no fire-and-forget path.
 */

import type { FeedbackSubmitInput } from '@/api/types'
import { redactSensitiveText } from './privacy'
import { normalizeRouteTemplate } from './routeTemplate'
import {
  serializeSupportBundle,
  type SupportBundle,
  type SupportBundleErrorDigest,
} from './supportBundle'

/** Mirrors the server-side validation in `internal/api/feedback`. */
export const PROBLEM_REPORT_LIMITS = {
  titleMin: 5,
  titleMax: 120,
  descriptionMin: 20,
  descriptionMax: 4000,
} as const

/**
 * The attachment policy, as data.
 *
 * Exported so the UI renders the policy from the same constant the builder
 * enforces — a policy that is only written in prose is a policy that drifts.
 */
export const ATTACHMENT_POLICY = {
  /** Redacted diagnostics summary — attached only with explicit consent. */
  supportBundle: 'opt-in',
  /** Never attached, at any consent level. */
  consoleTail: 'never',
  files: 'never',
  screenshots: 'never',
  serverLogs: 'never',
  userEmail: 'never',
} as const

export type ProblemReportValidationError =
  | 'title_too_short'
  | 'title_too_long'
  | 'description_too_short'
  | 'description_too_long'

export interface ProblemReportInput {
  /** One-line summary. */
  title: string
  /** The user's own description of what went wrong. */
  description: string
  /** Raw router pathname — templated before it leaves the browser. */
  pathname: string
  /** Explicit consent to attach the redacted diagnostics summary. */
  includeDiagnostics: boolean
  /** The redacted support bundle. Ignored unless consent is given. */
  bundle?: SupportBundle | null
  appVersion?: string
  /** Browser family string from the bundle — never the raw user-agent. */
  browserSummary?: string
}

export interface ProblemReportValidation {
  valid: boolean
  errors: ProblemReportValidationError[]
}

/**
 * Client-side validation mirroring the server's rules so the user gets an
 * inline message instead of a 400. The server remains authoritative.
 */
export function validateProblemReport(input: ProblemReportInput): ProblemReportValidation {
  const errors: ProblemReportValidationError[] = []
  const title = (input?.title ?? '').trim()
  const description = (input?.description ?? '').trim()

  if (title.length < PROBLEM_REPORT_LIMITS.titleMin) errors.push('title_too_short')
  else if (title.length > PROBLEM_REPORT_LIMITS.titleMax) errors.push('title_too_long')

  if (description.length < PROBLEM_REPORT_LIMITS.descriptionMin) {
    errors.push('description_too_short')
  } else if (description.length > PROBLEM_REPORT_LIMITS.descriptionMax) {
    errors.push('description_too_long')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * The diagnostics payload attached under consent.
 *
 * A projection of the support bundle, not the bundle itself: the feedback
 * column is a JSONB blob that ends up in an admin queue, so it carries only
 * what a triager reads — versions, capability, health, error digests, trace
 * IDs.
 */
export interface ProblemReportDiagnostics {
  schema_version: number
  app_version: string
  release_channel: string
  browser: string
  browser_online: boolean
  missing_features: readonly string[]
  health_overall: string
  degraded_services: readonly string[]
  errors: readonly SupportBundleErrorDigest[]
  trace_ids: readonly string[]
  demo_mode: boolean
}

/** True for any health status that is not a clean pass. */
function isDegraded(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized !== '' && normalized !== 'ok' && normalized !== 'healthy' && normalized !== 'up'
}

export function buildProblemReportDiagnostics(
  bundle: SupportBundle,
): ProblemReportDiagnostics {
  return {
    schema_version: bundle.schema_version,
    app_version: bundle.app.version,
    release_channel: bundle.app.release_channel,
    browser: `${bundle.browser.family} ${bundle.browser.major_version}`.trim(),
    browser_online: bundle.browser.online,
    missing_features: bundle.browser.missing_features,
    health_overall: bundle.health.overall,
    degraded_services: bundle.health.services
      .filter((service) => isDegraded(service.status))
      .map((service) => `${service.name}:${service.status}`),
    errors: bundle.errors,
    trace_ids: bundle.trace_ids,
    demo_mode: bundle.demo_mode,
  }
}

/**
 * Build the wire submission for `POST /api/v1/feedback`.
 *
 * The endpoint rejects unknown JSON fields (`DisallowUnknownFields`), so this
 * emits exactly the accepted keys. `console_tail` and `user_email` are never
 * populated — see {@link ATTACHMENT_POLICY}.
 */
export function buildProblemReportSubmission(
  input: ProblemReportInput,
): FeedbackSubmitInput {
  const routeTemplate = normalizeRouteTemplate(input?.pathname ?? '/')

  // The user's own words are redacted too. People paste bearer tokens, VINs
  // and share links into bug reports constantly; the report lands in an admin
  // queue, so stripping credentials protects the reporter, not us.
  const title = redactSensitiveText((input?.title ?? '').trim()).slice(
    0,
    PROBLEM_REPORT_LIMITS.titleMax,
  )
  const description = redactSensitiveText((input?.description ?? '').trim()).slice(
    0,
    PROBLEM_REPORT_LIMITS.descriptionMax,
  )

  const submission: FeedbackSubmitInput = {
    category: 'bug',
    title,
    body: description,
    page_route: routeTemplate,
    app_version: input?.appVersion ?? '',
    // Coarse browser summary only. The raw navigator.userAgent is a
    // fingerprint and adds nothing a triager uses.
    user_agent: input?.browserSummary ?? '',
  }

  if (input?.includeDiagnostics && input.bundle) {
    submission.recent_errors = buildProblemReportDiagnostics(input.bundle)
  }

  return submission
}

/**
 * Human-readable preview of exactly what will be transmitted.
 *
 * Rendered in the modal before submit so consent is informed rather than
 * assumed. Built from the same submission object that is POSTed — never a
 * separately-composed "example".
 */
export function previewProblemReport(input: ProblemReportInput): string {
  return JSON.stringify(buildProblemReportSubmission(input), null, 2)
}

/** Convenience for the "copy full diagnostics" affordance in the modal. */
export function previewDiagnostics(bundle: SupportBundle | null | undefined): string {
  return bundle ? serializeSupportBundle(bundle) : ''
}
