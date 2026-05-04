import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useToast } from '@/components/feedback/Toast';
import { vehicleKeys } from './useVehicles';
import { isTeslaAuthExpiredError } from '@/lib/resilience';
import { queueTeslaMutation } from '@/lib/teslaAuthRecovery';

interface CommandResult {
  success: boolean;
  message: string;
}

interface SendCommandParams {
  vehicleId: number;
  command: string;
  params?: Record<string, unknown>;
}

/**
 * Shared hook for sending vehicle commands.
 * Used by both the CommandPalette and the Commands page.
 *
 * API: POST /vehicles/{vehicleId}/command  body: { command, params }
 *
 * Phase-45 / Prompt 30 — when the Tesla third-party token has expired,
 * the command surfaces as {@link TeslaAuthExpiredError}. We queue the
 * original args via {@link queueTeslaMutation} so the command replays
 * automatically once the user reconnects (within 5 minutes).
 */
export function useVehicleCommand() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: ({ vehicleId, command, params }: SendCommandParams) =>
      request<CommandResult>(`/vehicles/${vehicleId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, params }),
      }),
    onSuccess: (data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.state(vehicleId) });
      queryClient.invalidateQueries({ queryKey: ['command-latest', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['command-history', String(vehicleId)] });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      if (data.success) {
        toast.success(data.message || 'Command sent successfully');
      } else {
        toast.error(data.message || 'Command failed');
      }
    },
    onError: (err: Error, variables) => {
      if (isTeslaAuthExpiredError(err)) {
        // Queue for replay after reconnect — the banner triggers the
        // drain on `teslasync:tesla-auth-recovered`.
        queueTeslaMutation(() => mutation.mutateAsync(variables));
        // Suppress the generic command-failed toast — the
        // <TeslaReauthBanner> is the user-facing recovery surface.
        return;
      }
      toast.error(`Command failed: ${err.message}`);
    },
  });

  return mutation;
}
