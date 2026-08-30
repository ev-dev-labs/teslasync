import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid, Stack } from '@/components/layout';
import { useCommandHistory, useCommandLatest } from '@/api/hooks/useCommands';
import {
  type CommandResult,
  useVehicleCommand,
} from '@/api/hooks/useVehicleCommand';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { isTeslaAuthExpiredError } from '@/lib/resilience';
import type { Vehicle } from '../commands';
import { CommandCenterHero } from './command-center/CommandCenterHero';
import { CommandReadinessStrip } from './command-center/CommandReadinessStrip';
import { CommandSafetyPanel } from './command-center/CommandSafetyPanel';
import { CommandWorkspace } from './command-center/CommandWorkspace';
import { RecentCommandActivity } from './command-center/RecentCommandActivity';
import { VehicleFreshnessWarning } from './command-center/VehicleFreshnessWarning';
import {
  COMMAND_STATE_REFRESH_MS,
} from './command-center/commandDomains';
import { getCommandLabel } from './command-center/commandLabels';
import type { CommandExecutionFeedback } from './command-center/types';

interface VehicleCommandCenterProps {
  vehicle: Vehicle;
}

const LOWER_GRID_COLUMNS = { default: 1, lg: 2 } as const;

/**
 * Selected-vehicle command orchestrator.
 *
 * Data comes exclusively from the shared TanStack Query hooks. Visual
 * sections are intentionally split into focused components so hero,
 * readiness, actions, safety, and activity each own their loading/error/empty
 * presentation instead of disappearing behind one broad data guard.
 */
export function VehicleCommandCenter({ vehicle }: VehicleCommandCenterProps) {
  const { t } = useTranslation();
  const operationalMode = useOperationalMode();
  const stateQuery = useVehicleState(vehicle.id, {
    refetchInterval: COMMAND_STATE_REFRESH_MS,
  });
  const latestQuery = useCommandLatest(vehicle.id);
  const historyQuery = useCommandHistory(vehicle.id);
  const {
    mutate: sendCommand,
    isPending: commandPending,
  } = useVehicleCommand();

  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CommandExecutionFeedback | null>(null);

  const state = stateQuery.data?.state ?? null;
  const latestCommands = latestQuery.data ?? [];
  const history = historyQuery.data ?? [];
  const pendingLabel = pendingCommand
    ? getCommandLabel(pendingCommand, t)
    : null;

  const executeCommand = useCallback(
    (command: string, params?: Record<string, unknown>) => {
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
      sendCommand(
        { vehicleId: vehicle.id, command, params },
        {
          onSuccess: (result: CommandResult | undefined) => {
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
          onSettled: () => setPendingCommand(null),
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
        loading={stateQuery.isLoading}
        error={stateQuery.error}
        onRetry={() => void stateQuery.refetch()}
      />

      <VehicleFreshnessWarning timestamp={vehicle.updated_at} />

      <CommandReadinessStrip
        vehicle={vehicle}
        state={state}
        stateLoading={stateQuery.isLoading}
        stateError={stateQuery.error}
        pendingLabel={pendingLabel}
        feedback={feedback}
      />

      <CommandWorkspace
        vehicle={vehicle}
        state={state}
        latestCommands={latestCommands}
        loading={commandPending}
        disabled={!operationalMode.canWrite}
        disabledReason={operationalMode.writeBlockReason ?? undefined}
        onExecute={executeCommand}
      />

      <Grid cols={LOWER_GRID_COLUMNS} gap={4}>
        <CommandSafetyPanel vehicleStatus={state?.state || vehicle.state} />
        <RecentCommandActivity
          entries={history}
          loading={historyQuery.isLoading}
          error={historyQuery.error}
          onRetry={() => void historyQuery.refetch()}
        />
      </Grid>
    </Stack>
  );
}
