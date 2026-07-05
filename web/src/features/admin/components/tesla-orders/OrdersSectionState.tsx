/**
 * Per-section state gate for the Tesla Orders page.
 *
 * Each data-bound panel owns its own loading / empty / error affordance rather
 * than gating the whole page behind a single `{data && …}` (design-language
 * §8). This tiny component encapsulates the four-way switch so every panel
 * stays visually consistent (same Skeleton, same EmptyState, same QueryError)
 * without repeating the branch logic.
 */
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import type { OrderSectionStatus } from './teslaOrderStats';

interface OrdersSectionStateProps {
  status: OrderSectionStatus;
  /** Raw query error, forwarded to `<QueryError>` on the error branch. */
  error: unknown;
  onRetry: () => void;
  skeletonHeight?: number;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyMessage: string;
  /**
   * Optional recovery CTA for the empty branch (e.g. "Refresh from Tesla").
   * When omitted the empty panel is an informational dead-end with just a
   * message — still rendered so the section never disappears.
   */
  emptyAction?: { label: string; onClick: () => void };
  children: ReactNode;
}

export function OrdersSectionState({
  status,
  error,
  onRetry,
  skeletonHeight = 220,
  emptyIcon,
  emptyTitle,
  emptyMessage,
  emptyAction,
  children,
}: OrdersSectionStateProps) {
  const { t } = useTranslation();

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
        error={error ?? new Error('Orders request failed')}
        onRetry={onRetry}
        resourceName={t('admin.teslaOrders.resource', 'Orders')}
      />
    );
  }
  if (status === 'empty') {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        message={emptyMessage}
        action={emptyAction}
      />
    );
  }
  return <>{children}</>;
}
