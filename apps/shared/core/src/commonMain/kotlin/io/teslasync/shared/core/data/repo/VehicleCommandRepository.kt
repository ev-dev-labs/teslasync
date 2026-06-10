package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.vehiclecommand.CommandResult
import io.teslasync.shared.core.presentation.vehiclecommand.SendVehicleCommandInput

/**
 * The S7 data port for sending a Tesla command to a vehicle — the cross-platform analogue of the
 * web `useVehicleCommand` hook domain (web/src/api/hooks/useVehicleCommand.ts). Every native
 * command surface (the Android/Apple command palette + Commands page via KMP, Windows via the C#
 * port) reaches the backend exclusively through this interface, so a single fake stands in for the
 * whole domain in the S8 state-holder tests.
 *
 * The domain is a single mutation and no reads — `useVehicleCommand.ts` contains exactly one
 * `useMutation` and no `useQuery`. [sendCommand] is a non-throwing suspend [Result]: a 2xx yields
 * `Result.success(CommandResult)`, any transport/HTTP failure yields `Result.failure` (the
 * Tesla-token-expired replay queue the web hook wires on top of that failure is a platform recovery
 * concern, not this port's).
 *
 * On success the implementation invalidates the four cache surfaces the web hook's `onSuccess`
 * invalidates — the per-vehicle state, the command-latest and command-history feeds, and the
 * vehicle list — so the next read of each re-fetches the post-command truth (mirroring the web
 * `invalidateQueries` calls). There is nothing to convert here: the command name, argument bag, and
 * `{ success, message }` reply are not unit-bearing, so they round-trip verbatim (display is S5's
 * job).
 */
public interface VehicleCommandRepository {
    /**
     * `POST /vehicles/{vehicleId}/command` with body `{ command, params }` (web `useVehicleCommand`).
     * On success the per-vehicle state, command-latest, command-history, and vehicle-list cache
     * surfaces are invalidated so their next read re-fetches.
     */
    public suspend fun sendCommand(input: SendVehicleCommandInput): Result<CommandResult>
}
