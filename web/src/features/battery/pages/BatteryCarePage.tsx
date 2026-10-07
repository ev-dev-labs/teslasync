import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveHistory } from '@/api/hooks/useDriving';

import { CardGrid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';

import {
  BatteryCareMethodology,
  RankedCareHabits,
} from '../components/battery-care';
import {
  CareEnergy,
  CareMonthlyTrend,
  CareRisk,
  CareSummary,
  SocEvidence,
  SpecialistSlot,
  careSectionState,
  specialistState,
} from '../components/battery-care-modernization';
import {
  BATTERY_CARE_HISTORY_LIMIT,
  computeBatteryCare,
} from '../lib/batteryCare';

export default function BatteryCarePage() {
  const { t } = useTranslation();
  usePageTitle(t('batteryCare.title', 'Battery Care'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const [analysisNowMs] = useState(() => Date.now());

  const sessionsQuery = useChargingHistory(
    vehicleIdStr,
    BATTERY_CARE_HISTORY_LIMIT,
  );
  const drivesQuery = useDriveHistory(
    vehicleIdStr,
    BATTERY_CARE_HISTORY_LIMIT,
  );
  const sessionsTrust = useDataState(sessionsQuery, { provenance: 'historical' });
  const drivesTrust = useDataState(drivesQuery, { provenance: 'historical' });
  const sessions = useMemo(
    () => sessionsQuery.data ?? [],
    [sessionsQuery.data],
  );
  const drives = useMemo(
    () => drivesQuery.data ?? [],
    [drivesQuery.data],
  );
  const care = useMemo(
    () =>
      computeBatteryCare(sessions, drives, {
        nowMs: analysisNowMs,
        sessionLimit: BATTERY_CARE_HISTORY_LIMIT,
        driveLimit: BATTERY_CARE_HISTORY_LIMIT,
      }),
    [analysisNowMs, drives, sessions],
  );

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('batteryCare.title', 'Battery Care')}
      />
    );
  }

  const chargingSource = {
    label: t('batteryCare.method.returnedSessions', 'Sessions returned'),
    state: sessionsTrust,
  };
  const driveSource = {
    label: t('batteryCare.method.returnedDrives', 'Drives returned'),
    state: drivesTrust,
  };
  const chargingState = careSectionState([chargingSource]);
  const driveState = careSectionState([driveSource]);
  const combinedState = careSectionState([chargingSource, driveSource]);
  const readonlySpecialistState = specialistState(combinedState);

  return (
    <PageLayout
      title={t('batteryCare.title', 'Battery Care')}
      subtitle={t(
        'batteryCare.subtitle',
        'How gently your charging habits treat the pack',
      )}
      query={[sessionsQuery, drivesQuery]}
    >
      <FadeIn>
        <CareSummary care={care} state={combinedState} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <CardGrid
          label={t('batteryCare.risk.title', 'Score & risk decomposition')}
          items={[
            { id: 'care-score', size: 'half', content: <CareRisk care={care} state={combinedState} /> },
            { id: 'care-targets', size: 'half', content: <SocEvidence kind="finish" care={care} state={chargingState} /> },
          ]}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <CardGrid
          label={t('batteryCare.energy.title', 'AC/DC energy evidence')}
          items={[
            { id: 'care-energy', size: 'half', content: <CareEnergy care={care} state={chargingState} /> },
            { id: 'care-arrivals', size: 'half', content: <SocEvidence kind="arrival" care={care} state={driveState} /> },
          ]}
        />
      </FadeIn>

      <FadeIn delay={0.15}>
        <CareMonthlyTrend care={care} state={combinedState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <CardGrid
          label={t('batteryCare.actions.title', 'Ranked habit opportunities')}
          items={[
            {
              id: 'care-habits',
              size: 'half',
              content: (
                <SpecialistSlot state={combinedState}>
                  <RankedCareHabits care={care} state={readonlySpecialistState} />
                </SpecialistSlot>
              ),
            },
            {
              id: 'care-methodology',
              size: 'half',
              content: (
                <SpecialistSlot state={combinedState}>
                  <BatteryCareMethodology
                    care={care}
                    state={readonlySpecialistState}
                    sessionLimit={BATTERY_CARE_HISTORY_LIMIT}
                    driveLimit={BATTERY_CARE_HISTORY_LIMIT}
                  />
                </SpecialistSlot>
              ),
            },
          ]}
        />
      </FadeIn>
    </PageLayout>
  );
}
