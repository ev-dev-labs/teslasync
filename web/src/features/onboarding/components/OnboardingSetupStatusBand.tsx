import { Activity, Car, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { TelemetryHealth } from '@/api/hooks/useOnboarding';
import { ProgressRing } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { GlassPanel, Text } from '@/components/ui';
import { type NeonColor } from '@/lib/tokens';
import {
  OnboardingStatusCard,
  type OnboardingStatusCardProps,
} from './OnboardingStatusCard';

type StatusCard = Omit<OnboardingStatusCardProps, 'loading'> & { id: string };

interface OnboardingSetupStatusBandProps {
  teslaConnected: boolean;
  vehicleCount: number;
  telemetryHealth: TelemetryHealth;
  setupComplete: boolean;
  isLoading: boolean;
  hasData: boolean;
  error: unknown;
  onRetry: () => void;
}

export function OnboardingSetupStatusBand({
  teslaConnected,
  vehicleCount,
  telemetryHealth,
  setupComplete,
  isLoading,
  hasData,
  error,
  onRetry,
}: OnboardingSetupStatusBandProps) {
  const { t } = useTranslation();
  const dataFlowing = telemetryHealth === 'healthy';
  const completedCount = setupComplete
    ? 3
    : [teslaConnected, vehicleCount > 0, dataFlowing].filter(Boolean).length;
  const cards: StatusCard[] = [
    {
      id: 'tesla',
      icon: <Plug className="h-5 w-5" />,
      color: 'cyan' as NeonColor,
      label: t('onboarding.status.tesla.label', 'Tesla account'),
      value: teslaConnected
        ? t('onboarding.status.tesla.connected', 'Connected')
        : t('onboarding.status.tesla.pending', 'Not connected'),
      done: teslaConnected,
      hint: teslaConnected
        ? t('onboarding.status.tesla.hintDone', 'Fleet API access authorized')
        : t('onboarding.status.tesla.hint', 'Sign in to authorize access'),
    },
    {
      id: 'vehicles',
      icon: <Car className="h-5 w-5" />,
      color: 'purple' as NeonColor,
      label: t('onboarding.status.vehicles.label', 'Vehicles synced'),
      value: String(vehicleCount),
      done: vehicleCount > 0,
      hint:
        vehicleCount > 0
          ? t('onboarding.status.vehicles.hintDone', 'Synced from the Fleet API')
          : t('onboarding.status.vehicles.hint', 'Waiting for the first sync'),
    },
    {
      id: 'telemetry',
      icon: <Activity className="h-5 w-5" />,
      color: 'green' as NeonColor,
      label: t('onboarding.status.telemetry.label', 'Telemetry'),
      value:
        telemetryHealth === 'healthy'
          ? t('onboarding.status.telemetry.flowing', 'Flowing')
          : telemetryHealth === 'stale'
            ? t('onboarding.status.telemetry.stale', 'Interrupted')
            : t('onboarding.status.telemetry.waiting', 'Waiting'),
      done: dataFlowing,
      hint:
        telemetryHealth === 'healthy'
          ? t('onboarding.status.telemetry.hintDone', 'Live signals arriving')
          : telemetryHealth === 'stale'
            ? t('onboarding.status.telemetry.hintStale', 'Stored history remains available')
            : t('onboarding.status.telemetry.hint', 'No signals received yet'),
    },
  ];

  return (
    <section
      aria-label={t('onboarding.status.sectionLabel', 'Setup status')}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4"
    >
      {error ? (
        <GlassPanel className="col-span-full p-4 sm:p-5">
          <QueryError error={error} onRetry={onRetry} />
        </GlassPanel>
      ) : (
        <>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Text variant="metricLabel" as="p">
                  {t('onboarding.progress.label', 'Setup progress')}
                </Text>
                <Text as="p" size="lg" weight="semibold" color="primary" className="mt-1.5">
                  {t('onboarding.progress.value', '{{done}}/{{total}}', {
                    done: completedCount,
                    total: 3,
                  })}
                </Text>
                <Text variant="caption" as="p" className="mt-1">
                  {setupComplete
                    ? t('onboarding.progress.allDone', 'All steps complete')
                    : t('onboarding.progress.hint', 'Steps complete')}
                </Text>
              </div>
              <ProgressRing
                value={completedCount}
                max={3}
                size={60}
                strokeWidth={6}
                color={setupComplete ? '#10b981' : '#22d3ee'}
                centerLabel={`${completedCount}/3`}
              />
            </div>
          </GlassPanel>

          {cards.map((card) => (
            <OnboardingStatusCard
              key={card.id}
              icon={card.icon}
              color={card.color}
              label={card.label}
              value={card.value}
              done={card.done}
              hint={card.hint}
              loading={isLoading && !hasData}
            />
          ))}
        </>
      )}
    </section>
  );
}
