import { useTranslation } from 'react-i18next';
import { lazy, Suspense } from 'react';

import { Icons } from '@/lib/icons';
import { Text } from '@/components/ui';
import ExperimentIntro from '../components/ExperimentIntro';

const VehicleScene = lazy(() => import('../vehicle-lab/VehicleScene'));

export default function VehicleLabPage() {
  const { t } = useTranslation();
  const title = t('experiments.vehicleLab.title', 'Vehicle lab');
  const description = t('experiments.vehicleLab.description', 'Explore live vehicle signals through an interactive, self-made 3D vehicle.');

  return (
    <ExperimentIntro
      title={title}
      description={description}
      icon={Icons.vehicle}
    >
      <Suspense fallback={<Text as="p" role="status" className="mt-6">{t('experiments.vehicleLab.loading', 'Opening the vehicle studio...')}</Text>}>
        <VehicleScene />
      </Suspense>
    </ExperimentIntro>
  );
}
