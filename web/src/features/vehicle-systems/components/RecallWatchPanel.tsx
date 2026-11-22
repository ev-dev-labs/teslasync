import { useTranslation } from 'react-i18next';
import { PrivateVehicleReviewPanel } from '@/components/vehicles';
import { RecallWatchControls } from './RecallWatchControls';

export function RecallWatchPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="recall-watch" vehicleId={vehicleId}
      title={t('maintenance.recallWatch.title', 'Private recall watch')}
      description={t('maintenance.recallWatch.description', 'Review recent U.S. NHTSA campaigns by model year. This watch cannot check VIN applicability or completion. It posts private cards only, never push alerts.')}
      openLabel={t('maintenance.recallWatch.open', 'Review private recall watch')}
      vehiclePrompt={t('maintenance.recallWatch.vehicle', 'Select a vehicle in the workspace picker to set up a recall watch.')}
      signInPrompt={t('maintenance.recallWatch.signIn', 'This private watch requires verified sign-in.')}>
      {props => <RecallWatchControls key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
    </PrivateVehicleReviewPanel>
  );
}
