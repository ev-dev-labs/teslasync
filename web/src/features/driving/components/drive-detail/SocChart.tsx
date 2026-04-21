import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer, ChartTooltip, ChartGradient,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import type { ChartDataPoint } from './types';

interface SocChartProps {
  chartData: ChartDataPoint[];
}

export function SocChart({ chartData }: SocChartProps) {
  const { t } = useTranslation();

  return (
    <FadeIn>
      <ChartContainer title={t('driveDetail.socOverTime', 'SOC % Over Time')} height={220}>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <defs><ChartGradient id="socGrad" color="#10b981" /></defs>
              <Area type="monotone" dataKey="battery" stroke="#10b981" fill="url(#socGrad)" strokeWidth={2} name={`${t('driveDetail.soc', 'SOC')} %`} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" />
            <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
          </div>
        )}
      </ChartContainer>
    </FadeIn>
  );
}
