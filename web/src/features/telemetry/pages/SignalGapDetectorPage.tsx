/**
 * SignalGapDetectorPage — thin wrapper around the shared
 * `SignalCatalogPanel` so the gap-detector view stays in sync with the
 * catalog rendered in the unified `/signals` workspace.
 *
 * Now uses the global `useSelectedVehicle` store instead of the previous
 * hard-coded `vehicleId = 1`.
 */

import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout/PageContainer';
import { VehicleSelect } from '@/components/forms';
import { EmptyState } from '@/components/feedback';
import { Activity } from 'lucide-react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import { SignalCatalogPanel } from '../components/SignalCatalogPanel';

export default function SignalGapDetectorPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalGap.title', 'Signal Gaps'));
  const { vehicleId } = useSelectedVehicle();

  return (
    <PageContainer
      title={t('signalGap.title', 'Signal Gap Detector')}
      subtitle={t('signalGap.subtitle', 'Identify signals that have stopped arriving or have gaps')}
      actions={<VehicleSelect />}
    >
      {!vehicleId || vehicleId <= 0 ? (
        // no-action: vehicle picker is in the page header; no inline CTA needed.
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t('signalGap.noVehicle', 'Select a vehicle to begin')}
          message={t('signalGap.noVehicleDesc', 'Pick a vehicle from the picker above to inspect its signal freshness.')}
        />
      ) : (
        <SignalCatalogPanel vehicleId={vehicleId} />
      )}
    </PageContainer>
  );
}
