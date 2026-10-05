import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertBanner, EmptyState, ErrorDisplay, Skeleton } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';

/** Presentation facts only. Query/cache/cancellation ownership stays in API hooks. */
export interface TimelineSourceFacts {
  enabled: boolean;
  available: boolean;
  loading: boolean;
  paused: boolean;
  error: unknown;
}

export interface TimelineSourceProps {
  source: TimelineSourceFacts;
  label: string;
  children: ReactNode;
}

/** Render a source inside its permanent panel, never hide independent neighbors. */
export function TimelineSource({ source, label, children }: TimelineSourceProps) {
  const { t } = useTranslation();
  if (!source.available) {
    if (!source.enabled) {
      return <EmptyState message={t('timeline.source.selectVehicle', 'Select a vehicle to view its state history')} />;
    }
    if (source.error) {
      return <>
        <ErrorDisplay compact error={source.error} resourceName={label}
          message={`${t('timeline.source.failed', 'Unable to load {{section}}', { section: label })}: ${getErrorMessage(source.error)}`} />
        {source.paused && <AlertBanner variant="info">
          {t('timeline.source.paused', '{{section}} is paused while the connection is unavailable', { section: label })}
        </AlertBanner>}
      </>;
    }
    if (source.paused) {
      return <EmptyState message={t('timeline.source.paused', '{{section}} is paused while the connection is unavailable', { section: label })} />;
    }
    if (source.loading) {
      return <div role="status" aria-label={t('timeline.source.loading', 'Loading {{section}}', { section: label })}>
        <Skeleton className="h-24 w-full" />
      </div>;
    }
    return <EmptyState message={t('timeline.source.unknown', '{{section}} is unavailable because the response did not contain the expected records', { section: label })} />;
  }
  return <>
    {Boolean(source.error) && (
      <AlertBanner variant="warning">
        {t('timeline.source.retained', 'Showing retained {{section}} after a refresh failed', { section: label })}: {getErrorMessage(source.error)}
      </AlertBanner>
    )}
    {source.paused && (
      <AlertBanner variant="info">
        {t('timeline.source.pausedRetained', 'Refresh is paused; retained {{section}} remains available', { section: label })}
      </AlertBanner>
    )}
    {children}
  </>;
}
