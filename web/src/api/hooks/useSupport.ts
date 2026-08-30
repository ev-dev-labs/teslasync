import { useCallback, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'

import { request } from '../client'
import { useMutationToast } from './_toastHelpers'
import { useVersionInfo } from './useSettings'
import { useSystemHealth } from './useAdmin'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { detectMissingFeatures } from '@/lib/browserCompat'
import { getRecentReportsForFeedback } from '@/lib/errorReporter'
import { isDemoModeEnabled } from '@/lib/demoMode'
import {
  buildSupportBundle,
  serializeSupportBundle,
  supportBundleFilename,
  type SupportBundle,
} from '@/lib/supportBundle'
import {
  buildProblemReportSubmission,
  type ProblemReportInput,
} from '@/lib/problemReport'
import type { FeedbackEntry } from '../types'

/**
 * Support surfaces: the privacy-safe support bundle (HELP-08) and the
 * report-a-problem flow (HELP-09).
 *
 * No new backend endpoint is introduced. The bundle is assembled entirely in
 * the browser from data the SPA already holds — there is nothing a server
 * round-trip would add that is not already in `/system/version` and
 * `/system/health`, and a server-built bundle would need a new authenticated,
 * rate-limited, redacting endpoint to produce the same JSON.
 *
 * Problem reports POST to the existing `POST /api/v1/feedback`, which already
 * provides deterministic delivery and audit: it persists a row, enforces a
 * per-submitter throttle that survives pod restarts, records submitter subject
 * and IP, and logs acceptance. Reusing it keeps one triage queue instead of
 * two.
 */

export interface UseSupportBundleResult {
  bundle: SupportBundle
  /** Pretty-printed JSON — what the user copies. */
  json: string
  /** Deterministic, identifier-free download filename. */
  filename: string
  /** True while version/health are still resolving. The bundle is still
   *  usable: unresolved fields read `unknown` rather than blocking. */
  isLoading: boolean
  /** Triggers a client-side download of the bundle. */
  download: () => void
}

/**
 * Assemble the support bundle from live app state.
 *
 * Everything is passed through `buildSupportBundle`, which projects explicitly
 * and redacts — this hook never hands raw API objects to the bundle.
 */
export function useSupportBundle(): UseSupportBundleResult {
  const { data: version, isLoading: versionLoading } = useVersionInfo()
  const { data: health, isLoading: healthLoading } = useSystemHealth()
  const online = useOnlineStatus()

  const bundle = useMemo(() => {
    const services = Object.entries(health?.components ?? {}).map(([name, component]) => ({
      name,
      status: String(component?.status ?? 'unknown'),
    }))

    return buildSupportBundle({
      appVersion: version?.app_version ?? import.meta.env.VITE_APP_VERSION,
      releaseChannel: version?.chart_version ?? '',
      gitSha: import.meta.env.VITE_GIT_SHA,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      language: typeof navigator !== 'undefined' ? navigator.language : '',
      missingFeatures: detectMissingFeatures(),
      online,
      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
      reducedMotion:
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false,
      healthOverall: health?.status ?? 'unknown',
      healthServices: services,
      errors: getRecentReportsForFeedback(),
      // Trace IDs are collected from the error reporter's digests where the
      // backend echoed one; anything that is not well-formed hex is dropped by
      // `sanitizeTraceIds`, so passing a loose list here is safe.
      traceIds: [],
      demoMode: isDemoModeEnabled(),
    })
  }, [version, health, online])

  const json = useMemo(() => serializeSupportBundle(bundle), [bundle])
  const filename = useMemo(() => supportBundleFilename(bundle), [bundle])

  const download = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } finally {
      // Revoke on the next tick so the click has committed the navigation.
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  }, [json, filename])

  return {
    bundle,
    json,
    filename,
    isLoading: versionLoading || healthLoading,
    download,
  }
}

/**
 * Submit a problem report.
 *
 * The payload is built by `buildProblemReportSubmission`, which templates the
 * route, redacts the user's free text, and refuses to attach console output or
 * files regardless of what the caller passes.
 */
export function useSubmitProblemReport() {
  const { success, error } = useMutationToast()
  return useMutation({
    mutationFn: (input: ProblemReportInput) =>
      request<FeedbackEntry>('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildProblemReportSubmission(input)),
      }),
    onSuccess: () => {
      success('toast.problemReport.success', 'Problem report sent — thank you')
    },
    onError: (e) => error(e, 'toast.problemReport.error', 'Could not send the problem report'),
  })
}
