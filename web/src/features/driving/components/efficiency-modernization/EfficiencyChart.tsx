import { useTranslation } from 'react-i18next';
import type { ChartContainerProps } from '@/components/charts';
import { StaleRefreshWarning } from '@/components/feedback';
import { ChartCard } from '@/components/layout';
import { useCardPlacement, containerPolicy } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';
import type { SourcePresentation } from './types';

/** Every efficiency plot has tabular observations, already in display units. */
type EfficiencyChartProps = ChartContainerProps & {
  source: SourcePresentation;
  data: NonNullable<ChartContainerProps['data']>;
  dataColumns: NonNullable<ChartContainerProps['dataColumns']>;
};

/** Source trust stays local; the shared frame owns all chart capabilities. */
export function EfficiencyChart({
  source, ariaLabel, data, dataColumns, className,
  exportable = true, size = 'standard', toolbar = true, ...props
}: EfficiencyChartProps) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const height = containerPolicy(placement?.width ?? 0).chartHeight;
  const error = source.state.fatalError ?? (source.malformed
    ? new Error(t('efficiency.state.malformed', 'The source response is malformed; measurements are unavailable.')) : null);
  const loading = !source.state.hasData && source.loading;
  return <div className={cn('min-w-0 max-w-full space-y-3', placement?.className, className)}>
    <StaleRefreshWarning state={source.state} label={props.title}
      title={source.state.status === 'partial' ? t('efficiency.state.partialTitle', 'Incomplete measurements') : undefined}
      message={source.state.status === 'partial' ? t('efficiency.state.partial', 'Some measurements are missing or invalid. Available measurements remain visible.') : undefined} />
    <ChartCard {...props} ariaLabel={ariaLabel} data={data} dataColumns={dataColumns}
      toolbar={toolbar} exportable={exportable} size={size}
      height={height} mobileHeight={height}
      loading={loading} error={error} onRetry={source.state.retry ?? undefined}
      empty={props.empty || (!source.state.hasData && !loading)}
      emptyMessage={source.malformed
        ? t('efficiency.state.malformed', 'The source response is malformed; measurements are unavailable.')
        : !source.state.hasData && !loading
          ? t('efficiency.state.unknown', 'The source has not supplied measurements for this vehicle.')
          : props.emptyMessage} />
  </div>;
}
