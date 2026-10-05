import type { ReactNode } from 'react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';

export type SectionState = 'loading' | 'error' | 'empty' | 'ready' | 'retained';

/** Persistent source shell. Refresh failure supplements, never replaces, data. */
export function SectionCard({
  title, icon, state, error, onRetry, emptyMessage,
  skeletonHeight = 132, headerExtra, children,
}: {
  title: string;
  icon: ReactNode;
  state: SectionState;
  error?: unknown;
  onRetry?: () => void;
  emptyMessage: string;
  skeletonHeight?: number;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <LayoutCard title={title} actions={<>{icon}{headerExtra}</>}>
      {state === 'loading' ? (
        <Skeleton height={skeletonHeight} />
      ) : state === 'error' ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (
        <>
          {state === 'retained' && <QueryError error={error} onRetry={onRetry} />}
          {state === 'empty' ? (
            <EmptyState /* no-action: no source data; no specific recovery action */
              message={emptyMessage}
            />
          ) : children}
        </>
      )}
    </LayoutCard>
  );
}
