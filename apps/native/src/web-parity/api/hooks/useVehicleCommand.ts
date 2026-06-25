import { useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from '../client';
import { useMutationToast } from './_toastHelpers';

interface CommandResult {
  success: boolean;
  message: string;
}

interface SendCommandParams {
  vehicleId: number;
  command: string;
  params?: Record<string, unknown>;
}

interface QueuedTeslaMutation {
  at: number;
  replay: () => Promise<unknown>;
}

const QUEUED_TESLA_COMMANDS: QueuedTeslaMutation[] = [];

const vehicleKeys = {
  all: ['vehicles'] as const,
  state: (id: number) => ['vehicle-state', id] as const,
};

export const TESLA_COMMAND_AUTH_QUEUE_MAX = 10;
export const TESLA_COMMAND_AUTH_QUEUE_TTL_MS = 5 * 60 * 1000;

export const nativeVehicleCommandAuthRecovery = {
  documentEventBridgeAvailable: false,
  queuedReplayAvailable: true,
  queuedReplayTrigger: 'manual drainQueuedTeslaCommandMutations call after native Tesla reconnect',
} as const;

function isTeslaAuthExpiredError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') {
    return false;
  }

  const candidate = err as { code?: unknown; name?: unknown; status?: unknown };
  return (
    candidate.code === 'TESLA_TOKEN_EXPIRED' &&
    (candidate.name === 'TeslaAuthExpiredError' ||
      candidate.name === 'ApiError' ||
      candidate.status === 401)
  );
}

function queueTeslaCommandMutation(replay: () => Promise<unknown>): void {
  if (QUEUED_TESLA_COMMANDS.length >= TESLA_COMMAND_AUTH_QUEUE_MAX) {
    return;
  }

  QUEUED_TESLA_COMMANDS.push({ at: Date.now(), replay });
}

export async function drainQueuedTeslaCommandMutations(): Promise<void> {
  if (QUEUED_TESLA_COMMANDS.length === 0) {
    return;
  }

  const now = Date.now();
  const drained = QUEUED_TESLA_COMMANDS.splice(0, QUEUED_TESLA_COMMANDS.length);
  const live = drained.filter(
    item => now - item.at <= TESLA_COMMAND_AUTH_QUEUE_TTL_MS,
  );

  for (const item of live) {
    try {
      await item.replay();
    } catch {
      // The replayed mutation's own onError path surfaces failures.
    }
  }
}

export function _resetVehicleCommandAuthQueueForTests(): void {
  QUEUED_TESLA_COMMANDS.length = 0;
}

export function _peekVehicleCommandAuthQueueSize(): number {
  return QUEUED_TESLA_COMMANDS.length;
}

/**
 * Shared hook for sending vehicle commands.
 * Used by both the CommandPalette and the Commands page.
 *
 * API: POST /vehicles/{vehicleId}/command  body: { command, params }
 *
 * Native cannot listen for the web-only `teslasync:tesla-auth-recovered`
 * document event, so expired-token commands are queued in module memory and
 * can be replayed by calling drainQueuedTeslaCommandMutations after reconnect.
 */
export function useVehicleCommand() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();

  const mutation = useMutation<CommandResult, Error, SendCommandParams>({
    mutationFn: ({ vehicleId, command, params }: SendCommandParams) =>
      request<CommandResult>(`/vehicles/${vehicleId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, params }),
      }),
    onSuccess: (data, { vehicleId }) => {
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.state(vehicleId) });
      void queryClient.invalidateQueries({ queryKey: ['command-latest', vehicleId] });
      void queryClient.invalidateQueries({
        queryKey: ['command-history', String(vehicleId)],
      });
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      if (data.success) {
        success(
          'toast.vehicleCommand.success',
          data.message || 'Command sent successfully',
        );
      } else {
        error(undefined, 'toast.vehicleCommand.error', data.message || 'Command failed');
      }
    },
    onError: (err: Error, variables) => {
      if (isTeslaAuthExpiredError(err)) {
        queueTeslaCommandMutation(() => mutation.mutateAsync(variables));
        return;
      }

      error(
        undefined,
        'toast.vehicleCommand.send.error',
        `Command failed: ${err.message}`,
      );
    },
  });

  return mutation;
}
