/**
 * FrontendErrorsCard — last-hour rolling summary of browser-reported
 * frontend errors (the same data that backed the now-deleted /admin
 * page's "Frontend Errors" panel).
 *
 * Surfaces the total error count plus top offenders (component + route
 * + count) so operators can immediately see whether the SPA is
 * misbehaving without having to leave /system-status.
 *
 * Pulls from `useWebErrorsSummary()` which talks to
 * `GET /admin/web-errors/summary`. Renders inside the existing
 * "Recent errors" accordion as a sibling of the backend error list.
 */

import { Bug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui'
import { Skeleton } from '@/components/feedback/Skeleton'
import { fmtInt } from '@/lib/numberFormat'
import { useWebErrorsSummary } from '@/api/hooks/useAdmin'

export function FrontendErrorsCard() {
  const { t } = useTranslation()
  const { data, isLoading } = useWebErrorsSummary()

  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t('Loading frontend error summary')}
        className="space-y-2 mt-4"
      >
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
      </div>
    )
  }

  if (!data) {
    return (
      <div role="status" className="mt-4 text-xs text-[var(--text-muted)]">
        {t('Unable to load frontend error summary.')}
      </div>
    )
  }

  const total = data.total ?? 0
  // Guard against a null / malformed `top` payload — the hook returns the raw
  // summary object without a `safeArray` select, so a partial backend response
  // (or a camelCaseKeys quirk) could leave `top` non-iterable.
  const top = Array.isArray(data.top) ? data.top : []
  const heading = t('Frontend errors (last hour)')

  return (
    <section
      aria-label={heading}
      className="mt-4 rounded-md bg-white/[0.02] p-3 ring-1 ring-white/[0.05]"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
        <Bug aria-hidden="true" className="h-3.5 w-3.5" />
        <span>{heading}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
          {fmtInt(total)}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {t('reported by browser sessions')}
        </span>
      </div>

      {top.length > 0 ? (
        <ul className="mt-3 divide-y divide-white/[0.04]">
          {top.map((entry, idx) => (
            <li
              key={`${entry.name}|${entry.route}|${idx}`}
              className="flex items-center justify-between gap-2 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant="neutral" size="sm">{entry.name || '—'}</Badge>
                <span className="truncate font-mono text-xs text-cyan-300">
                  {entry.route || '—'}
                </span>
              </div>
              <span className="shrink-0 tabular-nums text-xs text-[var(--text-primary)]">
                {fmtInt(entry.count ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      ) : total > 0 ? (
        // Non-zero total but no per-source rows: don't claim "no errors" — that
        // contradicts the count rendered above. Surface the honest state instead.
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t('No per-source breakdown available for the reported errors.')}
        </p>
      ) : (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t('No frontend errors reported in the last hour.')}
        </p>
      )}
    </section>
  )
}
