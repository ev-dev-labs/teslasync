import type { ComponentProps } from 'react';
import { ChartCard, LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';

type FleetTrendCardProps = ComponentProps<typeof ChartCard> & {
  hasData: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyMessage: string;
};

/** ChartCard and its empty/loading/error sibling each own exactly one shell. */
export function FleetTrendCard({
  hasData, loading, error, onRetry, emptyMessage, title, ...chart
}: FleetTrendCardProps) {
  if (!hasData) {
    return (
      <LayoutCard title={title}>
        {loading ? <Skeleton height={260} /> : error ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : <EmptyState message={emptyMessage} />}
      </LayoutCard>
    );
  }
  return (
    <ChartCard
      {...chart}
      title={title}
      footer={error ? <QueryError error={error} onRetry={onRetry} /> : undefined}
    />
  );
}
