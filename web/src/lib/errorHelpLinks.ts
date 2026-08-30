/**
 * From an error to the place that can actually resolve it (HELP-05).
 *
 * A classified error tells the user *what* failed. It does not tell them
 * where to go next, so every failure ends in the same dead end: retry, then
 * open a support ticket. This module attaches the relevant destinations to
 * each error kind, drawn from four families:
 *
 *   status      — is this a known incident, or just me?
 *   config      — is this a setting on this install?
 *   diagnostics — what does the pipeline actually say?
 *   runbook     — the written procedure for operators.
 *
 * Two rules keep this honest:
 *  1. **No dead links.** In-app targets are canonical routes (pinned against
 *     ROUTE_REGISTRY by the test). Runbooks live in the repository, not in the
 *     SPA, so they are emitted ONLY when a docs base URL is configured —
 *     otherwise they are omitted rather than rendered as a 404.
 *  2. **Ranked, not exhaustive.** Links are ordered most-likely-to-help first
 *     and capped, because a wall of eight links is the same dead end with
 *     extra steps.
 */

import type { ErrorKind } from './errorClassification'

export type HelpLinkKind = 'status' | 'config' | 'diagnostics' | 'runbook'

export interface ErrorHelpLink {
  id: string
  kind: HelpLinkKind
  labelKey: string
  labelFallback: string
  /** In-app canonical route. Mutually exclusive with {@link href}. */
  to?: string
  /** Absolute external URL (runbooks only). */
  href?: string
  /** Why this destination is relevant to this failure. */
  reasonKey: string
  reasonFallback: string
}

/** Repository-relative runbook paths, resolved against the docs base URL. */
interface RunbookRef {
  id: string
  path: string
  labelKey: string
  labelFallback: string
  reasonKey: string
  reasonFallback: string
}

const SYSTEM_STATUS: ErrorHelpLink = {
  id: 'system-status',
  kind: 'status',
  labelKey: 'errorHelp.links.systemStatus.label',
  labelFallback: 'System status',
  to: '/system-status',
  reasonKey: 'errorHelp.links.systemStatus.reason',
  reasonFallback: 'Shows whether a dependency is already known to be degraded.',
}

const SETTINGS: ErrorHelpLink = {
  id: 'settings',
  kind: 'config',
  labelKey: 'errorHelp.links.settings.label',
  labelFallback: 'Settings',
  to: '/settings',
  reasonKey: 'errorHelp.links.settings.reason',
  reasonFallback: 'Most access, unit and integration behaviour is configured here.',
}

const INGEST_XRAY: ErrorHelpLink = {
  id: 'ingest-xray',
  kind: 'diagnostics',
  labelKey: 'errorHelp.links.ingestXray.label',
  labelFallback: 'Ingest X-Ray',
  to: '/admin/ingest-xray',
  reasonKey: 'errorHelp.links.ingestXray.reason',
  reasonFallback: 'Traces a payload through the ingest pipeline to find where it stopped.',
}

const AUDIT_LOG: ErrorHelpLink = {
  id: 'audit-log',
  kind: 'diagnostics',
  labelKey: 'errorHelp.links.auditLog.label',
  labelFallback: 'Audit log',
  to: '/admin/audit-log',
  reasonKey: 'errorHelp.links.auditLog.reason',
  reasonFallback: 'Records who changed access and configuration, and when.',
}

const HELP_INDEX: ErrorHelpLink = {
  id: 'help',
  kind: 'config',
  labelKey: 'errorHelp.links.help.label',
  labelFallback: 'Help & support',
  to: '/help',
  reasonKey: 'errorHelp.links.help.reason',
  reasonFallback: 'Search the help index, or send a problem report with diagnostics attached.',
}

const ONBOARDING: ErrorHelpLink = {
  id: 'onboarding',
  kind: 'config',
  labelKey: 'errorHelp.links.onboarding.label',
  labelFallback: 'Setup',
  to: '/onboarding',
  reasonKey: 'errorHelp.links.onboarding.reason',
  reasonFallback: 'Re-runs the connection steps, including Tesla account authorisation.',
}

const STATUS_API_DOCS: ErrorHelpLink = {
  id: 'status-api-docs',
  kind: 'diagnostics',
  labelKey: 'errorHelp.links.statusApiDocs.label',
  labelFallback: 'Status API reference',
  to: '/docs/status-api',
  reasonKey: 'errorHelp.links.statusApiDocs.reason',
  reasonFallback: 'Documents the health endpoints and what each status value means.',
}

const RUNBOOK_BURN_ALERT: RunbookRef = {
  id: 'runbook-burn-alert',
  path: 'docs/runbooks/phase-44-respond-to-burn-alert.md',
  labelKey: 'errorHelp.links.runbookBurnAlert.label',
  labelFallback: 'Runbook: respond to a burn alert',
  reasonKey: 'errorHelp.links.runbookBurnAlert.reason',
  reasonFallback: 'Operator procedure when a service is burning its error budget.',
}

const RUNBOOK_TRACE: RunbookRef = {
  id: 'runbook-trace',
  path: 'docs/runbooks/phase-44-debug-from-trace.md',
  labelKey: 'errorHelp.links.runbookTrace.label',
  labelFallback: 'Runbook: debug from a trace ID',
  reasonKey: 'errorHelp.links.runbookTrace.reason',
  reasonFallback: 'Turns the trace IDs in a support bundle into a root cause.',
}

const RUNBOOK_TELEMETRY: RunbookRef = {
  id: 'runbook-telemetry',
  path: 'docs/runbooks/fleet-telemetry-resubscribe.md',
  labelKey: 'errorHelp.links.runbookTelemetry.label',
  labelFallback: 'Runbook: re-subscribe fleet telemetry',
  reasonKey: 'errorHelp.links.runbookTelemetry.reason',
  reasonFallback: 'Recovers a vehicle that stopped streaming telemetry.',
}

const RUNBOOK_SECURITY: RunbookRef = {
  id: 'runbook-security',
  path: 'docs/runbooks/security-boundary-hardening.md',
  labelKey: 'errorHelp.links.runbookSecurity.label',
  labelFallback: 'Runbook: security boundaries',
  reasonKey: 'errorHelp.links.runbookSecurity.reason',
  reasonFallback: 'Explains how authentication and authorisation boundaries are enforced.',
}

/**
 * Per-kind destinations, ranked. `runbooks` are appended only when a docs
 * base URL is configured.
 */
const LINKS_BY_KIND: Record<ErrorKind, { links: ErrorHelpLink[]; runbooks: RunbookRef[] }> = {
  waiting: { links: [SYSTEM_STATUS], runbooks: [] },
  not_found: { links: [HELP_INDEX], runbooks: [] },
  unauthorized: { links: [SETTINGS, HELP_INDEX], runbooks: [RUNBOOK_SECURITY] },
  forbidden: { links: [HELP_INDEX, AUDIT_LOG, SETTINGS], runbooks: [RUNBOOK_SECURITY] },
  timed_out: { links: [SYSTEM_STATUS, INGEST_XRAY], runbooks: [RUNBOOK_TRACE] },
  unsupported: { links: [SETTINGS, STATUS_API_DOCS, HELP_INDEX], runbooks: [] },
  unavailable: {
    links: [SYSTEM_STATUS, STATUS_API_DOCS, INGEST_XRAY],
    runbooks: [RUNBOOK_BURN_ALERT],
  },
  server: { links: [SYSTEM_STATUS, HELP_INDEX], runbooks: [RUNBOOK_TRACE] },
  request: { links: [HELP_INDEX], runbooks: [] },
  offline: { links: [SYSTEM_STATUS], runbooks: [] },
  network: { links: [SYSTEM_STATUS, ONBOARDING], runbooks: [RUNBOOK_TELEMETRY] },
}

/** Hard cap so an error card never becomes a link farm. */
export const MAX_ERROR_HELP_LINKS = 4

type EnvRecord = Record<string, string | undefined>

/**
 * Read the docs base URL without widening `ImportMetaEnv`.
 *
 * Runbooks are markdown in the repository, not routes in the SPA, so there is
 * no safe default: an unconfigured install must render no runbook link at all
 * rather than a guessed URL.
 */
export function resolveDocsBaseUrl(env?: EnvRecord): string | null {
  const source: EnvRecord =
    env ??
    ((typeof import.meta !== 'undefined'
      ? (import.meta.env as unknown as EnvRecord)
      : {}) as EnvRecord)
  const raw = source.VITE_DOCS_BASE_URL
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (trimmed === '') return null
  // Only absolute http(s) bases — a relative value would resolve against the
  // SPA origin and produce a 404 inside the app shell.
  if (!/^https?:\/\//i.test(trimmed)) return null
  return trimmed
}

function toRunbookLink(ref: RunbookRef, base: string): ErrorHelpLink {
  return {
    id: ref.id,
    kind: 'runbook',
    labelKey: ref.labelKey,
    labelFallback: ref.labelFallback,
    href: `${base}/${ref.path}`,
    reasonKey: ref.reasonKey,
    reasonFallback: ref.reasonFallback,
  }
}

/**
 * Destinations relevant to a classified error, ranked and capped.
 *
 * Pure: the only ambient input is the docs base URL, which callers can inject
 * for tests.
 */
export function helpLinksForError(
  kind: ErrorKind,
  options: { env?: EnvRecord; docsBaseUrl?: string | null } = {},
): ErrorHelpLink[] {
  const entry = LINKS_BY_KIND[kind]
  if (!entry) return []
  const base =
    options.docsBaseUrl !== undefined
      ? options.docsBaseUrl
      : resolveDocsBaseUrl(options.env)

  const runbookLinks = base ? entry.runbooks.map((ref) => toRunbookLink(ref, base)) : []
  return [...entry.links, ...runbookLinks].slice(0, MAX_ERROR_HELP_LINKS)
}

/** Every in-app route this module can emit — used by the governance test. */
export function listErrorHelpRoutes(): string[] {
  const routes = new Set<string>()
  for (const entry of Object.values(LINKS_BY_KIND)) {
    for (const link of entry.links) {
      if (link.to) routes.add(link.to)
    }
  }
  return [...routes].sort()
}

/** Every repository-relative runbook path — used by the governance test. */
export function listRunbookPaths(): string[] {
  const paths = new Set<string>()
  for (const entry of Object.values(LINKS_BY_KIND)) {
    for (const ref of entry.runbooks) paths.add(ref.path)
  }
  return [...paths].sort()
}
