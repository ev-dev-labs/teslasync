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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  if (status === 'no-vehicle') {
    // no-action: the vehicle selector lives in the page header above every
    // panel — retrying is meaningless while the query stays `enabled: false`.
    return <EmptyState icon={noVehicleIcon} message={noVehicleMessage} />;
  }
  if (status === 'loading') {
    return <Skeleton height={skeletonHeight} />;
  }
  if (status === 'error') {
    // `QueryError` renders nothing when `error` is falsy, which would leave the
    // panel blank — the one outcome this component exists to prevent. Fall back
    // to a generic error so the error affordance (with its Retry CTA) is always
    // shown even if a caller flags `status="error"` without an error object.
    return (
      <QueryError
        error={error ?? new Error('Live signal request failed')}
        onRetry={onRetry}
      />
    );
  }
  if (status === 'empty') {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage}
        action={{ label: t('common.retry', 'Retry'), onClick: onRetry }}
      />
    );
  }
  return <>{children}</>;
}
