import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartLegend, ChartTooltip,
  ComposedChart, Area, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { FadeIn } from '@/components/motion';
import { ChartCard, ChartSummary } from '@/components/layout';
import { Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import type { ChartDataPoint, DriveStats } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { asFiniteNumber } from '@/lib/typeGuards';
import type { DriveElevationEvidence } from './useDriveDetailData';

interface ElevationChartProps {
  chartData: ChartDataPoint[];
  stats: DriveStats & { elevationEvidence?: DriveElevationEvidence };
}

export function ElevationChart({ chartData, stats }: ElevationChartProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  // Null-safe: the drive-detail derivation may hand us `undefined`/`[]` before
  // telemetry resolves, despite the non-optional prop type. Guard once so the
  // `.length` check and the recharts `data` prop never touch a nullish value,
  // and keep a stable reference so <ComposedChart> isn't fed a fresh array.
  const points = useMemo(() => (chartData ?? []).map((point) => ({
    ...point, elevation: asFiniteNumber(point.elevation),
  })), [chartData]);
  const hasPair = points.some((point, i) => {
    const previous = points[i - 1]?.elevation;
    return point.elevation != null && previous != null
      && asFiniteNumber(point.elevation - previous) != null;
  });
  const evidence = stats?.elevationEvidence;
  const hasDeltas = hasPair && (!evidence || evidence.eligiblePairCount > 0);
  const elevGain = hasDeltas
    ? asFiniteNumber(evidence ? evidence.gainM : stats?.elevGain) : null;
  const elevLoss = hasDeltas
    ? asFiniteNumber(evidence ? evidence.lossM : stats?.elevLoss) : null;
  const elevNet = elevGain != null && elevLoss != null
    ? asFiniteNumber(elevGain - elevLoss) : null;
  const hasChart = points.filter((point) => point.elevation != null).length > 1;

  return (
    <FadeIn>
      {/* chart-a11y:no-table dense per-sample elevation+speed trace; gain/loss/net stats appear in the card summary */}
      <ChartCard
        summary={(
          <ChartSummary
            label={t('driveDetail.elevSummary', 'Elevation summary')}
            items={[
              { id: 'gain', label: t('driveDetail.elevationGain', 'Elevation gain'), unit: 'm', value: elevGain != null ? fmtNumber(elevGain) : '—' },
              { id: 'loss', label: t('driveDetail.elevationLoss', 'Elevation loss'), unit: 'm', value: elevLoss != null ? fmtNumber(elevLoss) : '—' },
              { id: 'net', label: t('driveDetail.elevationNet', 'Net elevation'), unit: 'm', value: elevNet != null ? fmtNumber(elevNet) : '—' },
            ]}
          />
        )}
        title={t('driveDetail.elevProfile', 'Elevation profile')}
        ariaLabel={t('driveDetail.elevProfileAria', 'Elevation and speed area+line chart over the drive timeline')}
        chartKey="drive-detail-elevation"
        height={220}
        mobileHeight={220}
        toolbar
        exportable
        empty={!hasChart}
        emptyMessage={t('driveDetail.noChartData', 'No telemetry data available')}
      >
        {({ hiddenSeries }) => (
          hasChart ? (
            <>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={points}
                syncId={syncProps.syncId}
                syncMethod={syncProps.syncMethod}
                onMouseMove={syncProps.onMouseMove}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="elev" tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} />
                <YAxis yAxisId="speed" orientation="right" tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <Area yAxisId="elev" type="monotone" dataKey="elevation" stroke={chartTokens.series[1]} fill={chartTokens.series[1]} fillOpacity={0.08} strokeWidth={2} name={`${t('driveDetail.elevation', 'Elevation')} (m)`} hide={hiddenSeries?.isHidden('elevation')} />
                <Line yAxisId="speed" type="monotone" dataKey="speed" stroke={chartTokens.series[0]} strokeWidth={1.5} dot={false} name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`} strokeOpacity={0.6} hide={hiddenSeries?.isHidden('speed')} />
                {syncedX != null && (
                  <ReferenceLine
                    yAxisId="elev"
                    x={syncedX}
                    stroke={chartTokens.cursor.stroke}
                    strokeWidth={chartTokens.cursor.strokeWidth}
                    strokeDasharray={chartTokens.cursor.strokeDasharray}
                    ifOverflow="hidden"
                    isFront
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            </>
          ) : (
            <div role="status" className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" aria-hidden="true" />
              <Text variant="caption">{t('driveDetail.noChartData', 'No telemetry data available')}</Text>
            </div>
          )
        )}
      </ChartCard>
    </FadeIn>
  );
}
