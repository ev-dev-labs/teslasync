import { useTranslation } from 'react-i18next';
import { ChartContainer, type ChartContainerProps } from '@/components/charts';
import { StaleRefreshWarning } from '@/components/feedback';
import { useCardPlacement, containerPolicy } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';
import type { SourcePresentation } from './types';

/**
 * Placement/trust only, not a second chart controller. ChartCard's EmbeddedChart
 * disables export/fullscreen and cannot accept annotations; use the original
 * full ChartContainer until that shared adapter has exact capability parity.
 */
export function EfficiencyChart({
  source, ...props
}: ChartContainerProps & { source: SourcePresentation }) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const height = containerPolicy(placement?.width ?? 0).chartHeight;
  const error = source.state.fatalError ?? (source.malformed
    ? new Error(t('efficiency.state.malformed', 'The source response is malformed; measurements are unavailable.')) : null);
  const loading = !source.state.hasData && source.loading;
  return <div className={cn('min-w-0 max-w-full space-y-3', placement?.className)}>
    <StaleRefreshWarning state={source.state} label={props.title}
      title={source.state.status === 'partial' ? t('efficiency.state.partialTitle', 'Incomplete measurements') : undefined}
      message={source.state.status === 'partial' ? t('efficiency.state.partial', 'Some measurements are missing or invalid. Available measurements remain visible.') : undefined} />
    <ChartContainer {...props} height={height} mobileHeight={height}
      loading={loading} error={error} onRetry={source.state.retry ?? undefined}
      empty={props.empty || (!source.state.hasData && !loading)}
      emptyMessage={source.malformed
        ? t('efficiency.state.malformed', 'The source response is malformed; measurements are unavailable.')
        : !source.state.hasData && !loading
          ? t('efficiency.state.unknown', 'The source has not supplied measurements for this vehicle.')
          : props.emptyMessage} />
  </div>;
}
