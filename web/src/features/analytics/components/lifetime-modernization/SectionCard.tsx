import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard, SourceContent } from '@/components/layout';
import { Skeleton } from '@/components/feedback';

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
  const { t } = useTranslation();
  return (
    <LayoutCard title={title} actions={<>{icon}{headerExtra}</>}>
      <SourceContent
        state={state}
        label={title}
        emptyMessage={emptyMessage}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={error}
        errorRecovery={{ onRetry }}
        loadingContent={<Skeleton height={skeletonHeight} />}
      >
        {children}
      </SourceContent>
    </LayoutCard>
  );
}
