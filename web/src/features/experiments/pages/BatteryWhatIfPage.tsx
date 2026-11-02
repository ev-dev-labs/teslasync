import { useTranslation } from 'react-i18next';

import { Icons } from '@/lib/icons';
import ExperimentIntro from '../components/ExperimentIntro';

export default function BatteryWhatIfPage() {
  const { t } = useTranslation();
  const title = t('experiments.batteryWhatIf.title', 'Battery what-if');
  const description = t('experiments.batteryWhatIf.description', 'Model battery degradation and range projections from real charge and discharge history.');

  return (
    <ExperimentIntro
      title={title}
      description={description}
      icon={Icons.battery}
    />
  );
}
