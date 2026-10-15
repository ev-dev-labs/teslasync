import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { useDataState } from '@/hooks/useDataState';
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';
import { Button, HelperText } from '@/components/ui';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { getChargingCurrentMaximum, type CommandDef, type Vehicle } from '../../commands';
import { CommandConfirmDialog } from '../CommandConfirmDialog';
import { CommandInputDialog } from '../CommandInputDialog';
import { CommandSelectDialog } from '../CommandSelectDialog';

export interface ActiveCommandDialog {
  kind: 'input' | 'select' | 'confirm';
  definition: CommandDef;
  vehicleId?: number;
}

interface CommandDialogsProps {
  active: ActiveCommandDialog | null;
  vehicle: Vehicle;
  loading: boolean;
  onClose: () => void;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
}

export function CommandDialogs({
  active,
  vehicle,
  loading,
  onClose,
  onExecute,
}: CommandDialogsProps) {
  const { t } = useTranslation();
  const needsChargingMaximum = active?.kind === 'input'
    && active.definition.command === 'set_charging_amps'
    && (active.vehicleId == null || active.vehicleId === vehicle.id);
  const chargingQuery = useVehicleLiveSignals(vehicle.id, {
    enabled: needsChargingMaximum,
    refetchInterval: TELEMETRY_STALE_AFTER_MS / 4,
  });
  const chargingSource = useDataState(chargingQuery, {
    provenance: 'live', maxAgeMs: TELEMETRY_STALE_AFTER_MS,
  });
  const chargingMaximum = getChargingCurrentMaximum(chargingSource, vehicle.id);
  const handleInputSubmit = useCallback((values: Record<string, string>) => {
    const definition = active?.definition;
    const config = definition?.inputConfig;
    if (loading || active?.vehicleId != null && active.vehicleId !== vehicle.id || !definition || !config) return;
    if (needsChargingMaximum) {
      // Recheck the observation clock at submission, not just at render time.
      const maximum = getChargingCurrentMaximum(chargingSource, vehicle.id);
      const value = values[config.paramName] ?? '';
      if (maximum == null || !/^[+]?\d+$/.test(value)
        || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) return;
    }

    const params = config.buildParams
      ? config.buildParams(values)
      : {
          ...definition.params,
          [config.paramName]: config.transform
            ? config.transform(values[config.paramName] ?? '')
            : values[config.paramName] ?? '',
        };

    onExecute(definition.command, params);
    onClose();
  }, [active, chargingSource, loading, needsChargingMaximum, onClose, onExecute, vehicle.id]);

  const handleSelect = useCallback((value: string) => {
    const definition = active?.definition;
    const config = definition?.selectConfig;
    if (loading || active?.vehicleId != null && active.vehicleId !== vehicle.id || !definition || !config) return;

    onExecute(definition.command, {
      ...definition.params,
      [config.paramName]: value,
    });
    onClose();
  }, [active, loading, onClose, onExecute, vehicle.id]);

  const handleConfirm = useCallback(() => {
    if (loading || !active || active.vehicleId != null && active.vehicleId !== vehicle.id) return;
    onExecute(active.definition.command, active.definition.params);
    onClose();
  }, [active, loading, onClose, onExecute, vehicle.id]);

  if (!active || active.vehicleId != null && active.vehicleId !== vehicle.id) return null;

  if (active.kind === 'input') {
    const definition = needsChargingMaximum ? {
      ...active.definition,
      inputConfig: { ...active.definition.inputConfig!, max: chargingMaximum ?? undefined },
    } : active.definition;
    const sourceNotice = needsChargingMaximum ? (
      <div data-testid="command-charging-capability" className="space-y-2">
        {chargingSource.fatalError ? (
          <QueryError error={chargingSource.fatalError} onRetry={chargingSource.retry ?? undefined} />
        ) : chargingSource.status === 'stale' ? (
          <StaleRefreshWarning state={chargingSource} label={t('commands.charging.amperage', 'Amperage')} />
        ) : (
          <>
            <HelperText>
              {chargingMaximum != null
                ? t('commands.input.max', 'Maximum: {{max}}', { max: chargingMaximum })
                : chargingSource.isRefreshBlocked
                  ? t('dataSources.status.paused', 'Refresh paused')
                  : chargingQuery.isLoading
                    ? t('common.loading', 'Loading…')
                    : t('common.unknown', 'Unknown')}
            </HelperText>
            {chargingMaximum == null && (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-9"
                disabled={chargingSource.isRefreshing} onClick={() => void chargingQuery.refetch()}>
                {t('common.refresh', 'Refresh')}
              </Button>
            )}
          </>
        )}
      </div>
    ) : undefined;
    return (
      <CommandInputDialog
        open
        onClose={onClose}
        onSubmit={handleInputSubmit}
        def={definition}
        vehicle={{ display_name: vehicle.display_name || vehicle.vin }}
        loading={loading}
        disabled={needsChargingMaximum && chargingMaximum == null}
        validationNotice={sourceNotice}
      />
    );
  }

  if (active.kind === 'select') {
    return (
      <CommandSelectDialog
        open
        onClose={onClose}
        onSelect={handleSelect}
        def={active.definition}
        loading={loading}
      />
    );
  }

  return (
    <CommandConfirmDialog
      open
      onClose={onClose}
      onConfirm={handleConfirm}
      def={active.definition}
      loading={loading}
    />
  );
}
