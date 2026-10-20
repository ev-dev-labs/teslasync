import {
  AlertBanner,
  DataStateNotice,
  QueryError,
  StaleRefreshWarning,
} from '@/components/feedback';
import { Button, Text } from '@/components/ui';
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
          {source.state.fatalError && !state.trust.fatalError ? (
            <QueryError error={source.state.fatalError} onRetry={source.state.retry ?? undefined} />
          ) : null}
          {!source.state.hasData && source.state.isRefreshBlocked ? (
            <AlertBanner
              variant="info"
              title={source.label}
              role="status"
            >
              <Text as="p" variant="bodySm">
                {t('dataSources.status.paused', 'Refresh paused')}
              </Text>
              <Text as="p" variant="bodySm">
                {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
              </Text>
              {source.state.retry ? (
                <Button type="button" variant="ghost" onClick={source.state.retry}>
                  {t('common.retry', 'Retry')}
                </Button>
              ) : null}
            </AlertBanner>
          ) : null}
          {state.trust.hasData && !source.state.hasData && !source.state.fatalError && !source.state.isRefreshBlocked ? (
            <DataStateNotice state="partial" title={source.label} role="status" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
