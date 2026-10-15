import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, Text, MetricLabel, GlossaryTerm } from '@/components/ui';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { ChartContainer } from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { BatteryPanelGrid } from './BatteryPanelGrid';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';

export interface HealthUnavailableOutlineProps {
  loading: boolean;
  summary: ReactNode;
  thermal: ReactNode;
  links: ReactNode;
}

/** The no-model state retains the full evidence outline, and the independently
 * queried thermal source and navigation remain live. The measured branch stays
 * in BatteryHealthPage: no fabricated DTO or zero-health fixture is introduced. */
export function HealthUnavailableOutline({ loading, summary, thermal, links }: HealthUnavailableOutlineProps) {
  const { t } = useTranslation();
  const unavailable = t('battery.health.missingMeasurement', 'Capacity measurements are not available yet; battery health cannot be assessed.');
  const recovery = loading
    ? <Skeleton className="h-40 rounded-xl" />
    : <Text variant="bodySm">{unavailable}</Text>;
  const comparisonMetrics: StatMetric[] = [
    { metricId: 'energy', occurrenceId: 'capacity-new', rawValue: null,
      label: t('battery.newVsNow.capNew', 'Capacity When New'), missingReason: unavailable },
    { metricId: 'energy', occurrenceId: 'capacity-now', rawValue: null,
      label: t('battery.newVsNow.capNow', 'Capacity Now'), missingReason: unavailable },
    { metricId: 'distance', occurrenceId: 'range-new', rawValue: null,
      label: t('battery.newVsNow.rangeNew', 'Range When New'), missingReason: unavailable },
    { metricId: 'distance', occurrenceId: 'range-now', rawValue: null,
      label: t('battery.newVsNow.rangeNow', 'Range Now'), missingReason: unavailable },
  ];
  return (
    <div className="min-w-0 w-full space-y-6" data-testid="battery-health-unavailable-outline">
      <OperationalBrief
        compact
        loading={loading}
        testId="battery-operational-brief"
        eyebrow={t('operations.battery.eyebrow', 'Battery posture')}
        title={t('operations.battery.title', 'Long-term pack health remains measurable and actionable')}
        description={unavailable}
        statusLabel={t('battery.health.unavailable', 'Not measured')}
        statusTone="neutral"
        metricColumns={3}
        metrics={[
          { key: 'health', label: t('operations.battery.packScore', 'Pack score'), value: '—', detail: unavailable },
          { key: 'degradation', label: t('operations.battery.degradationPace', 'Degradation pace'), value: '—', detail: unavailable },
          { key: 'range-confidence', label: t('operations.battery.rangeConfidence', 'Range confidence'), value: '—', detail: unavailable },
          { key: 'charging-stress', label: t('operations.battery.chargingStress', 'Charging stress'), value: '—', detail: unavailable },
          { key: 'thermal-impact', label: t('operations.battery.thermalImpact', 'Thermal impact'), value: '—', detail: t('operations.battery.thermalImpactUnavailable', 'More temperature history is required to estimate thermal exposure.') },
          { key: 'cycles', label: t('operations.battery.cycleExposure', 'Cycle exposure'), value: '—', detail: unavailable },
        ].map(metric => ({ ...metric, rawValue: null, valueState: 'missing' as const }))}
      />
      <Text as="p" variant="caption" className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="battery-glossary-strip">
        <span>{t('battery.glossary.lead', 'Terms on this page:')}</span>
        <GlossaryTerm term="state_of_health" />
        <GlossaryTerm term="degradation" />
        <GlossaryTerm term="soc" />
        <GlossaryTerm term="rated_range" />
      </Text>
      {summary}
      <BatteryPanelGrid label={t('battery.section.overview', 'Health score and capacity')}
        ids={['battery-health-hero', 'battery-metric-bars']} sizes={['half', 'third']}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle>{t('battery.hero.title', 'Health Overview')}</PanelTitle>
          {recovery}
          <div className="mt-4 flex flex-wrap gap-4">
            {[t('battery.gauge.health', 'Health Score'), t('battery.gauge.capacity', 'Capacity'),
              t('battery.gauge.degradation', 'Degradation'), t('battery.gauge.cycles', 'Cycles'),
              t('battery.yearsTo80', 'Years to 80%')].map(label => (
              <div key={label}><MetricLabel>{label}</MetricLabel><Text>—</Text></div>
            ))}
          </div>
          <Text variant="caption">{t('battery.warrantyNote', 'warranty threshold')}</Text>
        </GlassPanel>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle>{t('battery.bars.title', 'Capacity & Wear')}</PanelTitle>
          {recovery}
          <Text variant="caption">{t('battery.warrantyLimit', 'Tesla warranty: 1,500 cycles / 70%')}</Text>
        </GlassPanel>
      </BatteryPanelGrid>
      <BatteryPanelGrid label={t('battery.section.trends', 'Capacity and range trends')}
        ids={['battery-health-capacity-trend', 'battery-range-trend']}>
        {/* chart-a11y:no-table No capacity model exists in this branch; this frame contains recovery text, not plotted measurements. */}
        <ChartContainer title={t('battery.chart.capacityTrend', 'Capacity Trend & Prediction')}
          ariaLabel={t('battery.chart.capacityTrend', 'Capacity Trend & Prediction')}
          ariaDescription={unavailable}>
          {loading ? <Skeleton className="h-60 rounded-xl" /> : <EmptyState
            // no-action: capacity trends require recorded snapshots; the parent handles failed-source retry.
            message={t('battery.chart.noTrend', 'Not enough snapshots for trend analysis')}
          />}
        </ChartContainer>
        {/* chart-a11y:no-table No measured range series exists in this outline; the frame announces its missing-evidence state. */}
        <ChartContainer title={t('battery.chart.rangeTrend', 'Estimated Range Over Time')}
          ariaLabel={t('battery.chart.rangeTrend', 'Estimated Range Over Time')}
          ariaDescription={unavailable}>
          {loading ? <Skeleton className="h-60 rounded-xl" /> : <EmptyState
            // no-action: range history requires vehicle measurements, not a chart-local reset or backfill.
            message={t('battery.chart.noRange', 'No range data yet')}
          />}
        </ChartContainer>
      </BatteryPanelGrid>
      <BatteryPanelGrid label={t('battery.section.thermalCompare', 'Thermal monitoring and capacity comparison')}
        ids={['battery-thermal', 'battery-capacity-range']}>
        {thermal}
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle>{t('battery.newVsNow.title', 'Capacity & Range: New vs Now')}</PanelTitle>
          <BatteryEvidenceBrief
            title={t('battery.newVsNow.brief.summary', 'Capacity and range evidence')}
            description={unavailable}
            metrics={comparisonMetrics}
            loading={loading}
            period={{
              kind: 'unknown',
              label: t('battery.health.brief.capacityScope', 'Capacity and range model unavailable'),
              reason: unavailable,
            }}
          />
        </GlassPanel>
      </BatteryPanelGrid>
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle>{t('battery.insights.title', 'Smart Insights')}</PanelTitle>
        {loading ? recovery : <Text variant="bodySm">{t('battery.insights.empty', 'Not enough data for insights yet')}</Text>}
      </GlassPanel>
      <BatteryPanelGrid label={t('battery.section.chargingAnalysis', 'Charging energy analysis')}
        ids={['battery-charge-level-distribution', 'battery-energy-breakdown', 'battery-charging-statistics']}>
        {/* chart-a11y:no-table This no-model outline contains no charge-distribution plot or rows; measured charts remain in BatteryHealthPage. */}
        <ChartContainer title={t('battery.chart.chargeDist', 'Charge Level Distribution')}
          ariaLabel={t('battery.chart.chargeDist', 'Charge Level Distribution')}
          ariaDescription={unavailable}>
          {loading ? recovery : <EmptyState
            // no-action: charge-level distribution requires recorded charging sessions; this outline cannot create them.
            message={t('battery.chart.noSessions', 'No charging session data yet')}
          />}
        </ChartContainer>
        {/* chart-a11y:no-table This placeholder has no measured AC/DC breakdown; a table would fabricate evidence. */}
        <ChartContainer title={t('battery.chart.acdc', 'AC / DC Energy Breakdown')}
          ariaLabel={t('battery.chart.acdc', 'AC / DC Energy Breakdown')}
          ariaDescription={unavailable}>
          {loading ? recovery : <EmptyState
            // no-action: AC/DC breakdown requires measured session energy; related-page links remain available below.
            message={t('battery.chart.noBreakdown', 'No charging data for breakdown')}
          />}
        </ChartContainer>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle>{t('battery.stats.title', 'Charging Statistics')}</PanelTitle>
          {loading ? recovery : <Text variant="bodySm">{t('battery.stats.empty', 'No charging statistics yet')}</Text>}
        </GlassPanel>
      </BatteryPanelGrid>
      <BatteryPanelGrid label={t('battery.section.linksTips', 'Related pages and recommendations')}
        ids={['battery-quick-links', 'battery-recommendations']}>
        {links}
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle>{t('battery.recommendations.title', 'Recommendations')}</PanelTitle>
          <Text variant="bodySm">{t('battery.tip.needMeasurements', 'Keep monitoring as capacity measurements arrive; battery health cannot be assessed yet.')}</Text>
        </GlassPanel>
      </BatteryPanelGrid>
    </div>
  );
}
