import { BatteryCharging, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

interface ChargeAdvisorChargingProfileProps extends ChargeAdvisorComponentProps {
  formatEnergy: (value: number | null | undefined, options?: { precision?: number }) => string;
}

export function ChargeAdvisorChargingProfile({
  analysis,
  state,
  formatEnergy,
}: ChargeAdvisorChargingProfileProps) {
  const { t } = useTranslation();
  const profile = analysis.chargingProfile;
  const items = [
    {
      label: t('chargeAdvisor.charging.sessions', 'Completed sessions'),
      value: fmtInt(profile.sessions),
      detail: t('chargeAdvisor.charging.weeks', '{{count}} active weeks', {
        count: profile.activeWeeks,
      }),
    },
    {
      label: t('chargeAdvisor.charging.startSoc', 'Median start SoC'),
      value: profile.medianStartSocPct == null ? '—' : fmtPercent(profile.medianStartSocPct, 0),
      detail: t('chargeAdvisor.charging.endSoc', 'Median end {{value}}', {
        value: profile.medianEndSocPct == null ? '—' : fmtPercent(profile.medianEndSocPct, 0),
      }),
    },
    {
      label: t('chargeAdvisor.charging.added', 'Median added SoC'),
      value: profile.medianAddedPct == null ? '—' : fmtPercent(profile.medianAddedPct, 1),
      detail: profile.daysSinceLatestCompletedCharge == null
        ? t('chargeAdvisor.charging.noLatest', 'No completed charge date')
        : t('chargeAdvisor.charging.daysSince', '{{days}} days since latest end', {
          days: profile.daysSinceLatestCompletedCharge,
        }),
    },
    {
      label: t('chargeAdvisor.charging.energy', 'Energy added'),
      value: profile.totalEnergyAddedWh == null ? '—' : formatEnergy(profile.totalEnergyAddedWh, { precision: 1 }),
      detail: t('chargeAdvisor.charging.energyRows', '{{count}} rows with valid Wh', {
        count: profile.energyRows,
      }),
    },
  ];

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.charging.title', 'Charging start/end SoC profile')}
      subtitle={t(
        'chargeAdvisor.charging.subtitle',
        'Completed charging sessions are summarized separately from drive-associated use; nonpositive SoC gains are accounted for but excluded from these aggregates.',
      )}
      icon={<BatteryCharging className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="charging"
      dataTestId="charge-advisor-charging-profile"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <Text variant="caption">{item.label}</Text>
            <Text className="mt-1 text-xl font-semibold text-cyan-300">{item.value}</Text>
            <Text variant="caption">{item.detail}</Text>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant={profile.support.band === 'none' ? 'neutral' : 'info'}>
          {t(
            `chargeAdvisor.support.band.${profile.support.band}`,
            profile.support.band === 'strong'
              ? 'strong'
              : profile.support.band === 'moderate'
                ? 'moderate'
                : profile.support.band === 'thin'
                  ? 'thin'
                  : 'none',
          )}
        </Badge>
        <Text variant="caption">
          <Zap className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          {t('chargeAdvisor.charging.energyNote', 'Energy is shown in the selected SI-derived display unit.')}
        </Text>
      </div>
    </ChargeAdvisorSection>
  );
}
