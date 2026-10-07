import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  ComposedChart,
  ChartContainer,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
  CHART_COLORS,
} from '@/components/charts';
import { AlertBanner, QueryError } from '@/components/feedback';
import type { FleetUtilizationForecast } from '@/api/hooks/useFleetOps';
import { aggregateForecast } from '../helpers';

interface UtilizationForecastChartProps {
  forecast: FleetUtilizationForecast | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function UtilizationForecastChart({
  forecast,
  loading,
  error,
  onRetry,
}: UtilizationForecastChartProps) {
  const { t } = useTranslation();
  const data = aggregateForecast(forecast?.points ?? []);
  const quality = forecast?.quality ?? 'sparse';
  const qualityLabel = {
    sparse: t('fleetOps.forecast.sparse', 'Sparse history'),
    fair: t('fleetOps.forecast.fair', 'Fair confidence'),
    good: t('fleetOps.forecast.good', 'Good confidence'),
  }[quality];
  return (
    <div className="space-y-3">
      {forecast && (
        <AlertBanner
          variant={quality === 'good' ? 'info' : 'warning'}
          title={t('fleetOps.forecast.quality', 'Forecast quality: {{quality}}', { quality: qualityLabel })}
          icon={<AlertTriangle className="h-4 w-4" />}
        >
          {(forecast.limitations ?? []).join(' ')}
        </AlertBanner>
      )}
      {error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.forecast.resource', 'Utilization forecast')} />
      ) : (
        // chart-legend-audit:skip transparent lower offset and uncertainty width form one forecast band around the expected line
        <ChartContainer
          title={t('fleetOps.forecast.title', 'Utilization forecast')}
          subtitle={t('fleetOps.forecast.subtitle', 'Expected daily fleet utilization with uncertainty band')}
          ariaLabel={t('fleetOps.forecast.aria', 'Daily fleet utilization forecast with lower and upper uncertainty bounds')}
          loading={loading}
          empty={data.length === 0}
          height={320}
          chartKey="fleet-ops-utilization"
          data={data}
          dataColumns={[
            { key: 'date', label: t('fleetOps.forecast.date', 'Date') },
            { key: 'expected', label: t('fleetOps.forecast.expected', 'Expected utilization') },
            { key: 'lower', label: t('fleetOps.forecast.lower', 'Lower bound') },
            { key: 'upper', label: t('fleetOps.forecast.upper', 'Upper bound') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTick} />
              <YAxis domain={[0, 100]} unit="%" tick={axisTick} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="lower"
                name={t('fleetOps.forecast.lower', 'Lower bound')}
                stackId="band"
                stroke="none"
                fill="transparent"
              />
              <Area
                type="monotone"
                dataKey="uncertainty"
                name={t('fleetOps.forecast.uncertainty', 'Uncertainty')}
                stackId="band"
                stroke="none"
                fill={CHART_COLORS[1]}
                fillOpacity={0.18}
              />
              <Line
                type="monotone"
                dataKey="expected"
                name={t('fleetOps.forecast.expected', 'Expected utilization')}
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}
    </div>
  );
}
