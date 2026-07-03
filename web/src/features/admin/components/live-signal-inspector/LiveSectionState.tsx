/**
 * Per-section state gate for the Live Signal Inspector.
 *
 * Each data-bound panel on the page owns its own loading / empty / error /
 * "no vehicle selected" affordance rather than gating the whole page behind a
 * single `{data && …}`. This tiny component encapsulates that five-way switch
 * so every panel stays visually consistent (same Skeleton, same EmptyState,
 * same QueryError) without repeating the branch logic.
 */
import { type ReactNode } from 'react';

import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import type { SectionStatus } from './liveSignalStats';

interface LiveSectionStateProps {
  status: SectionStatus;
  /** Raw query error, forwarded to `<QueryError>` on the error branch. */
  error: unknown;
  onRetry: () => void;
  skeletonHeight?: number;
  noVehicleIcon?: ReactNode;
  noVehicleMessage: string;
  emptyIcon?: ReactNode;
  emptyMessage: string;
  children: ReactNode;
}

export function LiveSectionState({
  status,
  error,
  onRetry,
  skeletonHeight = 220,
  noVehicleIcon,
  noVehicleMessage,
  emptyIcon,
  emptyMessage,
  children,
}: LiveSectionStateProps) {
  if (status === 'no-vehicle') {
    return <EmptyState icon={noVehicleIcon} message={noVehicleMessage} />;
  }
  if (status === 'loading') {
    return <Skeleton height={skeletonHeight} />;
  }
  if (status === 'error') {
    return <QueryError error={error} onRetry={onRetry} />;
  }
  if (status === 'empty') {
    return <EmptyState icon={emptyIcon} message={emptyMessage} />;
  }
  return <>{children}</>;
}
