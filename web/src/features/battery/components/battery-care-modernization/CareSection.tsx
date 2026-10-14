import type { ReactNode } from 'react';
import { LayoutCard } from '@/components/layout';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <LayoutCard title={title} description={description} actions={badge}>
      <section aria-label={title} data-testid={testId} className="min-w-0 space-y-4">
        <CareSourceNotices state={state} />
        {trust.fatalError ? (
          <QueryError error={trust.fatalError} onRetry={trust.retry ?? undefined} />
        ) : state.isInitialLoading ? (
          <Skeleton height={loadingHeight} className="rounded-xl" />
        ) : !trust.hasData ? (
          <Text as="p" variant="bodySm">
            {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
          </Text>
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
