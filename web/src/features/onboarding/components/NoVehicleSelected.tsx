import { Car } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { EmptyStateGuidanceDetails } from '@/components/feedback/ActionableEmptyState';
import { getEmptyStateGuidance } from '@/lib/emptyStateGuidance';

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
 *
 * HELP-02: this is the single highest-traffic empty state in the app —
 * ~20 pages route through it — so it carries the governed explanation
 * (prerequisite + likely cause) from `lib/emptyStateGuidance`. The
 * established title, message and CTA are unchanged: "no vehicles linked"
 * has two very different causes (setup never finished vs. a revoked Tesla
 * authorisation) and only one of them is obvious from the CTA. The CTA
 * target is asserted against the registry in the test, so the two cannot
 * drift apart.
 */

/** Registry entry backing the explanation rows below the message. */
const GUIDANCE_ID = 'vehicles.list';

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
  const guidance = getEmptyStateGuidance(GUIDANCE_ID);

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
            // Kept in lock-step with the governed action for this surface.
            to: guidance?.action.to ?? '/onboarding',
          }}
        />
        <div className="flex justify-center">
          <EmptyStateGuidanceDetails guidanceId={GUIDANCE_ID} />
        </div>
      </GlassPanel>
    </PageContainer>
  );
}
