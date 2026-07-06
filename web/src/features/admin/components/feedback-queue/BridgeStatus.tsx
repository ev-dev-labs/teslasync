import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Caption, Code, Label, Text } from '@/components/ui'
import { Skeleton } from '@/components/feedback'
import { Icons } from '@/lib/icons'

/** GitHub Issues bridge status footer — always visible so the operator knows
 *  whether Forward-to-GitHub is available. The dynamic portion is a polite
 *  live region (`role="status"`) labelled by the visible heading, so assistive
 *  tech announces the outcome once the async status resolves and reports the
 *  in-flight load via `aria-busy`. */
export function BridgeStatus({ enabled, repo, loading }: { enabled: boolean; repo: string; loading: boolean }) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <div className="mt-4 border-t border-[var(--glass-border)] pt-3">
      <Label id={titleId} className="mb-1.5 block">
        {t('feedback.queue.bridge.title', 'GitHub bridge')}
      </Label>
      <div role="status" aria-labelledby={titleId} aria-busy={loading}>
        {loading ? (
          <Skeleton height={16} width="60%" />
        ) : enabled ? (
          <div className="flex items-center gap-2">
            <Icons.securityCheck className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
            <Text as="span" variant="bodySm">
              {t('feedback.queue.bridge.enabled', 'Connected')}
              {repo ? ' · ' : ''}
            </Text>
            {repo ? <Code>{repo}</Code> : null}
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <Icons.info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
            <div>
              <Text as="span" variant="bodySm">
                {t('feedback.queue.bridge.disabled', 'Not configured')}
              </Text>
              <Caption className="mt-0.5 block">
                {t(
                  'feedback.queue.bridgeDisabled',
                  'Set TESLASYNC_GITHUB_REPO + TESLASYNC_GITHUB_TOKEN on the server to enable forwarding.',
                )}
              </Caption>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
