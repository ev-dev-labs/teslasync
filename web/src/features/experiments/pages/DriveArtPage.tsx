import { useTranslation } from 'react-i18next';

import { Icons } from '@/lib/icons';
import ExperimentIntro from '../components/ExperimentIntro';

export default function DriveArtPage() {
  const { t } = useTranslation();
  const title = t('experiments.driveArt.title', 'Drive art');
  const description = t('experiments.driveArt.description', 'Turn a drive into a generated piece of art from its route, speed and power.');

  return (
    <ExperimentIntro
      title={title}
      description={description}
      icon={Icons.drive}
    />
  );
}
