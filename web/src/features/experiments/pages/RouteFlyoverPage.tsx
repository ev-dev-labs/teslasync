import { useTranslation } from 'react-i18next';

import { Icons } from '@/lib/icons';
import ExperimentIntro from '../components/ExperimentIntro';

export default function RouteFlyoverPage() {
  const { t } = useTranslation();
  const title = t('experiments.routeFlyover.title', 'Route flyover');
  const description = t('experiments.routeFlyover.description', 'Replay a recorded drive as a cinematic journey along its actual route.');

  return (
    <ExperimentIntro
      title={title}
      description={description}
      icon={Icons.drive}
    />
  );
}
