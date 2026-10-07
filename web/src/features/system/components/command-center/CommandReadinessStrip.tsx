import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Radio,
} from 'lucide-react';
import { GlassPanel, Heading, Text } from '@/components/ui';
import { MetricTile, useIsStale } from '@/components/data-display';
import { InlineCallout } from '@/components/feedback';
import {
  deriveTrustedVehicleStatus,
  isVehicleStateFieldCurrent,
  resolveVehicleStateFreshness,
} from '@/api/hooks/useVehicles';
import type { VehicleState } from '@/api/types';
import type { Vehicle } from '../../commands';
import type { CommandExecutionFeedback } from './types';

interface CommandReadinessStripProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  stateTrust: Parameters<typeof deriveTrustedVehicleStatus>[1];
  stateLoading: boolean;
  stateError: unknown;
  pendingLabel: string | null;
  feedback: CommandExecutionFeedback | null;
}

export function CommandReadinessStrip({
  vehicle,
  state,
  stateTrust,
  stateLoading,
  stateError,
  pendingLabel,
  feedback,
}: CommandReadinessStripProps) {
  const { t } = useTranslation();
  const observedAt = stateTrust?.observedAt;
  const { ageLabel } = useIsStale(observedAt != null ? new Date(observedAt).toISOString() : null);
  const verifiedStatus = deriveTrustedVehicleStatus(state, stateTrust);
  const rawStatus = (state?.state || vehicle.state || 'offline').toLowerCase();
  const moving = isVehicleStateFieldCurrent(stateTrust, 'speed') && state?.speed != null
    ? Math.abs(state.speed) > 0
    : null;

  const status = verifiedStatus ?? rawStatus;
  const asleep = status === 'asleep';
  const offline = status === 'offline';
  const statusLabel = t(
    `commands.status.${status}`,
    status.replace(/_/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase()),
  );
  const connection = verifiedStatus
    ? statusLabel
    : t('commands.hero.lastKnownStatus', 'Last known: {{status}}', { status: statusLabel });
  const availability = stateLoading
    ? t('commands.readiness.checking', 'Checking')
    : stateError
      ? t('commands.readiness.stateUnknown', 'State unknown')
      : !verifiedStatus || verifiedStatus === 'offline'
        ? t('commands.readiness.deliveryUncertain', 'Delivery uncertain')
        : verifiedStatus === 'asleep'
          ? t('commands.readiness.wakeRecommended', 'Wake recommended')
          : t('commands.readiness.ready', 'Ready');
  const motion = moving == null
    ? t('commands.readiness.motionUnknown', 'Motion unknown')
    : moving
      ? t('commands.readiness.moving', 'Vehicle moving')
      : t('commands.readiness.stationary', 'No motion reported');
  const signalFreshness = observedAt != null
    ? resolveVehicleStateFreshness(stateTrust?.freshness, observedAt)
    : 'unknown';
  const freshness = signalFreshness === 'unknown'
    ? t('commands.readiness.freshnessUnknown', 'Unknown')
    : signalFreshness === 'fresh'
      ? t('commands.readiness.current', 'Current')
      : t('commands.readiness.outdated', 'Outdated');

  return (
    <GlassPanel
      className="space-y-4 p-4 sm:p-5"
      data-testid="command-readiness"
    >
      <div>
        <Heading level="section">
          {t('commands.readiness.title', 'Command readiness')}
        </Heading>
        <Text as="p" variant="bodySm" className="mt-1">
          {t(
            'commands.readiness.description',
            'Connection, telemetry, and motion context before a remote request is sent.',
          )}
        </Text>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          value={connection}
          label={t('commands.readiness.connection', 'Connection')}
          align="start"
        />
        <MetricTile
          value={availability}
          label={t('commands.readiness.availability', 'Command delivery')}
          align="start"
        />
        <MetricTile
          value={motion}
          label={t('commands.readiness.motion', 'Motion context')}
          align="start"
        />
        <MetricTile
          value={freshness}
          label={t('commands.readiness.telemetry', 'Telemetry')}
          sublabel={observedAt != null ? ageLabel : '—'}
          align="start"
        />
      </div>

      {(asleep || offline) && (
        <InlineCallout
          variant="warning"
          icon={<Radio className="h-4 w-4" aria-hidden="true" />}
        >
          {asleep
            ? verifiedStatus
              ? t(
                  'commands.readiness.asleepHelp',
                  'The vehicle is asleep. Commands remain selectable; waking it first can improve delivery speed.',
                )
              : t(
                  'commands.readiness.lastKnownAsleep',
                  'Last reported asleep. Commands remain selectable; waking it first may improve delivery speed.',
                )
            : verifiedStatus
              ? t(
                  'commands.readiness.offlineHelp',
                  'The vehicle reports offline. Commands remain selectable, but delivery may fail until connectivity returns.',
                )
              : t(
                  'commands.readiness.lastKnownOffline',
                  'Last reported offline. Commands remain selectable, but delivery may fail until connectivity returns.',
                )}
        </InlineCallout>
      )}

      <div aria-live="polite" aria-atomic="true">
        {pendingLabel ? (
          <InlineCallout
            variant="info"
            icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            testId="command-pending-feedback"
          >
            {t('commands.feedback.pending', 'Sending {{command}}…', {
              command: pendingLabel,
            })}
          </InlineCallout>
        ) : feedback ? (
          <InlineCallout
            variant={feedback.success ? 'success' : 'danger'}
            icon={
              feedback.success
                ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                : <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            }
            testId="command-result-feedback"
          >
            {feedback.message}
          </InlineCallout>
        ) : (
          <Text as="p" size="xs" color="muted">
            {t(
              'commands.feedback.idle',
              'No command is currently running. Results will appear here.',
            )}
          </Text>
        )}
      </div>
    </GlassPanel>
  );
}
