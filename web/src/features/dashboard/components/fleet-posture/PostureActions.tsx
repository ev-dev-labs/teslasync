import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MAX_BULK_WAKE_VEHICLES,
  useWakeVehiclesBulk,
  type FleetWakeProgress,
} from '@/api/hooks/useFleetRemediation';
import { useRunDiagnostic } from '@/api/hooks/useSystemDiagnostic';
import { AlertBanner } from '@/components/feedback';
import { PrefetchLink } from '@/components/layout';
import { Button, Caption, ConfirmDialog, Text } from '@/components/ui';
import { Icons } from '@/lib/icons';

import type { FleetPosture } from './helpers';

interface PostureActionsProps {
  posture: FleetPosture;
  vehicleId?: number;
  retrying?: boolean;
  onRetry: () => Promise<unknown> | void;
}

export function PostureActions({
  posture,
  vehicleId,
  retrying = false,
  onRetry,
}: PostureActionsProps) {
  const { t } = useTranslation();
  const wakeVehicles = useWakeVehiclesBulk();
  const runDiagnostic = useRunDiagnostic();
  const [confirmBulkWake, setConfirmBulkWake] = useState(false);
  const [progress, setProgress] = useState<FleetWakeProgress | null>(null);

  const scopedPosture = vehicleId == null
    ? undefined
    : posture.byVehicleId.get(vehicleId);
  const offlineIds = useMemo(
    () => posture.vehicles
      .filter((vehicle) => vehicle.category === 'offline')
      .map((vehicle) => vehicle.vehicle.id),
    [posture.vehicles],
  );
  const wakeBatchSize = Math.min(
    offlineIds.length,
    MAX_BULK_WAKE_VEHICLES,
  );
  const needsReconciliation =
    scopedPosture?.category === 'unverified'
    || scopedPosture?.category === 'stale'
    || scopedPosture?.category === 'missing'
    || scopedPosture?.category === 'failed';
  const hasAction =
    scopedPosture?.category === 'offline'
    || needsReconciliation
    || offlineIds.length > 1
    || posture.attentionCount > 0;

  const startWake = useCallback(
    (vehicleIds: readonly number[]) => {
      wakeVehicles.reset();
      setProgress({
        completed: 0,
        total: Math.min(vehicleIds.length, MAX_BULK_WAKE_VEHICLES),
        succeeded: 0,
        failed: 0,
      });
      wakeVehicles.mutate({
        vehicleIds,
        onProgress: setProgress,
      });
    },
    [wakeVehicles],
  );

  const handleBulkWake = useCallback(() => {
    setConfirmBulkWake(false);
    startWake(offlineIds);
  }, [offlineIds, startWake]);

  return (
    <div className="mt-6">
      <Caption className="block font-semibold uppercase tracking-[0.1em]">
        {t('dashboard.fleetPosture.actions.title', 'Recommended actions')}
      </Caption>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {!hasAction ? (
          <Text as="p" variant="bodySm" className="px-1 py-2">
            {t(
              'dashboard.fleetPosture.actions.none',
              'No operator action is required while telemetry remains verified.',
            )}
          </Text>
        ) : null}
        {scopedPosture?.category === 'offline' && vehicleId != null ? (
          <Button
            type="button"
            variant="secondary"
            size="auto"
            icon={<Icons.power className="h-4 w-4" aria-hidden="true" />}
            loading={wakeVehicles.isPending}
            onClick={() => startWake([vehicleId])}
          >
            {t('dashboard.fleetPosture.actions.wakeScoped', 'Wake scoped vehicle')}
          </Button>
        ) : null}
        {needsReconciliation ? (
          <Button
            type="button"
            variant="secondary"
            size="auto"
            icon={<Icons.refresh className="h-4 w-4" aria-hidden="true" />}
            loading={retrying}
            disabled={wakeVehicles.isPending || runDiagnostic.isPending}
            onClick={() => void onRetry()}
          >
            {t('dashboard.fleetPosture.actions.retryState', 'Retry live-state read')}
          </Button>
        ) : null}
        {scopedPosture?.category === 'failed' ? (
          <Button
            type="button"
            variant="secondary"
            size="auto"
            icon={<Icons.activity className="h-4 w-4" aria-hidden="true" />}
            loading={runDiagnostic.isPending}
            disabled={wakeVehicles.isPending || retrying}
            onClick={() => runDiagnostic.mutate()}
          >
            {t('dashboard.fleetPosture.actions.diagnostic', 'Run system diagnostic')}
          </Button>
        ) : null}
        {offlineIds.length > 1 ? (
          <Button
            type="button"
            variant="outline"
            size="auto"
            icon={<Icons.power className="h-4 w-4" aria-hidden="true" />}
            disabled={wakeVehicles.isPending}
            onClick={() => setConfirmBulkWake(true)}
          >
            {offlineIds.length > MAX_BULK_WAKE_VEHICLES
              ? t(
                'dashboard.fleetPosture.actions.wakeBatch',
                'Wake first {{batch}} of {{count}} offline',
                { batch: wakeBatchSize, count: offlineIds.length },
              )
              : t(
                'dashboard.fleetPosture.actions.wakeAll',
                'Wake all {{count}} offline',
                { count: offlineIds.length },
              )}
          </Button>
        ) : null}
        {!needsReconciliation
          && scopedPosture?.category !== 'offline'
          && posture.attentionCount > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="auto"
            icon={<Icons.refresh className="h-4 w-4" aria-hidden="true" />}
            loading={retrying}
            onClick={() => void onRetry()}
          >
            {t('dashboard.fleetPosture.actions.reconcile', 'Reconcile fleet posture')}
          </Button>
        ) : null}
      </div>

      {wakeVehicles.isPending && progress ? (
        <Text
          as="p"
          variant="bodySm"
          className="mt-3"
          role="status"
          aria-live="polite"
        >
          {t(
            'dashboard.fleetPosture.actions.progress',
            'Wake commands: {{completed}} of {{total}} processed.',
            { completed: progress.completed, total: progress.total },
          )}
        </Text>
      ) : null}

      {wakeVehicles.data ? (
        <AlertBanner
          variant={wakeVehicles.data.failed.length > 0 ? 'warning' : 'success'}
          title={
            wakeVehicles.data.failed.length > 0
              ? t('dashboard.fleetPosture.actions.partialTitle', 'Wake batch completed with exceptions')
              : t('dashboard.fleetPosture.actions.completeTitle', 'Wake commands sent')
          }
          className="mt-3"
          onClose={() => wakeVehicles.reset()}
          closeLabel={t('dashboard.fleetPosture.actions.dismissResult', 'Dismiss wake result')}
        >
          {t(
            'dashboard.fleetPosture.actions.result',
            '{{succeeded}} sent, {{failed}} failed, {{omitted}} deferred.',
            {
              succeeded: wakeVehicles.data.succeeded.length,
              failed: wakeVehicles.data.failed.length,
              omitted: wakeVehicles.data.omitted,
            },
          )}
        </AlertBanner>
      ) : null}

      {runDiagnostic.data ? (
        <AlertBanner
          variant={runDiagnostic.data.overall_status === 'ok' ? 'success' : 'warning'}
          title={t('dashboard.fleetPosture.actions.diagnosticComplete', 'System diagnostic completed')}
          className="mt-3"
          onClose={() => runDiagnostic.reset()}
          closeLabel={t('dashboard.fleetPosture.actions.dismissDiagnostic', 'Dismiss diagnostic result')}
        >
          <span>
            {t(
              'dashboard.fleetPosture.actions.diagnosticResult',
              'Overall status: {{status}}.',
              { status: runDiagnostic.data.overall_status ?? 'unknown' },
            )}
            {' '}
            <PrefetchLink
              to="/system-status"
              className="font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              {t('dashboard.fleetPosture.actions.reviewDiagnostic', 'Review system status')}
            </PrefetchLink>
          </span>
        </AlertBanner>
      ) : null}

      <ConfirmDialog
        open={confirmBulkWake}
        title={t('dashboard.fleetPosture.actions.confirmTitle', 'Wake offline vehicles?')}
        message={t(
          'dashboard.fleetPosture.actions.confirmMessage',
          'Send wake commands to {{count}} vehicle(s)? Waking vehicles may temporarily increase standby energy use.',
          { count: wakeBatchSize },
        )}
        details={
          offlineIds.length > MAX_BULK_WAKE_VEHICLES ? (
            <Text as="p" variant="bodySm">
              {t(
                'dashboard.fleetPosture.actions.batchLimit',
                '{{remaining}} vehicle(s) will remain queued for a later batch to respect command limits.',
                { remaining: offlineIds.length - MAX_BULK_WAKE_VEHICLES },
              )}
            </Text>
          ) : undefined
        }
        confirmLabel={t('dashboard.fleetPosture.actions.confirmWake', 'Send wake commands')}
        variant="warning"
        onConfirm={handleBulkWake}
        onCancel={() => setConfirmBulkWake(false)}
      />
    </div>
  );
}
