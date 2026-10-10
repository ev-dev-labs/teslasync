import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { ErrorDisplay, StaleRefreshWarning } from '@/components/feedback';
import { Button } from '@/components/ui';

/** Source-local recovery never replaces retained measurements or neighboring sources. */
export function SourceRecovery({ state, label }: { state: DataState<unknown>; label: string }) {
  const { t } = useTranslation();
  if (!state.fatalError && !state.refreshError && !state.isRefreshBlocked) return null;
  return (
    <div role="group" aria-label={label} className="min-w-0 space-y-3">
      {state.fatalError ? (
        <ErrorDisplay
          compact
          error={state.fatalError}
          resourceName={label}
          message={t('vampireDrain.modernization.sourceFailure', '{{source}} could not be loaded. Please try again.', { source: label })}
        />
      ) : (
        <StaleRefreshWarning state={state} label={label} hideRetry />
      )}
      {state.retry && (
        <Button
          variant="secondary"
          className="min-h-11 max-w-full whitespace-normal"
          onClick={state.retry}
          disabled={state.isRefreshing}
        >
          {t('vampireDrain.modernization.retrySource', 'Retry {{source}}', { source: label })}
        </Button>
      )}
    </div>
  );
}
