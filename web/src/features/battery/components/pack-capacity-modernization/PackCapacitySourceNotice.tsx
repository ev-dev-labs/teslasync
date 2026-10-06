import { useTranslation } from 'react-i18next';

import type { DataState } from '@/api/dataState';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { ChargingSession } from '@/types/charging';

/** Existing QueryStatus owns failures/retry. This fills only its paused gap. */
export function PackCapacitySourceNotice({
  source,
  vehicleSelected,
}: {
  source: DataState<ChargingSession[]>;
  vehicleSelected: boolean;
}) {
  const { t } = useTranslation();
  if (!vehicleSelected || !source.isRefreshBlocked || source.refreshError) return null;

  if (source.hasData) {
    return (
      <StaleRefreshWarning
        state={source}
        label={t('packCapacity.title', 'Pack Capacity')}
      />
    );
  }

  return (
    <AlertBanner variant="info" role="status" className="mt-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <Text as="p" variant="bodySm">
          {t(
            'packCapacity.modernization.pausedInitial',
            'Charging history is paused while the device is offline. No charging evidence has loaded yet.',
          )}
        </Text>
        {source.retry && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={source.retry}>
            {t('packCapacity.states.retry', 'Retry')}
          </Button>
        )}
      </div>
    </AlertBanner>
  );
}
