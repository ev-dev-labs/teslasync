import { Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { TripShareImportStatus } from '../hooks/useTripShareTarget';

interface TripShareImportBannerProps {
  status: TripShareImportStatus;
}

export function TripShareImportBanner({ status }: TripShareImportBannerProps) {
  const { t } = useTranslation();
  if (status === 'idle') return null;

  return (
    <FadeIn>
      <AlertBanner
        variant={status === 'error' ? 'warning' : 'info'}
        icon={<Share2 className="h-5 w-5" aria-hidden="true" />}
        title={
          status === 'error'
            ? t('tripPlanner.share.errorTitle', 'Shared destination unavailable')
            : t('tripPlanner.share.title', 'Shared destination')
        }
      >
        {status === 'loading'
          ? t('tripPlanner.share.loading', 'Importing the destination shared with TeslaSync…')
          : status === 'coordinates'
            ? t(
                'tripPlanner.share.coordinates',
                'Destination coordinates imported. Review the route settings before planning.',
              )
            : status === 'text'
              ? t(
                  'tripPlanner.share.text',
                  'Destination prefilled. Choose a matching search result to confirm its coordinates.',
                )
              : t(
                  'tripPlanner.share.error',
                  'The shared item was empty, expired, or could not be read. Share it again or enter the destination manually.',
                )}
      </AlertBanner>
    </FadeIn>
  );
}
