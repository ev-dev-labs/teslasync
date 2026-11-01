import { useTranslation } from 'react-i18next';

import { Icons } from '@/lib/icons';
import ExperimentIntro from '../components/ExperimentIntro';

export default function EnergyFlowPage() {
  const { t } = useTranslation();
  const title = t('experiments.energyFlow.title', 'Energy flow');
  const description = t('experiments.energyFlow.description', 'Trace the full energy story of a charge or drive, from grid to battery to wheel, as one flow.');

  return (
    <ExperimentIntro
      title={title}
      description={description}
      icon={Icons.powerWave}
    />
  );
}
