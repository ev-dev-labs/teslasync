package io.teslasync.shared.core.presentation.vehiclecommand

import io.teslasync.shared.core.data.repo.VehicleCommandRepository

/**
 * UI-free shared state holder for sending Tesla vehicle commands — the cross-platform port of the
 * web `useVehicleCommand` hook domain (web/src/api/hooks/useVehicleCommand.ts). Every native
 * command surface (the Android/Apple command palette + Commands page via KMP, Windows via the C#
 * port) binds to this single holder rather than re-implementing the endpoint, the request body, or
 * the post-command invalidation set.
 *
 * The web hook file is a single `useMutation` and no `useQuery`, so this holder exposes no
 * [kotlinx.coroutines.flow.StateFlow] feed — only the one non-throwing suspend [sendCommand]. A
 * success returns `Result.success(CommandResult)`; any failure returns `Result.failure`. On success
 * the repository (S7) invalidates the four cache surfaces the web hook's `onSuccess` invalidates
 * (per-vehicle state, command-latest, command-history, and the vehicle list), so the next read of
 * each re-fetches.
 *
 * Two web responsibilities are deliberately NOT reproduced here because they are render/recovery
 * concerns, not data behavior:
 *  - the success/error TOAST (web `toast.success`/`toast.error`) is the platform's job — the caller
 *    inspects [CommandResult.success]/[CommandResult.message] (or the failure) and surfaces it;
 *  - the Tesla-token-expired REPLAY QUEUE (web `queueTeslaMutation` on `isTeslaAuthExpiredError`) is
 *    the platform auth-recovery surface's job — the auth-expired failure flows out verbatim in the
 *    `Result.failure` so the platform can recognise it and re-issue [sendCommand] after reconnect.
 *
 * The holder makes no network calls itself; it delegates entirely to the injected
 * [VehicleCommandRepository], and adds no state, so it is safe to share across confinements.
 *
 * @property repo the S7 data port the command is routed through.
 */
public class VehicleCommandStore(
    private val repo: VehicleCommandRepository,
) {
    /**
     * Sends [input] as `POST /vehicles/{vehicleId}/command` (web `useVehicleCommand`). Returns the
     * repository's [Result] verbatim; on success the repository has already invalidated the four
     * affected cache surfaces.
     */
    public suspend fun sendCommand(input: SendVehicleCommandInput): Result<CommandResult> = repo.sendCommand(input)
}
