import { LayoutCard } from '@/components/layout';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  EmbeddedChart,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { MetricLabel, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';

import { chartTokens } from '@/lib/tokens';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingHourlyDutyProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  formatDuration: UnitFormatter;
}

export function HvacCyclingHourlyDuty({
  summary,
  state,
  formatDuration,
}: HvacCyclingHourlyDutyProps) {
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const data = summary.hourlyProfile.map((bucket) => ({
    hourIndex: bucket.hour,
    hour: t('hvacCycling.hourly.hourLabel', '{{hour}}:00', {
      hour: String(bucket.hour).padStart(2, '0'),
    }),
    duty: bucket.dutyCycle != null ? bucket.dutyCycle * 100 : null,
    observedS: bucket.observedS,
    starts: bucket.onTransitions,
  }));

  return (
    <section data-testid="hvac-cycling-hourly-duty">
      <LayoutCard title={t('hvacCycling.hourly.title', 'Hourly HVAC duty')}>
        <Text as="p" variant="caption" className="mb-3">
          {t(
            'hvacCycling.hourly.subtitle',
            'Duration-weighted on share by local hour, paired with the observed-time denominator.',
          )}
        </Text>
        <HvacCyclingSectionBody
          summary={summary}
          state={state}
          requirement="intervals"
          skeletonHeight={230}
        >
          <EmbeddedChart toolbar exportable size="standard"
            className="border-0 bg-transparent p-0 shadow-none"
            title={t('hvacCycling.hourly.plotTitle', 'Duty by local hour')}
            ariaLabel={t(
              'hvacCycling.hourly.aria',
              'Bar chart of HVAC duty by local hour with observed-time support in the data table',
            )}
            height={230}
            data={data}
            dataColumns={[
              { key: 'hour', label: t('hvacCycling.hourly.hour', 'Hour') },
              {
                key: 'duty',
                label: t('hvacCycling.hourly.duty', 'Duty cycle'),
                format: (value) =>
                  typeof value === 'number' ? fmtPercent(value) : '—',
              },
              {
                key: 'observedS',
                label: t('hvacCycling.hourly.support', 'Observed support'),
                format: (value) =>
                  formatDuration(
                    typeof value === 'number' ? value : null,
                  ),
              },
              { key: 'starts', label: t('hvacCycling.hourly.starts', 'Observed on transitions') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis
                  dataKey="hour"
                  interval={1}
                  tick={{ fill: chartTokens.axisStroke, fontSize: 10 }}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="duty"
                  name={t('hvacCycling.hourly.duty', 'Duty cycle')}
                  fill={chartTokens.series[5]}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
          <Text as="h4" variant="label" className="mb-2 mt-3">
            {t('hvacCycling.hourly.supportGrid', 'Per-hour observed support')}
          </Text>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-12">
            {data.map((bucket) => (
              <div
                key={bucket.hourIndex}
                className="rounded-lg border border-[var(--border-subtle)] p-2"
              >
                <MetricLabel>{bucket.hour}</MetricLabel>
                <Text as="p" variant="caption" className="mt-1">
                  {formatDuration(bucket.observedS)}
                </Text>
                <Text as="p" variant="caption">
                  {t('hvacCycling.hourly.transitionCount', '{{count}} starts', {
                    count: bucket.starts,
                  })}
                </Text>
              </div>
            ))}
          </div>
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
