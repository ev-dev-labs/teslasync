import type { ReactNode } from 'react';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Heading } from '@/components/ui';

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
  title?: string;
  titleId?: string;
  visibleTitle?: boolean;
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
  title,
  titleId,
  visibleTitle,
}: EmbeddedChartTestProps) {
  const resolvedFluid = fluid ?? (height == null && mobileHeight == null);
  const content =
    typeof children === 'function'
      ? children({ hiddenSeries: { isHidden: () => false } })
      : children;

  return (
    <>
      {visibleTitle && <Heading id={titleId} level="panel" data-card-title>{title}</Heading>}
      {loading ? <Skeleton height={220} /> : error ? <QueryError error={error} onRetry={onRetry} /> : (
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
      )}
    </>
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

/**
 * Recharts cartesian children (axes, grid, tooltip, legend, brush) require the
 * chart context. Tests that replace the chart container with a DOM double can
 * spread these to keep the real children inert instead of throwing.
 */
export const inertCartesianParts = {
  XAxis: () => null,
  YAxis: () => null,
  ZAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Brush: () => null,
};
