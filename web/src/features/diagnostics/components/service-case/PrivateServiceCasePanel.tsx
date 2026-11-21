import { useTranslation } from 'react-i18next';
import { PrivateVehicleReviewPanel } from '@/components/vehicles';
import { PrivateServiceCaseControls } from './PrivateServiceCaseControls';

export function PrivateServiceCasePanel({ vehicleId }: { vehicleId: number }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="private-service-case" vehicleId={vehicleId}
      title={t('serviceEvidencePack.privateCase.title', 'Private service case')}
      description={t('serviceEvidencePack.privateCase.description', 'Keep your own service notes for the selected vehicle. Select and redact evidence before downloading; nothing is sent to a service provider.')}
      openLabel={t('serviceEvidencePack.privateCase.open', 'Review private service case')}
      vehiclePrompt={t('serviceEvidencePack.privateCase.vehicle', 'Select a vehicle in the workspace picker to open a service case.')}
      signInPrompt={t('serviceEvidencePack.privateCase.signIn', 'Private service cases require verified sign-in.')}>
      {props => <PrivateServiceCaseControls key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
    </PrivateVehicleReviewPanel>
  );
}
