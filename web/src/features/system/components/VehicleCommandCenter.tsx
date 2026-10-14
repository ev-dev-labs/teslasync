import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Stack } from '@/components/layout';
import { useCommandLatest } from '@/api/hooks/useCommands';
import {
  type CommandResult,
  useVehicleCommand,
} from '@/api/hooks/useVehicleCommand';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useDataState } from '@/hooks/useDataState';
import { isTeslaAuthExpiredError } from '@/lib/resilience';
import type { Vehicle } from '../commands';
import { CommandCenterHero } from './command-center/CommandCenterHero';
import { CommandReadinessStrip } from './command-center/CommandReadinessStrip';
import { CommandWorkspace } from './command-center/CommandWorkspace';
import {
  COMMAND_STATE_REFRESH_MS,
} from './command-center/commandDomains';
import { getCommandLabel } from './command-center/commandLabels';
import type { CommandExecutionFeedback } from './command-center/types';

interface VehicleCommandCenterProps {
  vehicle: Vehicle;
}

/**
 * Selected-vehicle command orchestrator.
 *
 * Data comes exclusively from the shared TanStack Query hooks. Visual
 * sections are intentionally split into focused components so hero,
 * readiness, and actions each own their loading/error/empty
 * presentation instead of disappearing behind one broad data guard.
 */
export function VehicleCommandCenter({ vehicle }: VehicleCommandCenterProps) {
  const { t } = useTranslation();
  const operationalMode = useOperationalMode();
  const stateQuery = useVehicleState(vehicle.id, {
    refetchInterval: COMMAND_STATE_REFRESH_MS,
  });
  const latestQuery = useCommandLatest(vehicle.id);
  const {
    mutate: sendCommand,
    isPending: commandPending,
  } = useVehicleCommand();

  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CommandExecutionFeedback | null>(null);
  const inFlight = useRef(false);
  const scope = useRef({ vehicleId: vehicle.id, revision: 0 });
  const mounted = useRef(true);
  if (scope.current.vehicleId !== vehicle.id) {
    scope.current = { vehicleId: vehicle.id, revision: scope.current.revision + 1 };
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { setFeedback(null); }, [vehicle.id]);

  const state = stateQuery.data?.state ?? null;
  const latestCommands = latestQuery.data ?? [];
  const latestState = useDataState(latestQuery);
  const pendingLabel = pendingCommand
    ? getCommandLabel(pendingCommand, t)
    : null;

  const executeCommand = useCallback(
    (command: string, params?: Record<string, unknown>) => {
      if (inFlight.current) return;
      if (!operationalMode.canWrite) {
        setFeedback({
          command,
          success: false,
          message:
            operationalMode.writeBlockReason ??
            t(
              'operationalMode.writeBlocked',
              'Return to live mode before making operational changes.',
            ),
        });
        return;
      }
      const commandLabel = getCommandLabel(command, t);
      const vehicleName =
        vehicle.display_name?.trim() ||
        vehicle.vin ||
        t('commands.vehicle.fallbackName', 'Vehicle {{id}}', { id: vehicle.id });

      setFeedback(null);
      setPendingCommand(command);
      inFlight.current = true;
      const revision = scope.current.revision;
      const isCurrent = () => mounted.current && scope.current.revision === revision;
      sendCommand(
        { vehicleId: vehicle.id, command, params },
        {
          onSuccess: (result: CommandResult | undefined) => {
            if (!isCurrent()) return;
            if (result?.success) {
              setFeedback({
                command,
                success: true,
                message:
                  result.message ||
                  t(
                    'commands.feedback.success',
                    '{{command}} request sent to {{vehicle}}.',
                    { command: commandLabel, vehicle: vehicleName },
                  ),
              });
              return;
            }

            setFeedback({
              command,
              success: false,
              message:
                result?.error ||
                result?.message ||
                t(
                  'commands.feedback.failed',
                  '{{command}} was not accepted by {{vehicle}}.',
                  { command: commandLabel, vehicle: vehicleName },
                ),
            });
          },
          onError: (error: Error) => {
            if (!isCurrent()) return;
            if (isTeslaAuthExpiredError(error)) return;
            setFeedback({
              command,
              success: false,
              message: t(
                'commands.feedback.error',
                '{{command}} failed: {{message}}',
                { command: commandLabel, message: error.message },
              ),
            });
          },
          onSettled: () => {
            inFlight.current = false;
            if (mounted.current) setPendingCommand(null);
          },
        },
      );
    },
    [operationalMode, sendCommand, t, vehicle],
  );

  return (
    <Stack gap={4} data-testid="vehicle-command-center">
      <CommandCenterHero
        vehicle={vehicle}
        state={state}
        stateTrust={stateQuery.data}
        loading={stateQuery.isLoading}
        error={stateQuery.error}
        onRetry={() => void stateQuery.refetch()}
      />

      <CommandReadinessStrip
        vehicle={vehicle}
        state={state}
        stateTrust={stateQuery.data}
        stateLoading={stateQuery.isLoading}
        stateError={stateQuery.error}
        pendingLabel={pendingLabel}
        feedback={feedback}
      />

      <CommandWorkspace
        vehicle={vehicle}
        state={state}
        stateTrust={stateQuery.data}
        latestCommands={latestCommands}
        latestState={latestState}
        loading={commandPending}
        disabled={!operationalMode.canWrite}
        disabledReason={operationalMode.writeBlockReason ?? undefined}
        onExecute={executeCommand}
      />

    </Stack>
  );
}
