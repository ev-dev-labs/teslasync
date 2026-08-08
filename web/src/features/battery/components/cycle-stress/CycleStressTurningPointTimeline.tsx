import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  axisTick,
} from '@/components/charts';
import { formatDateShort, formatDateTime } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import type { CycleStressResult } from '../../lib/cycleStress';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressTurningPointTimelineProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}

export function CycleStressTurningPointTimeline({
  result,
  state,
  locale,
}: CycleStressTurningPointTimelineProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.timeline.map((point) => ({
        timestamp: point.timestamp,
        ms: point.ms,
        socPct: point.socPct,
        segmentId: point.segmentId,
        source: point.source,
        kind: point.kind,
      })),
    [result.timeline],
  );
  const drives = rows.filter((row) => row.source === 'drive');
  const charging = rows.filter((row) => row.source === 'charging');

  return (
    <section data-testid="cycle-stress-turning-points">
      <ChartContainer
        title={t(
          'cycleStress.turning.title',
          'Retained SoC turning points',
        )}
        subtitle={t(
          'cycleStress.turning.subtitle',
          'A point cloud avoids drawing lines across continuity segments; only the latest capped turning points are shown.',
        )}
        ariaLabel={t(
          'cycleStress.turning.aria',
          'Point chart of retained battery percentage turning points from drive and charging history',
        )}
        height={340}
        loading={state.isLoading}
        empty={false}
        exportable={
          state.isResolved
          && !state.error
          && result.turningPoints.length > 0
        }
        exportData={rows}
        data={rows}
        dataColumns={[
          {
            key: 'timestamp',
            label: t('cycleStress.columns.timestamp', 'Timestamp'),
          },
          {
            key: 'socPct',
            label: t('cycleStress.columns.socPct', 'SoC (%)'),
          },
          {
            key: 'segmentId',
            label: t('cycleStress.columns.segment', 'Segment'),
          },
          {
            key: 'source',
            label: t('cycleStress.columns.source', 'Source'),
          },
          {
            key: 'kind',
            label: t('cycleStress.columns.endpoint', 'Endpoint'),
          },
        ]}
      >
        <CycleStressSectionBody
          result={result}
          state={state}
          requirement="turningPoints"
          className="h-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart
              margin={{ top: 12, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--glass-border)"
                strokeOpacity={0.4}
              />
              <XAxis
                type="number"
                dataKey="ms"
                domain={['dataMin', 'dataMax']}
                tick={axisTick}
                tickFormatter={(value: number) =>
                  formatDateShort(new Date(value), {
                    locale,
                    tz: result.timeZone,
                  })
                }
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="number"
                dataKey="socPct"
                domain={[0, 100]}
                unit="%"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <ZAxis range={[44, 44]} />
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormatter={(label) =>
                      typeof label === 'number'
                        ? formatDateTime(new Date(label), {
                            locale,
                            tz: result.timeZone,
                          })
                        : String(label ?? '')
                    }
                  />
                }
              />
              <Scatter
                name={t('cycleStress.sources.drives', 'Drive history')}
                data={drives}
                fill={chartTokens.series[0]}
                fillOpacity={0.8}
              />
              <Scatter
                name={t(
                  'cycleStress.sources.charging',
                  'Charging history',
                )}
                data={charging}
                fill={chartTokens.series[1]}
                fillOpacity={0.8}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </CycleStressSectionBody>
      </ChartContainer>
    </section>
  );
}
