import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, Skeleton } from '@/components/feedback';
import { SourceContent } from '@/components/layout';

export interface PanelStateProps {
  selected: boolean;
  loading: boolean;
  error: unknown;
  empty: boolean;
  icon: ReactNode;
  selectTitle: string;
  selectMessage: string;
  emptyTitle: string;
  emptyMessage: string;
  onRetry: () => void;
  children: ReactNode;
}

export function PanelState({
  selected,
  loading,
  error,
  empty,
  icon,
  selectTitle,
  selectMessage,
  emptyTitle,
  emptyMessage,
  onRetry,
  children,
}: PanelStateProps) {
  const { t } = useTranslation();
  const emptyContent = !selected ? (
      <EmptyState
        /* no-action: the persistent vehicle selector in the page header owns this recovery action. */
        icon={icon}
        title={selectTitle}
        message={selectMessage}
      />
    ) : (
      <EmptyState
        /* no-action: an empty authoritative inventory has no safe mutation; source links are shown separately. */
        icon={icon}
        title={emptyTitle}
        message={emptyMessage}
      />
    );
  return (
    <SourceContent
      state={!selected ? 'empty' : loading ? 'loading' : error ? 'error' : empty ? 'empty' : 'ready'}
      label={emptyTitle || selectTitle}
      emptyMessage={emptyMessage}
      errorMessage={t('serviceIntelligence.common.loadError', 'This source could not be loaded.')}
      error={error}
      errorRecovery={{ onRetry }}
      loadingContent={<Skeleton lines={4} className="py-3" />}
      emptyContent={emptyContent}
    >
      {children}
    </SourceContent>
  );
}
