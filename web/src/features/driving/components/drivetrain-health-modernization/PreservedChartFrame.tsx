import type { ComponentProps } from 'react';
import type { DataState } from '@/api/dataState';
import { ChartContainer } from '@/components/charts';
import { StaleRefreshWarning } from '@/components/feedback';
import { containerPolicy, useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

type Props = ComponentProps<typeof ChartContainer> & { state: DataState<unknown> };

/** ChartCard/EmbeddedChart suppress the original toolbar. Keep the canonical
 * full chart frame and apply only the reviewed shared placement/height policy. */
export function PreservedChartFrame({ state, className, height, ...props }: Props) {
  const placement = useCardPlacement();
  const responsiveHeight = containerPolicy(placement?.width ?? 0).chartHeight;
  return <div className={cn('min-w-0', placement?.className ?? 'col-span-1', className)}>
    <StaleRefreshWarning state={state} label={props.title} />
    <ChartContainer {...props} height={height} mobileHeight={responsiveHeight}
      error={state.fatalError ?? undefined} onRetry={state.retry ?? undefined}
      className="h-full min-w-0" />
  </div>;
}
