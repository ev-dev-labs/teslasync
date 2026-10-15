import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '../Button';
import { Text } from '../Typography';
import type { MobileGridCallbacks, MobileState } from './types';

interface Props { state: MobileState; callbacks: Partial<Pick<MobileGridCallbacks, 'onRetry' | 'onClear'>>; production?: boolean }
export function MobileReferenceState({ state, callbacks, production = false }: Props) {
  const { t } = useTranslation();
  if (state.kind === 'ready') return null;
  if (state.kind === 'loading') return (
    <div role="status" aria-label={production ? t('common.loading', 'Loading...') : t('developerReference.mobileGrid.states.loading', 'Loading reference rows')} aria-busy="true">
      {[0, 1, 2].map(key => (
        <div key={key} data-grid-skeleton="" className="mgr-skeleton border-b border-[var(--border-subtle)] p-3 last:border-b-0">
          <Skeleton className="w-3/4 motion-reduce:animate-none" />
          <Skeleton className="mt-4 w-1/2 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
  if (state.kind === 'empty') return (
    <EmptyState className="mgr-state !py-8 [&_button]:min-h-11" message={state.message}
      action={state.action ? { label: state.action.label, onClick: state.action.onAction } : undefined} />
  );
  if (state.kind === 'noMatch') return (
    <EmptyState className="mgr-state !py-8 [&_button]:min-h-11"
      message={t('developerReference.mobileGrid.states.noMatch', 'Nothing matches “{{query}}”', { query: state.query })}
      action={callbacks.onClear ? { label: t('developerReference.mobileGrid.actions.clear', 'Clear'), onClick: callbacks.onClear } : undefined} />
  );
  return (
    <div role="alert" className="mgr-state flex flex-wrap items-center justify-between gap-2 p-3">
      <Text className="min-w-0 break-words">{state.message}</Text>
      {callbacks.onRetry && <Button variant="secondary" className="min-h-11 min-w-11" loading={state.retrying} onClick={callbacks.onRetry}>
        {production ? t('common.retry', 'Retry') : t('developerReference.mobileGrid.actions.retry', 'Retry')}
      </Button>}
    </div>
  );
}
