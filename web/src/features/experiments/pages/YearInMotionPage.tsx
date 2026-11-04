import { useTranslation } from 'react-i18next';

import { Icons } from '@/lib/icons';
import ExperimentIntro from '../components/ExperimentIntro';

export default function YearInMotionPage() {
  const { t } = useTranslation();
  const title = t('experiments.yearInMotion.title', 'Year in motion');
  const description = t('experiments.yearInMotion.description', 'Watch a year of recorded journeys unfold as an animated map and timeline.');

  return (
    <ExperimentIntro
      title={title}
      description={description}
      icon={Icons.trendUp}
    />
  );
}
