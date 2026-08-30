import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { request } from '../client';
import { useToast } from '@/components/feedback';
import { vehicleKeys } from './useVehicles';
import { commandKeys } from './useCommands';
import { isTeslaAuthExpiredError } from '@/lib/resilience';
import { queueTeslaMutation } from '@/lib/teslaAuthRecovery';

/**
 * Result of `POST /vehicles/{id}/command`.
 *
 * The backend command handler answers HTTP 200 in BOTH the success and
 * failure cases, discriminated by `success`:
 *   • success → `{ success: true,  result: "success" }`
 *   • failure → `{ success: false, error:  "<reason>" }`
 *
 * Every field is optional so a 204 / malformed body decodes into an
 * object we can safely read without throwing. `message` is accepted for
 * forward-compatibility with a future handler revision that returns a
 * friendlier human string; today the failure reason lives in `error`.
 */
export interface CommandResult {
  success?: boolean;
  /** Present on the success path (currently the literal `"success"`). */
  result?: string;
  /** Present on the failure path — the real reason the command was rejected. */
  error?: string;
  /** Optional friendly message (not currently emitted by the backend). */
  message?: string;
}

export interface SendCommandParams {
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
 * When the Tesla third-party token has expired,
 * the command surfaces as {@link TeslaAuthExpiredError}. We queue the
 * original args via {@link queueTeslaMutation} so the command replays
 * automatically once the user reconnects (within 5 minutes).
 */
export function useVehicleCommand() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  const mutation = useMutation({
    mutationFn: ({ vehicleId, command, params }: SendCommandParams) =>
      request<CommandResult>(`/vehicles/${vehicleId}/command`, {
        method: 'POST',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, params }),
      }),
    networkMode: 'always',
    onSuccess: (data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.state(vehicleId) });
      queryClient.invalidateQueries({ queryKey: commandKeys.latest(vehicleId) });
      queryClient.invalidateQueries({ queryKey: commandKeys.history(vehicleId) });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      if (data?.success) {
        toast.success(data.message || t('commands.toast.success', 'Command sent successfully'));
      } else {
        // Surface the backend's `error` (or a future `message`) so the user
        // learns WHY the command was rejected instead of a generic failure.
        toast.error(
          data?.error || data?.message || t('commands.toast.failed', 'Command failed'),
        );
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
      toast.error(
        t('commands.toast.error', 'Command failed: {{message}}', { message: err.message }),
      );
    },
  });

  return mutation;
}
