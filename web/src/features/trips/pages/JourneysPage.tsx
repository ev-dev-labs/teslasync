import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { JourneyPanel } from '../components/JourneyPanel';

/**
 * Journeys — home of Journey Autopilot. Trip sessions live here from
 * planning (stop scoring, departure advice, checklists) through the
 * live drive (replans, arrival prep) to the debrief (report card,
 * learning loop). Slice 1 ships session management; later slices fill
 * this page in.
 */
export default function JourneysPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();

  usePageTitle(t('journey.page.navTitle', 'Journeys'));

  return (
    <PageContainer
      title={t('journey.page.title', 'Journeys')}
      subtitle={t(
        'journey.page.subtitle',
        'Door-to-door trip companion: plan the drive, ride it live with replans, then debrief.',
      )}
      contextActions={<VehicleSelect withIcon />}
    >
      <FadeIn>
        <JourneyPanel vehicleId={vehicleId} />
      </FadeIn>
    </PageContainer>
  );
}
