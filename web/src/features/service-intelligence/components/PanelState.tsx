import type { ReactNode } from 'react';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';

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
  if (!selected) {
    return (
      <EmptyState
        /* no-action: the persistent vehicle selector in the page header owns this recovery action. */
        icon={icon}
        title={selectTitle}
        message={selectMessage}
      />
    );
  }
  if (loading) {
    return <Skeleton lines={4} className="py-3" />;
  }
  if (error) {
    return <QueryError error={error} onRetry={onRetry} />;
  }
  if (empty) {
    return (
      <EmptyState
        /* no-action: an empty authoritative inventory has no safe mutation; source links are shown separately. */
        icon={icon}
        title={emptyTitle}
        message={emptyMessage}
      />
    );
  }
  return children;
}
