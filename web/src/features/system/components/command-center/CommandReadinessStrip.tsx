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
import type { Vehicle, VehicleState } from '../../commands';
import type { CommandExecutionFeedback } from './types';

interface CommandReadinessStripProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  stateLoading: boolean;
  stateError: unknown;
  pendingLabel: string | null;
  feedback: CommandExecutionFeedback | null;
}

export function CommandReadinessStrip({
  vehicle,
  state,
  stateLoading,
  stateError,
  pendingLabel,
  feedback,
}: CommandReadinessStripProps) {
  const { t } = useTranslation();
  const { isStale, ageLabel } = useIsStale(vehicle.updated_at);
  const rawStatus = (state?.state || vehicle.state || 'offline').toLowerCase();
  const asleep = rawStatus === 'asleep';
  const offline = rawStatus === 'offline';
  const moving = state?.speed != null ? Math.abs(state.speed) > 0 : null;

  const connection = t(
    `commands.status.${rawStatus}`,
    rawStatus.replace(/_/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase()),
  );
  const availability = stateLoading
    ? t('commands.readiness.checking', 'Checking')
    : stateError
      ? t('commands.readiness.stateUnknown', 'State unknown')
      : offline
        ? t('commands.readiness.deliveryUncertain', 'Delivery uncertain')
        : asleep
          ? t('commands.readiness.wakeRecommended', 'Wake recommended')
          : t('commands.readiness.ready', 'Ready');
  const motion = moving == null
    ? t('commands.readiness.motionUnknown', 'Motion unknown')
    : moving
      ? t('commands.readiness.moving', 'Vehicle moving')
      : t('commands.readiness.stationary', 'No motion reported');
  const freshness = !vehicle.updated_at
    ? t('commands.readiness.freshnessUnknown', 'Unknown')
    : isStale
      ? t('commands.readiness.outdated', 'Outdated')
      : t('commands.readiness.current', 'Current');

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
          sublabel={vehicle.updated_at ? ageLabel : '—'}
          align="start"
        />
      </div>

      {(asleep || offline) && (
        <InlineCallout
          variant="warning"
          icon={<Radio className="h-4 w-4" aria-hidden="true" />}
        >
          {asleep
            ? t(
                'commands.readiness.asleepHelp',
                'The vehicle is asleep. Commands remain selectable; waking it first can improve delivery speed.',
              )
            : t(
                'commands.readiness.offlineHelp',
                'The vehicle reports offline. Commands remain selectable, but delivery may fail until connectivity returns.',
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
