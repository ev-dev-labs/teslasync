import { useTranslation } from 'react-i18next';
import { ChartContainer, ChartTooltip, CHART_COLORS, AREA_DEFAULTS, axisTickSm,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ChartLegend,
} from '@/components/charts';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';
import type { DataState } from '@/api/dataState';
import type { TirePosition, TirePressureReading } from '../../pages/TirePressurePage';
import type { PressureChartDatum } from './pressureData';
import { PressureRefreshNotice } from './PressureRefreshNotice';

const positions = ['fl', 'fr', 'rl', 'rr'] as const;
const colors = { fl: CHART_COLORS[0], fr: CHART_COLORS[2], rl: CHART_COLORS[1], rr: CHART_COLORS[3] };
export interface PressureHistoryCardProps {
  source: DataState<TirePressureReading[]>;
  loading: boolean;
  rows: PressureChartDatum[];
  label: (pos: TirePosition) => string;
  format: (value: number) => string;
  unit: string;
}

/** ChartContainer owns the ONLY surface and heading here. The placement
 * context comes from the one CardGrid observer, never a second width hook.
 * Its data table exposes every history point and gap to assistive technology.
 */
export function PressureHistoryCard({ source, loading, rows, label, format, unit }: PressureHistoryCardProps) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const formatValue = (value: unknown) => typeof value === 'number' ? `${format(value)} ${unit}` : '—';
  return (
    <div className={cn('min-w-0', placement?.className)}>
      <PressureRefreshNotice source={source} label={t('dataSources.labels.tirePressureHistory', 'Tire pressure history')} />
      <ChartContainer
        title={t('tirePressure.pressureHistory', 'Pressure history')}
        ariaLabel={t('tirePressure.pressureHistoryAria', 'Tire pressure over time for all four positions')}
        chartKey="tire-pressure-history"
        loading={loading && !source.hasData}
        error={source.fatalError}
        onRetry={source.retry ?? undefined}
        empty={rows.length === 0}
        emptyMessage={t('tirePressure.noHistory', 'No history data')}
        data={rows}
        dataColumns={[
          { key: 'time', label: t('tirePressure.col.time', 'Time') },
          ...positions.map(pos => ({ key: pos, label: `${label(pos)} (${unit})`, format: formatValue })),
        ]}
        exportData={rows}
        metadata={{ unitLabel: unit }}
        size="standard"
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={axisTickSm} />
              <YAxis domain={['auto', 'auto']} tick={axisTickSm} tickFormatter={format} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend wrapperStyle={{ fontSize: 11 }} />
              {positions.map(pos => (
                <Line key={pos} {...AREA_DEFAULTS} dataKey={pos} name={label(pos)}
                  stroke={colors[pos]} connectNulls={false} hide={hiddenSeries?.isHidden(pos) ?? false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </div>
  );
}
