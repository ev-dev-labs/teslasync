import { createContext, useContext, type ReactNode } from 'react';
import type { DataState } from '@/api/dataState';
import { useTranslation } from 'react-i18next';
import { EmptyState, Skeleton } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { Text } from '@/components/ui';

type PanelSourceState = Pick<DataState<unknown>, 'status' | 'isRefreshBlocked'>;

// Existing panel adapters keep their props; the page supplies their shared source.
export const PanelSourceContext = createContext<PanelSourceState | null>(null);

export interface PanelStateProps {
  source?: PanelSourceState | null;
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
  source,
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
  const inheritedSource = useContext(PanelSourceContext);
  const sourceState = source === undefined ? inheritedSource : source;
  const initial = selected && sourceState?.status === 'initial';
  const paused = initial && sourceState.isRefreshBlocked;
  const waitingContent = (
    <Text as="p" variant="bodySm" color="secondary" role="status" aria-live="polite">
      {paused && <>{t('energyFlow.state.pausedTitle', 'Source paused')}{' '}</>}
      {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
    </Text>
  );
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
      state={!selected ? 'empty' : paused ? 'empty' : initial || loading ? 'loading' : error ? 'error' : empty ? 'empty' : 'ready'}
      label={emptyTitle || selectTitle}
      emptyMessage={emptyMessage}
      errorMessage={t('serviceIntelligence.common.loadError', 'This source could not be loaded.')}
      error={error}
      errorRecovery={{ onRetry }}
      loadingContent={<>{initial && waitingContent}<Skeleton lines={4} className="py-3" /></>}
      emptyContent={paused ? waitingContent : emptyContent}
    >
      {children}
    </SourceContent>
  );
}
