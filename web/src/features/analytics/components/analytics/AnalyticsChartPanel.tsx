import type { ComponentProps } from 'react';
import { ChartCard } from '@/components/layout';

type ChartContainerProps = ComponentProps<typeof ChartCard>;

type AnalyticsChartPanelProps = Omit<
  ChartContainerProps,
  'empty' | 'loading'
> & {
  loading?: boolean;
  isEmpty?: boolean;
  className?: string;
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
  exportable = true,
  size = 'standard',
  className,
  ...props
}: AnalyticsChartPanelProps) {
  return (
    <div className={className}>
    <ChartCard
      {...props}
      loading={loading}
      empty={isEmpty}
      data={data}
      dataColumns={dataColumns}
      exportData={exportData ?? data}
      ariaLabel={ariaLabel}
      fullscreen={fullscreen}
      exportable={exportable}
      size={size}
    />
    </div>
  );
}
