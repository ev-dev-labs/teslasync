import type { ReactNode } from 'react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { CareSourceNotices } from './CareSourceNotices';
import type { CareSectionState } from './state';

interface CareSectionProps {
  title: string;
  description: string;
  icon: ReactNode;
  emptyMessage: string;
  hasData: boolean;
  state: CareSectionState;
  badge?: ReactNode;
  testId: string;
  children: ReactNode;
  loadingHeight?: number;
}

/** The panel, title, description/help and source notices are always mounted. */
export function CareSection({
  title,
  description,
  icon,
  emptyMessage,
  hasData,
  state,
  badge,
  testId,
  children,
  loadingHeight = 240,
}: CareSectionProps) {
  const { trust } = state;
  return (
    <LayoutCard title={title} description={description} actions={badge}>
      <section aria-label={title} data-testid={testId} className="min-w-0 space-y-4">
        <CareSourceNotices state={state} />
        {trust.fatalError ? (
          <QueryError error={trust.fatalError} onRetry={trust.retry ?? undefined} />
        ) : !trust.hasData ? (
          <Skeleton height={loadingHeight} className="rounded-xl" />
        ) : !hasData ? (
          <EmptyState /* no-action: observed telemetry, not a page-local filter, determines eligibility */
            className="min-h-52"
            icon={icon}
            message={emptyMessage}
          />
        ) : children}
      </section>
    </LayoutCard>
  );
}
