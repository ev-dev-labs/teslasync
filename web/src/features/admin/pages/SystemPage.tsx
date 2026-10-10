/**
 * Operator "system budgets" dashboard.
 *
 * A full-width command-center view of the throttles and worker fleet that
 * bound this TeslaSync deployment. Composed as a modern-ui bento:
 *
 *   1. Health-at-a-glance OperationalBrief — headline numbers
 *      rolled up from both feeds.
 *   2. Detail band — RateBudgetPanel and WorkerQueuePanel side by side
 *      on wide screens, each with independent refresh and source states;
 *      worker selection opens a separately queried recent-job drawer.
 *
 * The page owns the two TanStack queries so the header freshness chip and the
 * "Refresh all" action can span both feeds; the panels below reuse the same
 * query results directly, so detail presentation adds no duplicate observers.
 *
 * SYSTEM_PAGE_PATH records the intended route identity; the application shell
 * owns mounting and navigation.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

import { PageLayout } from '@/components/layout'
import { Button, SectionTitle } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useRateLimitStatus } from '@/api/hooks/useSystem'
import { useQueueStatus } from '@/api/hooks/useSystemQueues'

import { RateBudgetPanel } from '../components/continuation-admin-2/RateBudgetPanel'
import { WorkerQueuePanel } from '../components/continuation-admin-2/WorkerQueuePanel'
import { SystemOperationalBrief } from '../components/operationalbrief-r-z/SystemOperationalBrief'

export const SYSTEM_PAGE_PATH = '/admin/system'

export default function SystemPage() {
  const { t } = useTranslation()
  const title = t('system.page.title', 'System budgets')
  usePageTitle(title)

  const rateLimit = useRateLimitStatus()
  const queue = useQueueStatus()
  const dataSources = useMemo(
    () => [
      {
        id: 'rate-limits',
        label: t('dataSources.labels.rateLimits', 'Rate-limit budgets'),
        query: rateLimit,
      },
      {
        id: 'worker-queues',
        label: t('dataSources.labels.workerQueues', 'Worker queues'),
        query: queue,
      },
    ],
    [queue, rateLimit, t],
  )

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
    <PageLayout
      title={title}
      subtitle={t(
        'system.page.subtitle',
        'Operator dashboard for the throttles and budgets that bound this TeslaSync deployment.',
      )}
      secondaryActions={actions}
      query={[rateLimit, queue]}
      dataSources={dataSources}
    >
      <FadeIn>
        <section aria-labelledby="system-overview-heading" data-testid="system-page-overview">
          <SectionTitle id="system-overview-heading" className="mb-3">
            {t('system.overview.title', 'Health at a glance')}
          </SectionTitle>
          <SystemOperationalBrief rateLimit={rateLimit} queue={queue} />
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <section aria-labelledby="system-detail-heading" data-testid="system-page-stack">
          <SectionTitle id="system-detail-heading" className="mb-3">
            {t('system.detail.title', 'Throttles & workers')}
          </SectionTitle>
          <div className="grid grid-cols-1 items-start gap-4 xl:gap-5 2xl:grid-cols-2">
            <RateBudgetPanel query={rateLimit} />
            <WorkerQueuePanel query={queue} />
          </div>
        </section>
      </FadeIn>
    </PageLayout>
  )
}
