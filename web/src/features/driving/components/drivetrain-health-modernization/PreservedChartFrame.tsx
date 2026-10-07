import type { ComponentProps } from 'react';
import type { DataState } from '@/api/dataState';
import type { ChartContainer } from '@/components/charts';
import { ChartCard } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { containerPolicy, useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

// Every chart hosted here has a tabular time series. Keep this contract required
// at each caller rather than allowing an unsubstantiated no-table escape hatch.
type Props = ComponentProps<typeof ChartContainer>
  & Required<Pick<ComponentProps<typeof ChartContainer>, 'data' | 'dataColumns'>>
  & { state: DataState<unknown> };

/** Keep source trust and placement local while reusing the complete chart frame. */
export function PreservedChartFrame({
  state, className, height, ariaLabel, ariaDescription, data, dataColumns,
  exportable = true, size = 'standard', toolbar = true, ...props
}: Props) {
  const placement = useCardPlacement();
  const responsiveHeight = containerPolicy(placement?.width ?? 0).chartHeight;
  return <div className={cn('min-w-0', placement?.className ?? 'col-span-1', className)}>
    <StaleRefreshWarning state={state} label={props.title} />
    <ChartCard {...props} height={height} mobileHeight={responsiveHeight}
      toolbar={toolbar} exportable={exportable} size={size}
      ariaLabel={ariaLabel} ariaDescription={ariaDescription}
      data={data} dataColumns={dataColumns}
      error={state.fatalError ?? undefined} onRetry={state.retry ?? undefined} />
  </div>;
}
