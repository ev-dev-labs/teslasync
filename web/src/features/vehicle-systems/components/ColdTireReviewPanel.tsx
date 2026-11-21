import { useTranslation } from 'react-i18next';
import { ColdTireReview } from './ColdTireReview';
import { PrivateVehicleReviewPanel } from '@/components/vehicles';

export function ColdTireReviewPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="cold-tire-review" vehicleId={vehicleId} allowSharedOpen
      title={t('tireDifferentialDrift.coldReview.title', 'Cold tire checks')}
      description={t('tireDifferentialDrift.coldReview.description', 'Compare your own cold gauge readings, separately from the vehicle’s TPMS chart. Nothing is sent outside TeslaSync.')}
      openLabel={t('tireDifferentialDrift.coldReview.open', 'Review cold checks')}
      vehiclePrompt={t('tireDifferentialDrift.coldReview.vehicle', 'Select a vehicle in the workspace picker to record cold checks.')}>
      {props => <ColdTireReview key={`${props.scope.mode}:${props.scope.mode === 'forward_auth' ? props.scope.subject : ''}:${props.vehicleId}`} {...props} />}
    </PrivateVehicleReviewPanel>
  );
}
