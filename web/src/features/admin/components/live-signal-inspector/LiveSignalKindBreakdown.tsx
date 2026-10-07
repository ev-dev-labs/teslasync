/**
 * Live Signal Inspector — value-kind breakdown.
 *
 * Bar chart of how many live fields fall into each high-level value-kind
 * bucket (numeric / boolean / text / enum / time / compound). Colours come
 * from the color-blind-safe `chartTokens.series` palette and axes read from
 * the theme-aware chart tokens so the panel matches every other chart surface.
 */
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ChartTooltip,
  EmbeddedChart,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';

import { LiveSectionState } from './LiveSectionState';
import {
  KIND_LABELS,
  type LiveSignalStats,
  type SectionStatus,
} from './liveSignalStats';

interface LiveSignalKindBreakdownProps {
  stats: LiveSignalStats;
  status: SectionStatus;
  error: unknown;
  onRetry: () => void;
  noVehicleIcon?: ReactNode;
}

export function LiveSignalKindBreakdown({
  stats,
  status,
  error,
  onRetry,
  noVehicleIcon,
}: LiveSignalKindBreakdownProps) {
  const { t } = useTranslation();

  const data = useMemo(
    () =>
      (stats.byKind ?? []).map((bucket) => {
        // `stats` is a prop, so a malformed/legacy category from an
        // upstream contract violation must degrade to a readable label
        // rather than crashing the whole panel on `undefined.key`.
        const meta: { key: string; fallback: string } | undefined =
          KIND_LABELS[bucket.category];
        return {
          category: bucket.category,
          label: meta
            ? t(meta.key, meta.fallback)
            : t(
                `admin.liveSignals.kind.${bucket.category}`,
                String(bucket.category ?? '—'),
              ),
          value: bucket.count ?? 0,
        };
      }),
    [stats.byKind, t],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.liveSignals.panels.kinds', 'Signal Kinds')}
      </PanelTitle>

      <LiveSectionState
        status={status}
        error={error}
        onRetry={onRetry}
        skeletonHeight={256}
        noVehicleIcon={noVehicleIcon}
        noVehicleMessage={t(
          'admin.liveSignals.kinds.noVehicle',
          'Select a vehicle to break its signals down by value kind.',
        )}
        emptyMessage={t(
          'admin.liveSignals.kinds.empty',
          'No live signals to categorise yet.',
        )}
      >
        <EmbeddedChart
          title={t('admin.liveSignals.panels.kinds', 'Signal Kinds')}
          ariaLabel={t(
            'admin.liveSignals.kinds.chartAria',
            'Bar chart of live signal counts grouped by value kind.',
          )}
          data={data}
          dataColumns={[
            { key: 'label', label: t('admin.liveSignals.kinds.kindCol', 'Kind') },
            { key: 'value', label: t('admin.liveSignals.kinds.count', 'Fields') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={chartTokens.gridStroke}
                strokeOpacity={0.4}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
                interval={0}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar
                dataKey="value"
                name={t('admin.liveSignals.kinds.count', 'Fields')}
                radius={[4, 4, 0, 0]}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={entry.category}
                    fill={chartTokens.series[index % chartTokens.series.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </EmbeddedChart>
      </LiveSectionState>
    </GlassPanel>
  );
}
