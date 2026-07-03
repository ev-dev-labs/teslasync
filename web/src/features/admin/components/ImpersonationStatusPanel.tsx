import { useTranslation } from 'react-i18next'
import { UserCheck, UserX, ShieldAlert, ShieldCheck } from 'lucide-react'

import { GlassPanel, PanelTitle, Code } from '@/components/ui'
import { KVList, DateTime } from '@/components/data-display'
import { InlineCallout, Skeleton } from '@/components/feedback'
import type { ImpersonationStatus } from '@/api/hooks/useImpersonation'

interface ImpersonationStatusPanelProps {
  status: ImpersonationStatus | undefined
  isLoading: boolean
}

/**
 * Live session-status side panel. Mirrors the three discriminated states of
 * the impersonation status hook (open / active / inactive) and, when active,
 * surfaces the original admin, the impersonated subject, and the cookie
 * expiry — read straight from the API and formatted at the display boundary.
 */
export function ImpersonationStatusPanel({ status, isLoading }: ImpersonationStatusPanelProps) {
  const { t } = useTranslation()

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('impersonation.status.title', 'Session Status')}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={140} />
      ) : status?.mode === 'open' ? (
        <InlineCallout variant="warning" icon={<ShieldAlert />}>
          {t(
            'impersonation.status.open',
            'Forward-auth is disabled, so impersonation is unavailable on this install.',
          )}
        </InlineCallout>
      ) : status?.mode === 'active' ? (
        <div className="space-y-4">
          <InlineCallout variant="success" icon={<UserCheck />}>
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
        <InlineCallout variant="info" icon={<UserX />}>
          {t(
            'impersonation.status.inactive',
            'You are not impersonating anyone. Pick a subject from the table to start a support session.',
          )}
        </InlineCallout>
      )}
    </GlassPanel>
  )
}
