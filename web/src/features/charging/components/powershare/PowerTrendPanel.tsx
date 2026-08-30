import { useTranslation } from 'react-i18next';
import { Power } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  ChartTooltip, ChartGradient, chartGrid, axisTickSm, AREA_DEFAULTS,
  EmbeddedChart,
} from '@/components/charts';

import { POWER_COLOR, type TrendPoint } from './constants';

interface PowerTrendPanelProps {
  points: TrendPoint[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Hero panel — instantaneous Powershare output (kW) over recent readings. */
export function PowerTrendPanel({ points, isLoading, error, onRetry }: PowerTrendPanelProps) {
  const { t } = useTranslation();
  // Null-safety: the prop is typed `TrendPoint[]`, but an in-flight/errored
  // upstream query can hand us `undefined`. Guard before `.length`/`.map` so a
  // transient nullish payload routes to the empty state instead of throwing.
  const data = points ?? [];

  return (
    <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Power className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('powershare.powerTrend.title', 'Output Power Trend')}
      </PanelTitle>
      <EmbeddedChart
        title={t('powershare.powerTrend.title', 'Output Power Trend')}
        ariaLabel={t('powershare.powerTrend.ariaLabel', 'Output power trend chart')}
        data={data.map(({ label, value }) => ({ label, value }))}
        dataColumns={[
          { key: 'label', label: t('powershare.time', 'Time') },
          { key: 'value', label: t('powershare.kpi.outputPower', 'Output Power (kW)') },
        ]}
        loading={isLoading}
        error={error}
        onRetry={onRetry}
        empty={data.length === 0}
        emptyMessage={t(
            'powershare.powerTrend.noData',
            'No power readings yet. The chart fills in as your vehicle streams Powershare telemetry.',
        )}
        fluid={false}
        mobileHeight={224}
        height={288}
      >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <ChartGradient id="powershare-power" color={POWER_COLOR} />
              </defs>
              {chartGrid}
              <XAxis dataKey="label" tick={axisTickSm} minTickGap={24} />
              <YAxis tick={axisTickSm} width={40} unit=" kW" />
              <Tooltip content={<ChartTooltip />} />
              <Area
                {...AREA_DEFAULTS}
                dataKey="value"
                name={t('powershare.kpi.outputPower', 'Output Power')}
                stroke={POWER_COLOR}
                fill="url(#powershare-power)"
              />
            </AreaChart>
          </ResponsiveContainer>
      </EmbeddedChart>
    </GlassPanel>
  );
}
