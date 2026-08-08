/**
 * SoftwareUpdateCadenceChart — monthly firmware-update cadence.
 *
 * Renders a bar of the number of updates the vehicle saw per calendar month
 * across the selected range, so the operator can eyeball how frequently Tesla
 * has been shipping firmware. Pure presentational: the parent page bins the
 * raw update rows and passes the sorted points in.
 *
 * Defensive by design: absent/empty `data` degrades to an accessible empty
 * state rather than a bare axis frame, and the chart canvas carries an
 * `img` role + label so assistive tech announces it as a single figure.
 */

import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ChartTooltip,
  axisTickSm,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';

export interface CadencePoint {
  /** `YYYY-MM` bucket key. */
  month: string;
  /** Short human label, e.g. `Mar '25`. */
  label: string;
  count: number;
}

interface SoftwareUpdateCadenceChartProps {
  /** Sorted month buckets from the parent. Optional/absent renders an empty state. */
  data?: CadencePoint[];
}

// Hoisted so recharts children receive stable prop references across renders —
// recharts memoises on prop identity, so fresh object/array literals per render
// would defeat it. These are static, so module scope is the right home.
const CHART_MARGIN = { top: 8, right: 8, left: -18, bottom: 0 };
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const TOOLTIP_CURSOR = { fill: 'var(--surface-2)', opacity: 0.4 };

export function SoftwareUpdateCadenceChart({ data }: SoftwareUpdateCadenceChartProps) {
  const { t } = useTranslation();
  const points = data ?? [];

  if (points.length === 0) {
    return (
      <EmptyState /* no-action: defensive only — the sole caller (SoftwareUpdatesPage) already checks `cadence.length === 0` and renders its own EmptyState before ever mounting this chart with data. */
        icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
        message={t('softwareUpdates.cadence.empty', 'No update activity in this range')}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={t('softwareUpdates.cadence.aria', 'Software updates per calendar month')}
      className="h-56 sm:h-64 xl:h-72"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={CHART_MARGIN}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={chartTokens.gridStroke}
            strokeOpacity={0.4}
          />
          <XAxis
            dataKey="label"
            tick={axisTickSm}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            tick={axisTickSm}
            width={28}
          />
          <Tooltip content={<ChartTooltip />} cursor={TOOLTIP_CURSOR} />
          <Bar
            dataKey="count"
            name={t('softwareUpdates.cadence.series', 'Updates')}
            fill={chartTokens.series[5]}
            fillOpacity={0.85}
            radius={BAR_RADIUS}
            maxBarSize={56}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
