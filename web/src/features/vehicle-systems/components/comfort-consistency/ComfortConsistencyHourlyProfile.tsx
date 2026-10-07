import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';

interface ComfortConsistencyHourlyProfileProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
}

export function ComfortConsistencyHourlyProfile({
  summary,
  state,
  formatDuration,
}: ComfortConsistencyHourlyProfileProps) {
  const { t } = useTranslation();
  const data = summary.hourlyProfile.map((bucket) => ({
    hour: t('comfortConsistency.hourly.hourLabel', '{{hour}}:00', {
      hour: String(bucket.hour).padStart(2, '0'),
    }),
    withinPct:
      bucket.withinBandShare != null
        ? bucket.withinBandShare * 100
        : null,
    observed: formatDuration(bucket.observedS, { precision: 2 }),
  }));

  return (
    <section data-testid="comfort-consistency-hourly-profile">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.hourly.title', 'Hourly comfort consistency')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.hourly.subtitle',
            'Duration-weighted within-band share by browser-local hour, paired with its observed-time support.',
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="intervals"
          skeletonHeight={320}
        >
          <ChartContainer
            title={t('comfortConsistency.hourly.plotTitle', 'Within-band duration by local hour')}
            ariaLabel={t(
              'comfortConsistency.hourly.aria',
              'Bar chart of duration-weighted comfort-band adherence by local hour',
            )}
            height={300}
            data={data}
            dataColumns={[
              { key: 'hour', label: t('comfortConsistency.hourly.hour', 'Hour') },
              {
                key: 'withinPct',
                label: t('comfortConsistency.hourly.within', 'Within band (%)'),
              },
              {
                key: 'observed',
                label: t('comfortConsistency.hourly.support', 'Observed support'),
              },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis
                  dataKey="hour"
                  interval={1}
                  tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="withinPct"
                  name={t('comfortConsistency.hourly.within', 'Within band (%)')}
                  fill={chartTokens.series[0]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
          <Text as="h4" variant="label" className="mb-3 mt-4">
            {t('comfortConsistency.hourly.supportGrid', 'Per-hour observed support')}
          </Text>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {summary.hourlyProfile.map((bucket) => (
              <div
                key={bucket.hour}
                className="rounded-lg border border-[var(--border-subtle)] p-2"
              >
                <MetricLabel>
                  {String(bucket.hour).padStart(2, '0')}:00
                </MetricLabel>
                <Text as="p" variant="bodySm" className="mt-1">
                  {bucket.withinBandShare != null
                    ? fmtPercent(bucket.withinBandShare * 100, 0)
                    : '—'}
                </Text>
                <Text as="p" variant="caption">
                  {formatDuration(bucket.observedS, { precision: 2 })}
                </Text>
              </div>
            ))}
          </div>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
