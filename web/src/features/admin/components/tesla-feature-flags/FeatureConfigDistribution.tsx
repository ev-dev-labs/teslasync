import { useTranslation } from 'react-i18next';
import { PieChart as PieChartIcon } from 'lucide-react';

import { GlassPanel, Badge } from '@/components/ui';
import { PanelTitle, Caption } from '@/components/ui/Typography';
import { RadialGauge } from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { fmtInt, safeNumber } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import type { FeatureFlagSummary } from './parseFeatureFlags';

interface FeatureConfigDistributionProps {
  summary: FeatureFlagSummary;
  fetchedAt: string | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Enabled-rate gauge from the Okabe-Ito-inspired green series color. */
const GAUGE_COLOR = '#10b981';

/**
 * Overview panel that visualises the enabled ratio as a radial gauge plus
 * enabled/disabled count chips, and surfaces the last sync timestamp. Owns
 * its own loading / error / empty states so it is safe to drop into the
 * bento grid independently of the sibling panels.
 */
export function FeatureConfigDistribution({
  summary,
  fetchedAt,
  isLoading,
  error,
  onRetry,
}: FeatureConfigDistributionProps) {
  const { t } = useTranslation();

  // Defensive normalisation. The parent always hands us a well-formed
  // summary from `summarizeFeatureEntries`, but a partial/malformed object
  // (or a future caller) must degrade to zeros + the empty state rather than
  // throw a TypeError mid-render — this panel owns its own states and must
  // never crash the surrounding bento grid.
  const total = safeNumber(summary?.total);
  const enabled = safeNumber(summary?.enabled);
  const disabled = safeNumber(summary?.disabled);
  const enabledRate = safeNumber(summary?.enabledRate);

  return (
    <GlassPanel className="flex h-full flex-col p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <PieChartIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('featureConfig.distribution', 'Distribution')}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={200} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : total === 0 ? (
        <EmptyState
          /* no-action: transient — no feature-config synced yet; the header Refresh CTA owns recovery */
          icon={<PieChartIcon className="h-8 w-8" aria-hidden="true" />}
          message={t('featureConfig.noDistribution', 'No feature data to summarise yet.')}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-2">
          <RadialGauge
            value={enabledRate}
            max={100}
            unit="%"
            decimals={0}
            color={GAUGE_COLOR}
            size={148}
            label={t('featureConfig.kpi.enabledRate', 'Enabled Rate')}
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="success" dot>
              {t('featureConfig.enabled', 'Enabled')}: {fmtInt(enabled)}
            </Badge>
            <Badge variant="neutral" dot>
              {t('featureConfig.disabled', 'Disabled')}: {fmtInt(disabled)}
            </Badge>
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-center">
        <Caption>
          {fetchedAt
            ? `${t('featureConfig.lastSynced', 'Synced')} ${formatDateTime(fetchedAt)}`
            : t('featureConfig.neverSynced', 'Not synced yet')}
        </Caption>
      </div>
    </GlassPanel>
  );
}
