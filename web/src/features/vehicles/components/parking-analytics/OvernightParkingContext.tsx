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

import { convertDurationFromSI } from '@/lib/unitConversion';
import { isFiniteNumber } from '@/lib/numberFormat';

import type { ParkingSummary } from '../../lib/parkingDwell';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const durationUnit = unitPrefs.duration;
  const hasTotal = isFiniteNumber(summary.totalParkedMs) && summary.totalParkedMs > 0;
  const rows = useMemo(
    () => [
      {
        kind: 'night',
        label: t('parking.overnight.night', '22:00–06:00'),
        milliseconds: summary.nightMs,
      },
      {
        kind: 'daytime',
        label: t('parking.overnight.daytime', '06:00–22:00'),
        milliseconds: summary.daytimeMs,
      },
    ].map(({ milliseconds, ...row }) => {
      const durationS = isFiniteNumber(milliseconds) && milliseconds >= 0
        ? milliseconds / 1_000
        : null;
      return {
        ...row,
        duration_s: durationS,
        duration: durationS == null ? null : convertDurationFromSI(durationS, durationUnit),
        duration_unit: durationUnit,
        share: durationS != null && hasTotal
          ? (milliseconds / summary.totalParkedMs) * 100
          : null,
      };
    }),
    [
      durationUnit,
      hasTotal,
      summary.daytimeMs,
      summary.nightMs,
      summary.totalParkedMs,
      t,
    ],
  );
  const hasData = hasTotal && rows.some((row) => row.duration != null);
  const subtitle =
    isFiniteNumber(summary.nightShare) && summary.nightShare >= 0 && summary.nightShare <= 1
      ? t(
          'parking.overnight.subtitle',
          '{{pct}}% of observed dwell overlaps the local night window across {{count}} stints in {{timeZone}}.',
          {
            pct: fmtNumber(summary.nightShare * 100),
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
        title={t('parking.overnight.title', 'Overnight vs daytime context')}
        subtitle={subtitle}
        ariaLabel={t(
          'parking.overnight.aria',
          'Donut chart splitting observed parking duration into local overnight and daytime windows',
        )}
        loading={state.isLoading}
        height={320}
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="parking-overnight-context"
        exportData={state.error || state.isLoading || !hasData ? [] : rows}
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
            format: (value) => isFiniteNumber(value) ? fmtNumber(value) : '—',
          },
          {
            key: 'share',
            label: t('parking.share', 'Share'),
            format: (value) => isFiniteNumber(value) ? `${fmtNumber(value)}%` : '—',
          },
        ]}
      >
        <ParkingSectionBody state={state} className="h-full min-h-0">
          {!hasData ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
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
                    `${String(name)} ${fmtNumber(Number(percent) * 100)}%`
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
                        isFiniteNumber(value) ? `${fmtNumber(value)} ${durationUnit}` : '—'
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
