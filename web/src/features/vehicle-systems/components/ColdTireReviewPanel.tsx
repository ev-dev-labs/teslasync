import { useTranslation } from 'react-i18next';
import { ColdTireReview } from './ColdTireReview';
import { PrivateVehicleReviewPanel } from '@/components/vehicles';

export function ColdTireReviewPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="cold-tire-review" vehicleId={vehicleId}
      title={t('tireDifferentialDrift.coldReview.title', 'Private cold tire checks')}
      description={t('tireDifferentialDrift.coldReview.description', 'Compare your own cold gauge readings, separately from the vehicle’s TPMS chart. Nothing is sent outside TeslaSync.')}
      openLabel={t('tireDifferentialDrift.coldReview.open', 'Review private cold checks')}
      vehiclePrompt={t('tireDifferentialDrift.coldReview.vehicle', 'Select a vehicle in the workspace picker to record cold checks.')}
      signInPrompt={t('tireDifferentialDrift.coldReview.signIn', 'This private review requires verified sign-in.')}>
      {props => <ColdTireReview key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
    </PrivateVehicleReviewPanel>
  );
}
