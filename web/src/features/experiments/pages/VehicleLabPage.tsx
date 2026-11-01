import { useTranslation } from 'react-i18next';

import { Icons } from '@/lib/icons';
import ExperimentIntro from '../components/ExperimentIntro';

export default function VehicleLabPage() {
  const { t } = useTranslation();
  const title = t('experiments.vehicleLab.title', 'Vehicle lab');
  const description = t('experiments.vehicleLab.description', 'Explore live vehicle signals through an interactive, self-made 3D vehicle.');

  return (
    <ExperimentIntro
      title={title}
      description={description}
      icon={Icons.vehicle}
    />
  );
}
