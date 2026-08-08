import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AreaChartWrapper,
  ChartContainer,
  type ChartDataColumn,
} from '@/components/charts';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtPercent } from '@/lib/numberFormat';
import type { BatteryPassportAnalysis } from '../../lib/batteryPassportAnalysis';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportTrendTimelineProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
  locale: string;
}

export function BatteryPassportTrendTimeline({
  analysis,
  state,
  locale,
}: BatteryPassportTrendTimelineProps) {
  const { t } = useTranslation();
  const data = useMemo(
    () => analysis.trend.points.map((point) => ({
      date: point.date,
      soh_pct: point.sohPct,
    })),
    [analysis.trend.points],
  );
  const columns = useMemo<ChartDataColumn[]>(
    () => [
      {
        key: 'date',
        label: t('batteryPassport.trend.date', 'UTC date'),
      },
      {
        key: 'soh_pct',
        label: t(
          'batteryPassport.trend.soh',
          'Certificate-reported SoH',
        ),
        format: (value) => (
          typeof value === 'number'
            ? fmtPercent(value, 1)
            : '—'
        ),
      },
    ],
    [t],
  );
  const unavailable =
    !state.vehicleSelected
    || Boolean(state.initialError)
    || !state.isResolved
    || !state.passport
    || data.length === 0;

  return (
    <section data-testid="battery-passport-trend-timeline">
      <ChartContainer
        title={t(
          'batteryPassport.trend.title',
          'Certificate-reported SoH timeline',
        )}
        subtitle={t(
          'batteryPassport.trend.subtitle',
          'Qualifying daily points are calendar dates in UTC, not vehicle-local dates.',
        )}
        loading={state.isLoading}
        empty={unavailable}
        height={280}
        exportable={false}
        ariaLabel={t(
          'batteryPassport.trend.aria',
          'Certificate-reported state of health by qualifying UTC date',
        )}
        ariaDescription={t(
          'batteryPassport.trend.description',
          'A descriptive timeline of returned certificate points after date, range, future, and duplicate checks.',
        )}
        data={data}
        dataColumns={columns}
      >
        <AreaChartWrapper
          data={data}
          xKey="date"
          height={240}
          ariaLabel={t(
            'batteryPassport.trend.chartAria',
            'Certificate-reported state of health timeline in UTC',
          )}
          xFormatter={(value) =>
            formatDayKey(value, { locale, style: 'short' })
          }
          yFormatter={(value) => fmtPercent(value, 0)}
          series={[
            {
              key: 'soh_pct',
              label: t(
                'batteryPassport.trend.series',
                'Certificate-reported SoH',
              ),
              color: '#22d3ee',
            },
          ]}
        />
      </ChartContainer>
    </section>
  );
}
