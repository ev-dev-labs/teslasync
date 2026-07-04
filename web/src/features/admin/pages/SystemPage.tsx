/**
 * Operator "system budgets" dashboard.
 *
 * A full-width command-center view of the throttles and worker fleet that
 * bound this TeslaSync deployment. Composed as a modern-ui bento:
 *
 *   1. Health-at-a-glance KPI band (SystemHealthOverview) — headline numbers
 *      rolled up from both feeds.
 *   2. Detail band — the RateLimitStatusPanel and QueueStatusPanel side by
 *      side on wide screens (each self-contained: its own hook, refresh,
 *      loading / empty / error handling and, for queues, a per-worker drawer).
 *
 * The page owns the two TanStack queries so the header freshness chip and the
 * "Refresh all" action can span both feeds; the panels below reuse the same
 * deduped query cache, so there is no extra network cost.
 *
 * Route wiring lives in App.tsx + routeRegistry.ts. Reuse the same nav-entry
 * pattern as the Diagnostic page when adding new system panels.
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { Button, SectionTitle } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useRateLimitStatus } from '@/api/hooks/useSystem'
import { useQueueStatus } from '@/api/hooks/useSystemQueues'

import { RateLimitStatusPanel } from '@/features/admin/components/RateLimitStatusPanel'
import { QueueStatusPanel } from '@/features/admin/components/QueueStatusPanel'
import { SystemHealthOverview } from '@/features/admin/components/SystemHealthOverview'

export const SYSTEM_PAGE_PATH = '/admin/system'

export default function SystemPage() {
  const { t } = useTranslation()
  const title = t('system.page.title', 'System budgets')
  usePageTitle(title)

  const rateLimit = useRateLimitStatus()
  const queue = useQueueStatus()

  const refreshing = rateLimit.isFetching || queue.isFetching

  // `refetch` is referentially stable across renders, so keying the handler
  // on the two functions keeps `refreshAll` stable through the 30s
  // auto-refresh re-renders instead of allocating a new closure each time.
  const { refetch: refetchRateLimit } = rateLimit
  const { refetch: refetchQueue } = queue
  const refreshAll = useCallback(() => {
    void refetchRateLimit()
    void refetchQueue()
  }, [refetchRateLimit, refetchQueue])

  const actions = (
    <Button
      variant="ghost"
      onClick={refreshAll}
      loading={refreshing}
      disabled={refreshing}
      icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      data-testid="system-refresh-all"
    >
      {t('system.toolbar.refreshAll', 'Refresh all')}
    </Button>
  )

  return (
    <PageContainer
      title={title}
      subtitle={t(
        'system.page.subtitle',
        'Operator dashboard for the throttles and budgets that bound this TeslaSync deployment.',
      )}
      actions={actions}
      query={[rateLimit, queue]}
    >
      <FadeIn>
        <section aria-labelledby="system-overview-heading" data-testid="system-page-overview">
          <SectionTitle id="system-overview-heading" className="mb-3">
            {t('system.overview.title', 'Health at a glance')}
          </SectionTitle>
          <SystemHealthOverview rateLimit={rateLimit} queue={queue} />
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <section aria-labelledby="system-detail-heading" data-testid="system-page-stack">
          <SectionTitle id="system-detail-heading" className="mb-3">
            {t('system.detail.title', 'Throttles & workers')}
          </SectionTitle>
          <div className="grid grid-cols-1 items-start gap-4 xl:gap-5 2xl:grid-cols-2">
            <RateLimitStatusPanel />
            <QueueStatusPanel />
          </div>
        </section>
      </FadeIn>
    </PageContainer>
  )
}
