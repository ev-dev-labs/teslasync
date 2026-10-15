import { useTranslation } from 'react-i18next';
import { RadioTower } from 'lucide-react';

import { Text } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { AlertBanner, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useVehicleSilence } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';

interface SilenceBannerProps {
  vehicleId?: number;
}

/**
 * Telemetry silence watchdog banner for the vehicle detail page. Silent
 * while telemetry is confirmed fresh; unresolved or retained checks remain qualified.
 */
export function SilenceBanner({ vehicleId }: SilenceBannerProps) {
  const { t } = useTranslation();
  const query = useVehicleSilence(vehicleId);
  const { data } = query;
  const trust = useDataState({ ...query, data: data ?? undefined });
  const label = t('vehicles.preview.telemetry', 'Telemetry');

  if (!data) {
    if (trust.fatalError) {
      return <QueryError error={trust.fatalError} onRetry={trust.retry ?? undefined} resourceName={label} />;
    }
    const loading = query.fetchStatus === 'fetching' && (query.isPending || query.isLoading);
    return (
      <SourceContent
        state={loading ? 'loading' : 'empty'}
        label={label}
        emptyMessage={trust.isRefreshBlocked
          ? t('dataSources.status.paused', 'Refresh paused')
          : t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
        errorMessage={t('dataSources.status.failed', 'Failed')}
      >
        {null}
      </SourceContent>
    );
  }

  if (data.status === 'ok' && trust.status === 'ok') return null;

  return (
    <div className="min-w-0 space-y-3">
      <StaleRefreshWarning state={trust} label={label} />
      {data.status !== 'ok' && (
        <AlertBanner
          variant={data.status === 'silent' || data.status === 'never' ? 'warning' : 'info'}
          icon={<RadioTower className="h-5 w-5" aria-hidden="true" />}
          title={
            data.status === 'never'
              ? t('vehicles.silence.never', 'No telemetry yet')
              : data.status === 'silent'
                ? t('vehicles.silence.silent', 'Vehicle silent')
                : t('vehicles.silence.quiet', 'Vehicle quiet')
          }
        >
          <Text as="p" variant="bodySm">{data.explanation}</Text>
        </AlertBanner>
      )}
    </div>
  );
}
