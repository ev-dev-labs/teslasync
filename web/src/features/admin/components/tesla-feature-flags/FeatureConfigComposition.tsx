import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { PanelTitle } from '@/components/ui/Typography';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ChartTooltip,
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

      {isLoading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading', 'Loading')}>
          <Skeleton height={224} />
        </div>
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : chartData.length === 0 ? (
        <EmptyState
          /* no-action: transient — no feature-config rows to chart; header Refresh CTA owns recovery */
          icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
          message={t('featureConfig.noComposition', 'No feature composition to chart yet.')}
        />
      ) : (
        <div
          className="h-56 sm:h-64 xl:h-72"
          role="img"
          aria-label={t('featureConfig.compositionChartLabel', 'Enabled versus disabled feature counts grouped by feature type')}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barGap={6}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: getChartFontSize(12) }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: getChartFontSize(10) }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--glass-border)', fillOpacity: 0.2 }} />
              <Legend wrapperStyle={{ fontSize: getChartFontSize(12) }} />
              <Bar
                dataKey="enabled"
                name={t('featureConfig.enabled', 'Enabled')}
                fill={ENABLED_COLOR}
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="disabled"
                name={t('featureConfig.disabled', 'Disabled')}
                fill={DISABLED_COLOR}
                fillOpacity={0.7}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </GlassPanel>
  );
}
