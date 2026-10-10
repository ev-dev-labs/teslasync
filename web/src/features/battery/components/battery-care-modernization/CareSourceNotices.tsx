import {
  DataStateNotice,
  QueryError,
  StaleRefreshWarning,
} from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import type { CareSectionState } from './state';

/** Independent sources stay identifiable even when their composite is partial. */
export function CareSourceNotices({ state }: { state: CareSectionState }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-3">
      {state.sources.map(source => (
        <div key={source.label} aria-label={source.label} className="min-w-0">
          <StaleRefreshWarning state={source.state} label={source.label} />
          {state.trust.hasData && source.state.fatalError ? (
            <QueryError error={source.state.fatalError} onRetry={source.state.retry ?? undefined} />
          ) : null}
          {!source.state.hasData && source.state.isRefreshBlocked ? (
            <DataStateNotice
              state="unavailable"
              title={source.label}
              role="status"
            >
              {t(
                'batteryCare.sources.paused',
                'This source is paused while offline. No observations have been received yet.',
              )}
            </DataStateNotice>
          ) : null}
          {state.trust.hasData && !source.state.hasData && !source.state.fatalError && !source.state.isRefreshBlocked ? (
            <DataStateNotice state="partial" title={source.label} role="status" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
