import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartTooltip,
  AREA_DEFAULTS, areaGradient,
  AreaChart, Area, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { ChartCard, ChartSummary } from '@/components/layout';
import { chartTokens } from '@/lib/tokens';
import { FadeIn } from '@/components/motion';

import { useUnits } from '@/hooks/useUnits';
import type { ChartDataPoint, DriveStats } from './types';
import type { DriveDetail } from '@/types/driving';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface PowerProfileChartProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
  drive?: DriveDetail;
}

export function PowerProfileChart({ chartData, drive }: PowerProfileChartProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  // A single sample can't form an area — treat 0/1 points (or a missing
  // array) as "no chart" so an undefined `chartData` degrades to the empty
  // state instead of throwing on `.length`.
  const powers = (chartData ?? []).map((row) => row.power).filter((value): value is number => value != null && Number.isFinite(value));
  const speeds = (chartData ?? []).map((row) => row.speed).filter((value): value is number => value != null && value > 0 && Number.isFinite(value));
  const hasChart = powers.length > 1;
  const max = powers.length ? powers.reduce((result, value) => Math.max(result, value), -Infinity) : null;
  const min = powers.length ? powers.reduce((result, value) => Math.min(result, value), Infinity) : null;
  const mean = powers.length ? powers.reduce((sum, value) => sum + value, 0) / powers.length : null;
  const minMoving = speeds.length ? speeds.reduce((result, value) => Math.min(result, value), Infinity) : null;

  return (
    <FadeIn>
      {/* chart-a11y:no-table dense per-sample power trace; max/regen/avg stats appear in the card summary */}
      <ChartCard
        summary={(
          <ChartSummary
            label={t('driveDetail.powerSummary', 'Power summary')}
            caption={t('driveDetail.report.powerMethod', 'Power samples preserve sign: positive draw, negative regeneration. Peak values require observations.')}
            items={[
              { id: 'max-power', label: t('driveDetail.maxPower', 'Maximum power'), unit: 'kW', value: max != null ? fmtInt(max) : '—' },
              { id: 'max-regen', label: t('driveDetail.maxRegen', 'Maximum regen'), unit: 'kW', value: min != null && min < 0 ? fmtInt(min) : min != null ? '0' : '—' },
              { id: 'avg-power', label: t('driveDetail.avgPower', 'Average power'), unit: 'kW', value: drive?.avgPowerW != null && Number.isFinite(drive.avgPowerW) ? fmtNumber(drive.avgPowerW / 1000) : '—' },
              { id: 'sample-mean-power', label: t('driveDetail.report.sampleMeanPower', 'Mean sampled power'), unit: 'kW', value: mean != null ? fmtNumber(mean) : '—' },
              { id: 'min-moving-speed', label: t('driveDetail.minMovingSpeed', 'Min moving speed'), unit: unitPrefs.speed, value: minMoving != null ? fmtNumber(minMoving) : '—' },
            ]}
          />
        )}
        title={t('driveDetail.powerProfile', 'Power profile')}
        ariaLabel={t('driveDetail.powerProfileAria', 'Drive power profile area chart over time')}
        height={220}
        size="standard"
        toolbar
        exportable
        empty={!hasChart}
        emptyMessage={t('driveDetail.noChartData', 'No telemetry data available')}
      >
        {hasChart ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              syncId={syncProps.syncId}
              syncMethod={syncProps.syncMethod}
              onMouseMove={syncProps.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke={chartTokens.axisStroke} />
              {areaGradient('powerGrad', chartTokens.series[2], 0.08)}
              <Area {...AREA_DEFAULTS} dataKey="power" stroke={chartTokens.series[2]} fill="url(#powerGrad)" name={`${t('driveDetail.power', 'Power')} kW`} />
              {syncedX != null && (
                <ReferenceLine
                  x={syncedX}
                  stroke={chartTokens.cursor.stroke}
                  strokeWidth={chartTokens.cursor.strokeWidth}
                  strokeDasharray={chartTokens.cursor.strokeDasharray}
                  ifOverflow="hidden"
                  isFront
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" />
            <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
          </div>
        )}
      </ChartCard>
    </FadeIn>
  );
}
