import { useTranslation } from 'react-i18next';

import { Icons } from '@/lib/icons';
import ExperimentIntro from '../components/ExperimentIntro';

export default function EnergyFlowPage() {
  const { t } = useTranslation();
  const title = t('experiments.energyFlow.title', 'Where did my energy go?');
  const description = t('experiments.energyFlow.description', 'Trace charge and drive energy from grid to battery to wheels, as one flow.');

  return (
    <ExperimentIntro
      title={title}
      description={description}
      icon={Icons.powerWave}
    />
  );
}
