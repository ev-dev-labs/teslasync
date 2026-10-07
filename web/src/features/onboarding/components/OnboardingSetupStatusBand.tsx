import { Activity, Car, Check, Clock, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { TelemetryHealth } from '@/api/hooks/useOnboarding';
import { OperationalBrief, ProgressRing, type StatMetric } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { GlassPanel, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface OnboardingSetupStatusBandProps {
  teslaConnected: boolean;
  vehicleCount: number;
  telemetryHealth: TelemetryHealth;
  setupComplete: boolean;
  isLoading: boolean;
  hasData: boolean;
  retained?: boolean;
  lastTelemetryAt?: string | null;
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
  retained = false,
  lastTelemetryAt = null,
  error,
  onRetry,
}: OnboardingSetupStatusBandProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const dataFlowing = telemetryHealth === 'healthy';
  const completedCount = setupComplete
    ? 3
    : [teslaConnected, vehicleCount > 0, dataFlowing].filter(Boolean).length;
  const cards = [
    {
      id: 'tesla',
      icon: <Plug className="h-5 w-5" aria-hidden="true" />,
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
      icon: <Car className="h-5 w-5" aria-hidden="true" />,
      label: t('onboarding.status.vehicles.label', 'Vehicles synced'),
      value: vehicleCount,
      done: vehicleCount > 0,
      hint:
        vehicleCount > 0
          ? t('onboarding.status.vehicles.hintDone', 'Synced from the Fleet API')
          : t('onboarding.status.vehicles.hint', 'Waiting for the first sync'),
    },
    {
      id: 'telemetry',
      icon: <Activity className="h-5 w-5" aria-hidden="true" />,
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
  const progressLabel = t('onboarding.progress.label', 'Setup progress');
  const progressValue = t('onboarding.progress.value', '{{done}}/{{total}}', {
    done: completedCount,
    total: 3,
  });
  const missingReason = t(
    'onboarding.brief.missing',
    'Setup status has not been received; no completed-step or vehicle count is known.',
  );
  const metrics: readonly StatMetric[] = [
    {
      occurrenceId: 'setup-progress',
      metricId: 'count',
      rawValue: hasData ? completedCount : null,
      display: { countTotal: 3 },
      label: progressLabel,
      description: setupComplete
        ? t('onboarding.progress.allDone', 'All steps complete')
        : t('onboarding.progress.hint', 'Steps complete'),
      missingReason,
      context: hasData ? (
        <ProgressRing
          value={completedCount}
          max={3}
          size={60}
          strokeWidth={6}
          color={setupComplete ? '#10b981' : '#22d3ee'}
          centerLabel={progressValue}
          ariaLabel={`${progressLabel}: ${progressValue}`}
        />
      ) : undefined,
    },
    ...cards.map((card): StatMetric => {
      const StatusIcon = card.done ? Check : Clock;
      return {
        occurrenceId: card.id,
        metricId: card.id === 'vehicles' ? 'count' : 'status',
        rawValue: hasData ? card.value : null,
        label: card.label,
        description: card.hint,
        missingReason,
        context: hasData ? (
          <span className="inline-flex items-center gap-2">
            {card.icon}
            <StatusIcon
              aria-hidden="true"
              className={card.done ? 'h-4 w-4 text-emerald-300' : 'h-4 w-4 text-amber-300'}
            />
          </span>
        ) : undefined,
      };
    }),
  ];
  const operationalMetrics = useOperationalMetrics(metrics);

  return (
    <section
      aria-label={t('onboarding.status.sectionLabel', 'Setup status')}
      className="space-y-3"
    >
      {error ? (
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={error} onRetry={onRetry} />
        </GlassPanel>
      ) : null}
      <OperationalBrief
        compact
        testId="onboarding-setup-brief"
        eyebrow={t('onboarding.brief.eyebrow', 'First-run setup')}
        title={t('onboarding.status.sectionLabel', 'Setup status')}
        description={t(
          'onboarding.brief.description',
          'Account authorization, synced vehicles, and telemetry readiness from the existing setup check.',
        )}
        statusLabel={error
          ? t('onboarding.brief.unavailable', 'Setup status unavailable')
          : retained
            ? t('onboarding.brief.retained', 'Retained setup status')
            : isLoading && !hasData
              ? t('onboarding.status.loading', 'Loading status…')
              : !hasData
                ? t('onboarding.brief.notReceived', 'Setup status not yet received')
                : setupComplete
                  ? t('onboarding.progress.allDone', 'All steps complete')
                  : t('onboarding.stepper.status.current', 'In progress')}
        statusTone={error || retained ? 'warning' : setupComplete && hasData ? 'success' : 'neutral'}
        metrics={operationalMetrics}
        loading={isLoading && !hasData}
        scope={<Text as="span" variant="caption">
          {t('onboarding.brief.scope', 'This installation · 3 setup anchors')}
        </Text>}
        freshness={<Text as="span" variant="caption">
          {lastTelemetryAt
            ? t('onboarding.brief.lastTelemetry', 'Last telemetry: {{time}}', {
              time: formatDateTime(lastTelemetryAt),
            })
            : t('onboarding.brief.noTelemetryTime', 'Last telemetry time not supplied')}
        </Text>}
        provenance={t(
          'onboarding.brief.provenance',
          'Existing onboarding status response; completed setup remains complete during a live-service outage. Telemetry health is not a status-fetch timestamp.',
        )}
      />
    </section>
  );
}
