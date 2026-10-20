import type { ReactNode } from 'react';
import type { DataState } from '@/api/dataState';
import type { RangeProjection } from '@/api/hooks/useAnalytics';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';

export interface RangeSectionProps {
  source: DataState<RangeProjection>;
  loading: boolean;
}

export function RangeSourceSlot({ source, loading, empty, message, height = 160, children }: RangeSectionProps & {
  empty: boolean; message: string; height?: number; children: ReactNode;
}) {
  if (loading && !source.hasData) return <Skeleton height={height} />;
  if (source.fatalError) return <QueryError error={source.fatalError} onRetry={source.retry ?? undefined} />;
  // no-action: Shared page controls own scope and refresh; this projection has no independent configuration.
  if (empty) return <EmptyState message={message} />;
  return <>{children}</>;
}
