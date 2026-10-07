import { useTranslation } from 'react-i18next'
import { PageContainer } from '@/components/layout'
import { GlassPanel, Heading, Text } from '@/components/ui'
import { KVList } from '@/components/data-display'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTeslaUsage } from '@/api/hooks/useTeslaUsage'
import { TeslaApiUsageCard, TeslaApiUsageHistory } from '../components/status'

/**
 * Observed usage, not an invoice: fixed UTC cycles and independently selected
 * daily/weekly history intentionally remain separate queries and panels.
 */
export default function TeslaApiUsagePage() {
  const { t } = useTranslation()
  const title = t('teslaUsage.pageTitle', 'Tesla API usage')
  usePageTitle(title)
  const { data, isLoading, error } = useTeslaUsage()

  return (
    <PageContainer
      title={title}
      subtitle={t('teslaUsage.pageSubtitle', 'Observed Tesla Fleet traffic, estimated spend and historical trends')}
    >
      <div className="space-y-6">
        <FadeIn>
          <section aria-label={t('teslaUsage.cycleSection', 'Current cycle and prior periods')}>
            <Heading level="section" className="mb-3">
              {t('teslaUsage.cycleSection', 'Current cycle and prior periods')}
            </Heading>
            <GlassPanel className="p-4 sm:p-6">
              <TeslaApiUsageCard apiUsage={data} now={Date.now()} loading={isLoading} error={error} />
            </GlassPanel>
          </section>
        </FadeIn>

        <FadeIn delay={0.05}>
          <section aria-label={t('teslaUsage.historySection', 'Tesla usage history')}>
            <Heading level="section" className="mb-3">
              {t('teslaUsage.historySection', 'Tesla usage history')}
            </Heading>
            <TeslaApiUsageHistory />
          </section>
        </FadeIn>

        <FadeIn delay={0.1}>
          <GlassPanel className="p-4 sm:p-6">
            <Heading level="section" className="mb-3">
              {t('teslaUsage.methodTitle', 'How the estimate is calculated')}
            </Heading>
            <Text as="p" variant="body" className="mb-4">
              {t('teslaUsage.methodText', 'Counts come only from locally observed Tesla Fleet Telemetry emissions and qualifying outbound Fleet API responses. Retransmitted signals are deduplicated. Missing deliveries or audit writes can undercount, and Tesla can make billing adjustments.')}
            </Text>
            <KVList columns={2} items={[
              { label: t('teslaUsage.signals', 'Streaming signals'), value: t('teslaUsage.signalRate', '150,000 / $1') },
              { label: t('teslaUsage.historyCommands', 'Commands'), value: t('teslaUsage.commandRate', '1,000 / $1') },
              { label: t('teslaUsage.historyData', 'Data requests'), value: t('teslaUsage.dataRate', '500 / $1') },
              { label: t('teslaUsage.historyWakes', 'Wakes'), value: t('teslaUsage.wakeRate', '50 / $1') },
            ]} />
            <Text as="p" variant="caption" className="mt-4">
              {t('teslaUsage.cycleCaveat', 'These are fixed UTC 30-day windows, not Tesla calendar-month billing cycles. No monthly credit, rounding or invoice adjustments are assumed.')}
              {' '}
              {t('teslaUsage.rateSource', 'Tesla Fleet API pricing reference')}: {data?.rate_source ?? 'https://developer.tesla.com/'}
            </Text>
          </GlassPanel>
        </FadeIn>
      </div>
    </PageContainer>
  )
}
