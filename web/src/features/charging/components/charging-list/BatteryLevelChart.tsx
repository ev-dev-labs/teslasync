import { useTranslation } from 'react-i18next';
import { BatteryCharging } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import type { StartLevelBucket } from './helpers';

interface BatteryLevelChartProps {
  data: StartLevelBucket[];
}

export function BatteryLevelChart({ data }: BatteryLevelChartProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-6">
      <h3 className="section-title mb-4 flex items-center gap-2">
        <BatteryCharging className="h-4 w-4 text-neon-amber" />
        {t('charging.charts.batteryLevelAtStart', 'Battery Level at Charge Start')}
        <span className="text-xs text-[var(--text-muted)] font-normal ml-2">
          {t('charging.charts.batteryLevelHint', 'How low do you typically go before charging?')}
        </span>
      </h3>
      <div className="h-36 sm:h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {chartGrid}
            <XAxis dataKey="range" tick={axisTickSm} />
            <YAxis tick={axisTickSm} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="count" name="Sessions" fill="#f59e0b" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassPanel>
  );
}
