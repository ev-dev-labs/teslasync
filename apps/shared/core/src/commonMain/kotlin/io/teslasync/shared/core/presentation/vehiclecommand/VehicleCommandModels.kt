package io.teslasync.shared.core.presentation.vehiclecommand

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * The `POST /vehicles/{vehicleId}/command` response — the cross-platform port of the web
 * `CommandResult` interface (web/src/api/hooks/useVehicleCommand.ts). The backend answers a flat
 * `{ success, message }` document: [success] is the command outcome and [message] is the
 * human-readable detail the web hook funnels into a success/error toast.
 *
 * Neither field is unit-bearing, so the payload round-trips verbatim with no SI conversion;
 * surfacing the [message] (and choosing a toast style from [success]) is the render boundary's job
 * (S5/platform), never this layer's.
 */
@Serializable
public data class CommandResult(
    val success: Boolean,
    val message: String,
)

/**
 * The arguments for one `POST /vehicles/{vehicleId}/command` — the port of the web
 * `SendCommandParams` (`{ vehicleId, command, params? }`). [vehicleId] selects the target vehicle
 * and is carried in the URL path only (never the body, exactly as the web hook splits them).
 *
 * The request body is `{ command, params }`: [command] is the action name (`wake_up`,
 * `door_unlock`, …) and [params] is the optional argument bag. A null [params] is omitted from the
 * body entirely, mirroring `JSON.stringify({ command, params })` dropping an `undefined` key — a
 * present-but-empty `{}` is still sent. [params] is a raw [JsonObject] so any command's
 * heterogeneous arguments (numbers, strings, booleans) flow through unchanged.
 *
 * @property vehicleId the target vehicle id (URL path segment, not the body).
 * @property command the command name placed in the body as `command`.
 * @property params the optional command arguments placed in the body as `params`; null omits the key.
 */
public data class SendVehicleCommandInput(
    val vehicleId: Long,
    val command: String,
    val params: JsonObject? = null,
)
