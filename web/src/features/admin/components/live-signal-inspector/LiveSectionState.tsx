/**
 * Per-section state gate for the Live Signal Inspector.
 *
 * Each data-bound panel on the page owns its own loading / empty / error /
 * "no vehicle selected" affordance rather than gating the whole page behind a
 * single `{data && …}`. Shared source slots retain specialist geometry and
 * prerequisites, including retained empty snapshots; fatal errors keep the
 * full status-specific recovery surface.
 */
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import type { SectionStatus } from './liveSignalStats';

interface LiveSectionStateProps {
  status: SectionStatus;
  label?: string;
  /** Fatal query error, forwarded to `<QueryError>` on the error branch. */
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
  label,
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
  if (status === 'error') {
    // Keep the full status-specific permission/offline guidance; SourceContent's
    // compact error body intentionally omits those specialist recovery details.
    return (
      <QueryError
        error={error ?? new Error('Live signal request failed')}
        onRetry={onRetry}
      />
    );
  }
  const emptyBody = status === 'no-vehicle'
    // no-action: the page toolbar owns vehicle selection; retrying without a vehicle cannot load a snapshot.
    ? <EmptyState icon={noVehicleIcon} message={noVehicleMessage} />
    : (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage}
        action={{ label: t('common.retry', 'Retry'), onClick: onRetry }}
      />
    );
  return (
    <SourceContent
      state={status === 'no-vehicle' ? 'empty' : status === 'retained-empty' ? 'retained' : status}
      label={label ?? t('admin.liveSignals.panels.snapshot', 'Live snapshot')}
      emptyMessage={emptyMessage}
      errorMessage={t('error.loadFailed', 'Failed to load data')}
      loadingContent={<Skeleton height={skeletonHeight} />}
      emptyContent={emptyBody}
      errorRecovery={status === 'retained-empty' ? undefined : { onRetry }}
    >
      {status === 'retained-empty' ? emptyBody : children}
    </SourceContent>
  );
}
