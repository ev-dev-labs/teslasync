/**
 * Hero visual for the Vehicle Ingest Cost page — a horizontal bar chart of
 * estimated ingest bytes per vehicle, largest consumer first. The single
 * biggest consumer is tinted amber so a misconfigured Fleet Telemetry agent
 * firehosing every signal jumps out immediately.
 *
 * Rendered through the shared charts barrel (never `recharts` directly) inside
 * a `GlassPanel` so it shares the exact surface + rhythm of the sibling
 * top-talkers panel beside it. Owns its own loading / empty / error states.
 */
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';
import { formatBytes } from '@/lib/numberFormat';
import { type SectionState, type VehicleCostBar } from './helpers';

interface CostByVehicleChartProps extends SectionState {
  bars: VehicleCostBar[];
}

/** Amber highlight for the heaviest consumer; blue baseline for the rest. */
const HIGHLIGHT = chartTokens.series[2];
const BASE = chartTokens.series[0];

// Hoisted so recharts children receive stable references instead of a fresh
// object literal on every render (see "no new object/array literals in hot
// JSX props"). Values are static module-level tokens.
const CHART_MARGIN = { top: 4, right: 16, left: 8, bottom: 4 };
const TOOLTIP_CURSOR = { fill: 'var(--surface-2)', opacity: 0.4 };
const TOOLTIP_CONTENT_STYLE = {
  background: chartTokens.tooltipBg,
  border: `1px solid ${chartTokens.tooltipBorder}`,
  borderRadius: 8,
  color: chartTokens.tooltipText,
};

export function CostByVehicleChart({ bars, loading, error, onRetry }: CostByVehicleChartProps) {
  const { t } = useTranslation();

  // Null-safe: a caller passing undefined/null must fall through to the empty
  // state, never crash on `.length` / `.map`.
  const items = bars ?? [];

  return (
    <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.vehicleCost.chartTitle', 'Ingest cost by vehicle')}
      </PanelTitle>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : loading && items.length === 0 ? (
        <Skeleton height={288} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-8 w-8" />}
          message={t('admin.vehicleCost.chartEmpty', 'No ingest volume recorded in this window yet.')}
        />
      ) : (
        <div
          className="h-72 sm:h-80"
          role="img"
          aria-label={t(
            'admin.vehicleCost.chartAria',
            'Horizontal bar chart of estimated ingest bytes per vehicle, largest consumer first.',
          )}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={items} layout="vertical" margin={CHART_MARGIN}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={chartTokens.gridStroke}
                strokeOpacity={0.4}
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={axisTick}
                tickFormatter={(v: number) => formatBytes(v)}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={axisTick}
                width={128}
                tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
              />
              <Tooltip
                cursor={TOOLTIP_CURSOR}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                formatter={(v: number) => [formatBytes(v), t('admin.vehicleCost.colBytes', 'Bytes (est.)')]}
              />
              <Bar dataKey="bytes" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {items.map((b, i) => (
                  <Cell key={b.vehicle_id} fill={i === 0 ? HIGHLIGHT : BASE} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </GlassPanel>
  );
}
