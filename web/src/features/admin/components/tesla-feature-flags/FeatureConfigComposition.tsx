import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { PanelTitle } from '@/components/ui/Typography';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ChartTooltip, ChartLegend, EmbeddedChart,
} from '@/components/charts';
import { getChartFontSize } from '@/lib/chartTypography';
import type { FeatureCompositionRow, FeatureFlagKind } from './parseFeatureFlags';

interface FeatureConfigCompositionProps {
  composition: FeatureCompositionRow[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const ENABLED_COLOR = '#10b981';
const DISABLED_COLOR = '#64748b';

/**
 * Grouped bar chart breaking the enabled vs. disabled counts down by
 * feature kind (bare boolean flags vs. configured objects). Independent
 * loading / error / empty handling keeps it self-sufficient in the bento.
 */
export function FeatureConfigComposition({
  composition,
  isLoading,
  error,
  onRetry,
}: FeatureConfigCompositionProps) {
  const { t } = useTranslation();

  const kindLabel = useMemo<Record<FeatureFlagKind, string>>(
    () => ({
      flag: t('featureConfig.type.flag', 'Boolean flags'),
      configured: t('featureConfig.type.configured', 'Configured'),
    }),
    [t],
  );

  const chartData = useMemo(
    () =>
      (composition ?? []).map((row) => ({
        name: kindLabel[row.kind] ?? row.kind,
        enabled: row.enabled ?? 0,
        disabled: row.disabled ?? 0,
      })),
    [composition, kindLabel],
  );

  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('featureConfig.composition', 'Enabled vs Disabled by Type')}
      </PanelTitle>

      <EmbeddedChart
        chartKey="admin-feature-config-composition"
        title={t('featureConfig.composition', 'Enabled vs Disabled by Type')}
        ariaLabel={t('featureConfig.compositionChartLabel', 'Enabled versus disabled feature counts grouped by feature type')}
        loading={isLoading}
        error={error instanceof Error ? error : error ? new Error(String(error)) : undefined}
        onRetry={onRetry}
        empty={!error && !isLoading && chartData.length === 0}
        emptyMessage={t('featureConfig.noComposition', 'No feature composition to chart yet.')}
        data={chartData}
        dataColumns={[
          { key: 'name', label: t('featureConfig.type.label', 'Type') },
          { key: 'enabled', label: t('featureConfig.enabled', 'Enabled') },
          { key: 'disabled', label: t('featureConfig.disabled', 'Disabled') },
        ]}
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barGap={6}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: getChartFontSize(12) }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: getChartFontSize(10) }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--glass-border)', fillOpacity: 0.2 }} />
              <ChartLegend />
              <Bar
                dataKey="enabled"
                name={t('featureConfig.enabled', 'Enabled')}
                fill={ENABLED_COLOR}
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
                hide={hiddenSeries?.isHidden('enabled') ?? false}
              />
              <Bar
                dataKey="disabled"
                name={t('featureConfig.disabled', 'Disabled')}
                fill={DISABLED_COLOR}
                fillOpacity={0.7}
                radius={[4, 4, 0, 0]}
                hide={hiddenSeries?.isHidden('disabled') ?? false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </EmbeddedChart>
    </GlassPanel>
  );
}
