import { Car } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';

/**
 * Defensive empty state for pages that require a selected vehicle.
 *
 * Even with the global <OnboardingGate> active, edge cases can leave
 * a page mounted while `useSelectedVehicle().vehicleId` is null —
 * for example, a deep-link landing the user on /battery before the
 * onboarding poll has resolved, or an installation whose Tesla token
 * was revoked between visits. In those cases the page should NOT
 * render its data scaffolding (which would throw on `null` IDs);
 * instead it shows this empty state and links the user back into the
 * onboarding flow.
 */

interface NoVehicleSelectedProps {
  /** Localized page title (passed straight through to PageContainer). */
  pageTitle: string;
  /** Optional override for the empty-state title. */
  title?: string;
  /** Optional override for the empty-state description. */
  description?: string;
}

export function NoVehicleSelected({
  pageTitle,
  title,
  description,
}: NoVehicleSelectedProps) {
  const { t } = useTranslation();

  return (
    <PageContainer title={pageTitle}>
      <GlassPanel className="p-8">
        <EmptyState
          icon={<Car className="h-12 w-12" aria-hidden="true" />}
          title={title ?? t('common.noVehicleSelected.title', 'No vehicle selected')}
          message={
            description ??
            t(
              'common.noVehicleSelected.desc',
              'Add a vehicle to your fleet to see data on this page.',
            )
          }
          actionTo={{
            label: t('common.noVehicleSelected.action', 'Set up TeslaSync'),
            to: '/onboarding',
          }}
        />
      </GlassPanel>
    </PageContainer>
  );
}
