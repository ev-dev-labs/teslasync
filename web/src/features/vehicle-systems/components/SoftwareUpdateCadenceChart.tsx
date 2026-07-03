/**
 * SoftwareUpdateCadenceChart — monthly firmware-update cadence.
 *
 * Renders a bar of the number of updates the vehicle saw per calendar month
 * across the selected range, so the operator can eyeball how frequently Tesla
 * has been shipping firmware. Pure presentational: the parent page bins the
 * raw update rows and passes the sorted points in.
 */

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
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';

export interface CadencePoint {
  /** `YYYY-MM` bucket key. */
  month: string;
  /** Short human label, e.g. `Mar '25`. */
  label: string;
  count: number;
}

interface SoftwareUpdateCadenceChartProps {
  data: CadencePoint[];
}

export function SoftwareUpdateCadenceChart({ data }: SoftwareUpdateCadenceChartProps) {
  const { t } = useTranslation();
  return (
    <div className="h-56 sm:h-64 xl:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={chartTokens.gridStroke}
            strokeOpacity={0.4}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            width={28}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)', opacity: 0.4 }} />
          <Bar
            dataKey="count"
            name={t('softwareUpdates.cadence.series', 'Updates')}
            fill={chartTokens.series[5]}
            fillOpacity={0.85}
            radius={[4, 4, 0, 0]}
            maxBarSize={56}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
