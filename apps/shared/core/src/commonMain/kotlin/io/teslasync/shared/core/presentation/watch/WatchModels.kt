package io.teslasync.shared.core.presentation.watch

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The full watch-glance payload returned by `GET /watch/summary` — the cross-platform port of the web
 * `WatchSummary` interface (web/src/api/hooks/useWatch.ts). Every field is decoded verbatim from the
 * snake_case wire shape via [SerialName], so the KMP core and the Windows C# port decode the identical
 * envelope (ADR-004). The watch summary is a backend-rendered projection — its numeric fields carry the
 * server's existing units (`range_km` is kilometres, the temps are °C) and are NOT re-derived here, so
 * the payload round-trips verbatim; any display formatting is the render boundary's job (S5).
 *
 * @property vehicleName the vehicle's display name.
 * @property state the vehicle's coarse state string (e.g. `online`, `asleep`).
 * @property batteryLevel the battery state-of-charge percentage.
 * @property rangeKm the estimated range, in kilometres (the backend's rendered unit, carried verbatim).
 * @property isCharging whether a charge session is currently active.
 * @property chargeRate the current charge rate as rendered by the backend.
 * @property timeToFull the estimated time to a full charge as rendered by the backend.
 * @property isLocked whether the vehicle is locked.
 * @property sentryMode whether Sentry Mode is currently armed.
 * @property insideTempC the cabin temperature, in °C.
 * @property outsideTempC the ambient temperature, in °C.
 * @property isClimateOn whether climate control is currently running.
 * @property lastUpdated the ISO-8601 stamp of the projection's freshness.
 */
@Serializable
public data class WatchSummary(
    @SerialName("vehicle_name") val vehicleName: String = "",
    @SerialName("state") val state: String = "",
    @SerialName("battery_level") val batteryLevel: Double = 0.0,
    @SerialName("range_km") val rangeKm: Double = 0.0,
    @SerialName("is_charging") val isCharging: Boolean = false,
    @SerialName("charge_rate") val chargeRate: Double = 0.0,
    @SerialName("time_to_full") val timeToFull: Double = 0.0,
    @SerialName("is_locked") val isLocked: Boolean = false,
    @SerialName("sentry_mode") val sentryMode: Boolean = false,
    @SerialName("inside_temp_c") val insideTempC: Double = 0.0,
    @SerialName("outside_temp_c") val outsideTempC: Double = 0.0,
    @SerialName("is_climate_on") val isClimateOn: Boolean = false,
    @SerialName("last_updated") val lastUpdated: String = "",
)

/**
 * The minimal, pre-rendered complication payload returned by `GET /watch/complication` — the
 * cross-platform port of the web `WatchComplication` interface (web/src/api/hooks/useWatch.ts). The
 * backend renders [battery] and [range] as ready-to-display strings (no client-side derivation), so a
 * watch face complication binds these verbatim. Decoded from the snake_case/lowercase wire shape via
 * [SerialName] for identical KMP + C# decoding (ADR-004).
 *
 * @property battery the battery level pre-rendered as a display string.
 * @property range the range pre-rendered as a display string.
 * @property state the coarse state string.
 * @property charging whether a charge session is currently active.
 */
@Serializable
public data class WatchComplication(
    @SerialName("battery") val battery: String = "",
    @SerialName("range") val range: String = "",
    @SerialName("state") val state: String = "",
    @SerialName("charging") val charging: Boolean = false,
)

/**
 * The outcome of a `POST /watch/command` call — the cross-platform port of the web `WatchCommandResult`
 * interface (web/src/api/hooks/useWatch.ts). The backend reports command success in-band via [success]
 * (a transport 2xx still carries a `success: false` for a rejected command), with a human-readable
 * [message]; the render boundary maps this to a success/error toast exactly as the web `onSuccess` does
 * (that toast is intentionally NOT reproduced in the shared state holder). Decoded verbatim via
 * [SerialName].
 *
 * @property success whether the backend accepted and dispatched the command.
 * @property message the human-readable result/error message.
 */
@Serializable
public data class WatchCommandResult(
    @SerialName("success") val success: Boolean = false,
    @SerialName("message") val message: String = "",
)
