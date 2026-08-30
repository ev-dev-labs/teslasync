import type { ComponentProps } from 'react';
import { ChartContainer } from '@/components/charts';

type ChartContainerProps = ComponentProps<typeof ChartContainer>;

type AnalyticsChartPanelProps = Omit<
  ChartContainerProps,
  'empty' | 'loading'
> & {
  loading?: boolean;
  isEmpty?: boolean;
};

/**
 * Analytics-specific chart frame. It keeps the tabs' query-state vocabulary
 * while inheriting responsive sizing, contained failures, accessible fallback
 * data, export, and fullscreen from the shared chart contract.
 */
export function AnalyticsChartPanel({
  loading,
  isEmpty,
  data,
  dataColumns,
  exportData,
  ariaLabel,
  fullscreen = true,
  ...props
}: AnalyticsChartPanelProps) {
  return (
    <ChartContainer
      {...props}
      loading={loading}
      empty={isEmpty}
      data={data}
      dataColumns={dataColumns}
      exportData={exportData ?? data}
      ariaLabel={ariaLabel}
      fullscreen={fullscreen}
    />
  );
}
