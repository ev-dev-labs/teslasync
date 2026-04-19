import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useToast } from '@/components/feedback/Toast';
import { vehicleKeys } from './useVehicles';

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
 */
export function useVehicleCommand() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ vehicleId, command, params }: SendCommandParams) =>
      request<CommandResult>(`/vehicles/${vehicleId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, params }),
      }),
    onSuccess: (data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.state(vehicleId) });
      queryClient.invalidateQueries({ queryKey: ['command-latest', vehicleId] });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      if (data.success) {
        toast.success(data.message || 'Command sent successfully');
      } else {
        toast.error(data.message || 'Command failed');
      }
    },
    onError: (err: Error) => {
      toast.error(`Command failed: ${err.message}`);
    },
  });
}
