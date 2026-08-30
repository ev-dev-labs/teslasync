/**
 * Onboarding completion state (HELP-08 correction round).
 *
 * ## The bug this fixes
 *
 * `teslasync-onboarded` had exactly one writer — `<OnboardingWizard>` — and
 * that component is not mounted anywhere. The wizard was superseded by the
 * `/onboarding` route + `<OnboardingGate>` flow, but the completion write went
 * with it, so the key was never set on any install.
 *
 * `useChangelog().hasCompletedOnboarding` reads that key to decide whether a
 * user is established enough to be shown "what's new". With the key
 * permanently absent, that gate was permanently closed and the changelog
 * auto-show could never fire for anyone. A dead component silently disabled a
 * live feature two modules away.
 *
 * ## The fix
 *
 * Completion is written by the surface that actually owns it: the onboarding
 * status contract (`useOnboardingStatus`), observed by `<OnboardingGate>`
 * which is already mounted globally and already runs that query. No extra
 * request, no new mount point.
 *
 * ## Semantics
 *
 * - **Versioned.** The payload records `version`, so a future onboarding
 *   revision can re-prompt without a migration by bumping
 *   `ONBOARDING_COMPLETION_VERSION`.
 * - **Idempotent.** Writing twice at the same version is a no-op and returns
 *   `false`, so the effect that calls it can run on every status refetch.
 * - **Backwards compatible.** The legacy key name is retained and the value is
 *   still a non-empty string, so the existing `getItem(...) != null` readers
 *   (`useChangelog`) and any pre-existing `'true'` value keep working.
 */

/** Legacy key name, deliberately unchanged so existing readers keep working. */
export const ONBOARDING_COMPLETION_KEY = 'teslasync-onboarded'

/** Bump to re-prompt after a materially different onboarding flow. */
export const ONBOARDING_COMPLETION_VERSION = 1

/** Where the completion came from, for support/debugging only. */
export type OnboardingCompletionSource = 'setup-complete' | 'skipped' | 'wizard'

export interface OnboardingCompletion {
  version: number
  /** ISO timestamp of the first write at this version. */
  at: string
  source: OnboardingCompletionSource
}

function readRaw(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ONBOARDING_COMPLETION_KEY)
  } catch {
    return null
  }
}

/**
 * Parse the stored value.
 *
 * Handles three shapes on purpose: the versioned JSON this module writes, the
 * legacy literal `'true'` written by the old wizard, and anything else (which
 * is treated as a legacy truthy marker rather than discarded — a user who
 * completed onboarding must not be re-prompted because the format changed).
 */
export function getOnboardingCompletion(): OnboardingCompletion | null {
  const raw = readRaw()
  if (raw == null || raw === '') return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as OnboardingCompletion).version === 'number'
    ) {
      const value = parsed as OnboardingCompletion
      return {
        version: value.version,
        at: typeof value.at === 'string' ? value.at : '',
        source: value.source ?? 'wizard',
      }
    }
  } catch {
    // Not JSON — fall through to the legacy interpretation below.
  }

  // Legacy `'true'` (or any other non-empty marker) from the old wizard.
  return { version: 1, at: '', source: 'wizard' }
}

/** True when onboarding has been completed at the CURRENT version. */
export function isOnboardingCompleted(): boolean {
  const completion = getOnboardingCompletion()
  return completion !== null && completion.version >= ONBOARDING_COMPLETION_VERSION
}

/**
 * Record completion. Returns true only when this call actually wrote —
 * callers use that to decide whether to broadcast to peer tabs.
 */
export function markOnboardingCompleted(
  source: OnboardingCompletionSource,
  now: () => string = () => new Date().toISOString(),
): boolean {
  if (typeof window === 'undefined') return false
  if (isOnboardingCompleted()) return false

  const payload: OnboardingCompletion = {
    version: ONBOARDING_COMPLETION_VERSION,
    at: now(),
    source,
  }
  try {
    window.localStorage.setItem(ONBOARDING_COMPLETION_KEY, JSON.stringify(payload))
    return true
  } catch {
    // Storage disabled (private mode / hardened browser). Non-fatal: the next
    // visit re-evaluates from the server-backed status contract anyway.
    return false
  }
}

/** Test seam. */
export function __resetOnboardingCompletionForTests(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(ONBOARDING_COMPLETION_KEY)
  } catch {
    /* non-fatal */
  }
}
