import { Bar, BarChart, CartesianGrid, CHART_COLORS, ChartContainer, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { Sigma } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatDisplayIntensity, formatIntensityWhPerM, toDisplayIntensity } from './formatters';

export function SeasonalResidualDistribution({
  analysis,
  state,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const diagnosticTiles = [
    {
      key: 'p10',
      label: t('seasonalEfficiency.residual.p10', 'P10 residual'),
      value: analysis.diagnostics.residualP10WhPerM,
    },
    {
      key: 'p50',
      label: t('seasonalEfficiency.residual.p50', 'P50 residual'),
      value: analysis.diagnostics.residualP50WhPerM,
    },
    {
      key: 'p90',
      label: t('seasonalEfficiency.residual.p90', 'P90 residual'),
      value: analysis.diagnostics.residualP90WhPerM,
    },
    {
      key: 'rmse',
      label: t('seasonalEfficiency.residual.rmse', 'Weighted RMSE'),
      value: analysis.diagnostics.weightedRmseWhPerM,
    },
  ];
  const data = analysis.residualHistogram.map((bin) => ({
    key: bin.key,
    center: toDisplayIntensity(bin.centerWhPerM, units.unitPrefs),
    samples: bin.sampleCount,
    distanceShare: 0,
  }));
  const totalDistance = Number.isFinite(analysis.totalDistanceM) && analysis.totalDistanceM > 0
    ? analysis.totalDistanceM
    : 0;
  const chartData = data.map((row, index) => {
    const distanceM = analysis.residualHistogram[index]?.distanceM ?? 0;
    const distanceShare = totalDistance > 0 && Number.isFinite(totalDistance)
      ? Math.max(0, Math.min(100, (100 * distanceM) / totalDistance))
      : 0;
    return { ...row, distanceShare };
  });
  return (
    <section data-testid="seasonal-residual-distribution">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Sigma className="h-4 w-4 text-purple-300" aria-hidden="true" />
          {t('seasonalEfficiency.residual.title', 'Residual distribution')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t('seasonalEfficiency.residual.subtitle', 'Residuals are observed intensity minus fitted intensity; the histogram shows each bin’s share of included distance, not an attributed cause.')}
        </Text>
        <SeasonalSectionBody state={state} requirement="fit" fitStatus={analysis.fit.status}>
          {chartData.length === 0 ? (
            <EmptyState message={t('seasonalEfficiency.residual.empty', 'No finite fitted residuals are available.')} />
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {diagnosticTiles.map(({ key, label, value }) => (
                  <div key={key} className="rounded-lg border border-[var(--panel-border)] p-3">
                    <Text variant="metricLabel">{label}</Text>
                    <Text variant="bodySm" as="p">{formatIntensityWhPerM(value, units.unitPrefs)}</Text>
                  </div>
                ))}
              </div>
              <ChartContainer
                title={t('seasonalEfficiency.residual.chartTitle', 'Distance share by residual bin')}
                ariaLabel={t('seasonalEfficiency.residual.aria', 'Histogram of included distance share by fitted residual bin')}
                height={260}
                data={chartData}
                dataColumns={[
                  { key: 'key', label: t('seasonalEfficiency.residual.bin', 'Residual bin') },
                  { key: 'center', label: t('seasonalEfficiency.residual.center', 'Bin center'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
                  { key: 'distanceShare', label: t('seasonalEfficiency.residual.distanceShare', 'Distance share (%)'), format: (value) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—' },
                  { key: 'samples', label: t('seasonalEfficiency.residual.samples', 'Samples') },
                ]}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="key" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      tickFormatter={(value) => `${value}%`}
                      label={{
                        value: t('seasonalEfficiency.residual.distanceShareAxis', 'Distance share (%)'),
                        angle: -90,
                        position: 'insideLeft',
                      }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="distanceShare" name={t('seasonalEfficiency.residual.distanceShare', 'Distance share (%)')} fill={CHART_COLORS[3]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </>
          )}
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
