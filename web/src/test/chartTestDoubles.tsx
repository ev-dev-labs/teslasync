import type { ReactNode } from 'react';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';

interface EmbeddedChartTestContext {
  hiddenSeries: {
    isHidden: (key: string) => boolean;
  };
}

interface EmbeddedChartTestProps {
  ariaLabel?: string;
  chartKey?: string;
  children?: ReactNode | ((context: EmbeddedChartTestContext) => ReactNode);
  empty?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyDescription?: string;
  error?: unknown;
  loading?: boolean;
  onRetry?: () => void;
  height?: number;
  mobileHeight?: number;
  fluid?: boolean;
}

function EmbeddedChartTestDouble({
  ariaLabel,
  chartKey,
  children,
  empty = false,
  emptyTitle,
  emptyMessage,
  emptyDescription,
  error,
  loading = false,
  onRetry,
  height,
  mobileHeight,
  fluid,
}: EmbeddedChartTestProps) {
  const resolvedFluid = fluid ?? (height == null && mobileHeight == null);
  const content =
    typeof children === 'function'
      ? children({ hiddenSeries: { isHidden: () => false } })
      : children;

  if (loading) return <Skeleton height={220} />;
  if (error) return <QueryError error={error} onRetry={onRetry} />;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid="embedded-chart"
      data-chart-key={chartKey}
      data-chart-height={height}
      data-chart-mobile-height={mobileHeight}
      data-chart-fluid={resolvedFluid}
    >
      {empty ? (
        <EmptyState
          title={emptyTitle}
          message={emptyMessage ?? 'No data available'}
          description={emptyDescription}
        />
      ) : content}
    </div>
  );
}

function ChartLegendTestDouble() {
  return <div data-testid="chart-legend" />;
}

function ChartTooltipTestDouble() {
  return <div data-testid="chart-tooltip" />;
}

export const chartTestDoubles = {
  EmbeddedChart: EmbeddedChartTestDouble,
  ChartLegend: ChartLegendTestDouble,
  ChartTooltip: ChartTooltipTestDouble,
};
