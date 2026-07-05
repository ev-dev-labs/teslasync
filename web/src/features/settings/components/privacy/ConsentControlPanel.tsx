import { useTranslation } from 'react-i18next'
import { Cookie, RotateCw } from 'lucide-react'

import { GlassPanel, IconBox, Button, PanelTitle, Text, StatusPill } from '@/components/ui'
import { Skeleton } from '@/components/feedback'
import type { ConsentState } from '@/lib/cookieConsent'

import { describeConsent } from './consentMeta'

interface ConsentControlPanelProps {
  /** Current stored consent decision. */
  consent: ConsentState
  /** Deployment-wide `require_cookie_consent` flag from `/system/version`. */
  requireConsent: boolean
  /** `/system/version` load state — only the policy copy depends on it. */
  isLoading: boolean
  isError: boolean
  onRetry?: () => void
  onAccept: () => void
  onDecline: () => void
  onReset: () => void
}

/**
 * Cookie / GDPR consent control. Always rendered (even where the deployment-wide
 * `require_cookie_consent` flag is off) so operators can preview the user-facing
 * flow. The consent decision itself is browser-local, so the accept / withdraw /
 * reset controls stay usable regardless of the `/system/version` fetch — only
 * the descriptive policy copy shows a loading / retry affordance.
 */
export function ConsentControlPanel({
  consent,
  requireConsent,
  isLoading,
  isError,
  onRetry,
  onAccept,
  onDecline,
  onReset,
}: ConsentControlPanelProps) {
  const { t } = useTranslation()
  const cp = describeConsent(consent, t)

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="privacy-consent-section">
      <div className="flex items-start gap-3">
        <IconBox color="amber">
          <Cookie className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div className="min-w-0 flex-1 space-y-1">
          <PanelTitle>{t('consent.section.title', 'Cookies & analytics consent')}</PanelTitle>

          {isLoading ? (
            <Skeleton height={32} className="max-w-prose" />
          ) : isError ? (
            <div className="flex flex-wrap items-center gap-2">
              <Text as="p" variant="caption">
                {t(
                  'account.privacy.consent.policyError',
                  'Deployment consent policy unavailable — you can still manage your own choice below.',
                )}
              </Text>
              {onRetry && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRetry}
                  icon={<RotateCw className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  {t('common.retry', 'Retry')}
                </Button>
              )}
            </div>
          ) : (
            <Text as="p" variant="caption" className="max-w-prose">
              {requireConsent
                ? t(
                    'consent.section.bodyOn',
                    'This deployment collects anonymous performance and error reports with your consent. Strictly necessary storage (auth, settings) is always on.',
                  )
                : t(
                    'consent.section.bodyOff',
                    'This deployment does not require consent collection — these controls let you preview the user-facing flow.',
                  )}
            </Text>
          )}
        </div>
      </div>

      <div
        role="status"
        className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4"
        data-testid="privacy-consent-state"
        data-consent-state={consent}
      >
        <StatusPill color={cp.dot}>{cp.short}</StatusPill>
        <Text as="span" variant="caption">
          {cp.detail}
        </Text>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={onAccept}
          disabled={consent === 'accepted'}
          data-testid="privacy-consent-accept"
        >
          {t('consent.action.accept', 'Re-grant consent')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onDecline}
          disabled={consent === 'declined'}
          data-testid="privacy-consent-decline"
        >
          {t('consent.action.decline', 'Withdraw consent')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={consent === 'unknown'}
          data-testid="privacy-consent-reset"
        >
          {t('consent.action.reset', 'Reset')}
        </Button>
      </div>
    </GlassPanel>
  )
}

export default ConsentControlPanel
