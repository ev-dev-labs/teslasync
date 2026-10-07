import { useTranslation } from 'react-i18next'
import { UserCheck, UserX, ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react'

import { GlassPanel, PanelTitle, Code } from '@/components/ui'
import { KVList, DateTime } from '@/components/data-display'
import { InlineCallout, Skeleton } from '@/components/feedback'
import type { ImpersonationStatus } from '@/api/hooks/useImpersonation'

interface ImpersonationStatusPanelProps {
  status: ImpersonationStatus | undefined
  isLoading: boolean
  /**
   * Surfaced when the status query fails. Optional so existing callers
   * keep compiling. When set while a last-good `status` is still present
   * the panel keeps rendering that state rather than masking it — a
   * transient background-refetch failure must not lie to an admin by
   * flipping a live "active" session to "not impersonating".
   */
  isError?: boolean
}

/**
 * Live session-status side panel. Mirrors the three discriminated states of
 * the impersonation status hook (open / active / inactive) and, when active,
 * surfaces the original admin, the impersonated subject, and the cookie
 * expiry — read straight from the API and formatted at the display boundary.
 */
export function ImpersonationStatusPanel({
  status,
  isLoading,
  isError = false,
}: ImpersonationStatusPanelProps) {
  const { t } = useTranslation()

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('impersonation.status.title', 'Session Status')}
      </PanelTitle>

      {isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('impersonation.status.loading', 'Loading session status…')}
          data-testid="impersonation-status-loading"
        >
          <Skeleton height={140} />
        </div>
      ) : isError && !status ? (
        <InlineCallout
          variant="danger"
          icon={<AlertTriangle />}
          testId="impersonation-status-error"
        >
          {t(
            'impersonation.status.error',
            'Session status is unavailable right now. Use the refresh control above to try again.',
          )}
        </InlineCallout>
      ) : status?.mode === 'open' ? (
        <InlineCallout variant="warning" icon={<ShieldAlert />} testId="impersonation-status-open">
          {t(
            'impersonation.status.open',
            'Forward-auth is disabled, so impersonation is unavailable on this install.',
          )}
        </InlineCallout>
      ) : status?.mode === 'active' ? (
        <div className="space-y-4">
          <InlineCallout
            variant="success"
            icon={<UserCheck />}
            testId="impersonation-status-active"
          >
            {t(
              'impersonation.status.activeCallout',
              'Impersonation is active. End it from the banner at the top of the screen.',
            )}
          </InlineCallout>
          <KVList
            items={[
              {
                label: t('impersonation.status.originalAdmin', 'Original admin'),
                value: <Code className="break-all">{status.original_admin || '—'}</Code>,
              },
              {
                label: t('impersonation.status.target', 'Target subject'),
                value: <Code className="break-all">{status.target || '—'}</Code>,
              },
              {
                label: t('impersonation.status.expires', 'Expires'),
                value: <DateTime value={status.expires_at} variant="full" />,
              },
            ]}
          />
        </div>
      ) : (
        <InlineCallout variant="info" icon={<UserX />} testId="impersonation-status-inactive">
          {t(
            'impersonation.status.inactive',
            'You are not impersonating anyone. Pick a subject from the table to start a support session.',
          )}
        </InlineCallout>
      )}
    </GlassPanel>
  )
}
