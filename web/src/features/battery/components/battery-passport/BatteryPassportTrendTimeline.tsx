import * as palette from '@/lib/colors';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AreaChartWrapper,
  type ChartDataColumn,
} from '@/components/charts';
import { ChartCard } from '@/components/layout';
import { formatDayKey } from '@/lib/dateFormat';

import type { BatteryPassportAnalysis } from '../../lib/batteryPassportAnalysis';
import type { BatteryPassportQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtPercent } = useNumberFormatting();
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
        label: t('batteryPassport.trend.date', 'Certificate date'),
        format: (value) => typeof value === 'string'
          ? formatDayKey(value, { locale })
          : '—',
      },
      {
        key: 'soh_pct',
        label: t(
          'batteryPassport.trend.soh',
          'Certificate-reported SoH',
        ),
        format: (value) => (
          typeof value === 'number'
            ? fmtPercent(value)
            : '—'
        ),
      },
    ],
    [t, fmtPercent, locale],
  );
  const unavailable =
    !state.vehicleSelected
    || Boolean(state.initialError)
    || !state.isResolved
    || !state.passport
    || data.length === 0;

  return (
    <section data-testid="battery-passport-trend-timeline">
      <ChartCard toolbar size="standard"
        title={t(
          'batteryPassport.trend.title',
          'Certificate-reported SoH timeline',
        )}
        subtitle={t(
          'batteryPassport.trend.subtitle',
          'Qualifying daily points retain the fixed certificate calendar; display settings do not move these dates.',
        )}
        loading={state.isLoading}
        empty={unavailable}
        height={280}
        exportable={false}
        ariaLabel={t(
          'batteryPassport.trend.aria',
          'Certificate-reported state of health by qualifying certificate date',
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
            'Certificate-reported state of health timeline by certificate date',
          )}
          xFormatter={(value) =>
            formatDayKey(value, { locale, style: 'short' })
          }
          yFormatter={(value) => fmtPercent(value)}
          series={[
            {
              key: 'soh_pct',
              label: t(
                'batteryPassport.trend.series',
                'Certificate-reported SoH',
              ),
              color: palette.DATA_VISUAL_COLORS.info,
            },
          ]}
        />
      </ChartCard>
    </section>
  );
}
