import { Moon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Cell,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDurationFromSI } from '@/lib/unitConversion';

import type { ParkingSummary } from '../../lib/parkingDwell';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';

interface OvernightParkingContextProps {
  summary: ParkingSummary;
  state: ParkingSectionState;
  className?: string;
}

/** Exact duration overlap split between local night and daytime windows. */
export function OvernightParkingContext({
  summary,
  state,
  className,
}: OvernightParkingContextProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const durationUnit = unitPrefs.duration;
  const rows = useMemo(
    () => [
      {
        kind: 'night',
        label: t('parking.overnight.night', '22:00–06:00'),
        duration:
          Math.round(
            convertDurationFromSI(summary.nightMs / 1_000, durationUnit) * 10,
          ) / 10,
        share:
          summary.totalParkedMs > 0
            ? (summary.nightMs / summary.totalParkedMs) * 100
            : 0,
      },
      {
        kind: 'daytime',
        label: t('parking.overnight.daytime', '06:00–22:00'),
        duration:
          Math.round(
            convertDurationFromSI(summary.daytimeMs / 1_000, durationUnit) * 10,
          ) / 10,
        share:
          summary.totalParkedMs > 0
            ? (summary.daytimeMs / summary.totalParkedMs) * 100
            : 0,
      },
    ],
    [
      durationUnit,
      summary.daytimeMs,
      summary.nightMs,
      summary.totalParkedMs,
      t,
    ],
  );
  const hasData = summary.totalParkedMs > 0;
  const subtitle =
    summary.nightShare != null
      ? t(
          'parking.overnight.subtitle',
          '{{pct}}% of observed dwell overlaps the local night window across {{count}} stints in {{timeZone}}.',
          {
            pct: fmtNumber(summary.nightShare * 100, 0),
            count: summary.stints.length,
            timeZone: summary.coverage.timeZone,
          },
        )
      : t(
          'parking.overnight.subtitleEmpty',
          'Observed dwell will be split at 22:00 and 06:00 in {{timeZone}}.',
          { timeZone: summary.coverage.timeZone },
        );

  return (
    <section
      className={className}
      aria-label={t(
        'parking.sections.overnight',
        'Overnight and daytime parking context',
      )}
      data-testid="parking-overnight"
    >
      <ChartContainer
        className="h-full"
        title={t('parking.overnight.title', 'Overnight vs Daytime Context')}
        subtitle={subtitle}
        ariaLabel={t(
          'parking.overnight.aria',
          'Donut chart splitting observed parking duration into local overnight and daytime windows',
        )}
        loading={state.isLoading}
        height={320}
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="parking-overnight-context"
        data={state.error || !hasData ? [] : rows}
        dataColumns={[
          {
            key: 'label',
            label: t('parking.overnight.window', 'Local window'),
          },
          {
            key: 'duration',
            label: t(
              'parking.overnight.duration',
              'Observed dwell ({{unit}})',
              { unit: durationUnit },
            ),
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'share',
            label: t('parking.share', 'Share'),
            format: (value) => `${fmtNumber(value, 0)}%`,
          },
        ]}
      >
        <ParkingSectionBody state={state} className="h-full min-h-0">
          {!hasData ? (
            <EmptyState
              className="h-full"
              icon={<Moon className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'parking.overnight.empty',
                'No reconstructed dwell is available for an overnight split.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="duration"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius="52%"
                  outerRadius="78%"
                  paddingAngle={2}
                  label={({ name, percent }) =>
                    `${String(name)} ${fmtNumber(Number(percent) * 100, 0)}%`
                  }
                >
                  {rows.map((row, index) => (
                    <Cell
                      key={row.kind}
                      fill={CHART_COLORS[index === 0 ? 3 : 1]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value) =>
                        `${fmtNumber(value, 1)} ${durationUnit}`
                      }
                    />
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ParkingSectionBody>
      </ChartContainer>
    </section>
  );
}
