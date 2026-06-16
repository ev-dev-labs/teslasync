// The framework-free model backing the native GuardModePage surface (P3/A7) — the Kotlin mirror of the derivation
// helpers in web/src/features/vehicle-systems/pages/GuardModePage.tsx. It owns the surface identity
// ([GuardModePageRegistration]), the event-type tone lookup ([guardEventTone], the port of the web
// `EVENT_BADGE_VARIANT` record), the event-row icon kind ([guardEventIcon]), the sensitivity option values
// ([GuardSensitivity]), and the verbatim ports of the web `useMemo`/derived chain (armed / unacknowledged-count /
// latest-event / triggered, the effective settings hand-off, the home-geofence match, the live-location guard, and
// the event-trail positions). Everything here is plain Kotlin (no Compose, no Android, no coroutines) so it is
// covered by fast JVM unit tests and reused unchanged by the stateless screen + the state holder.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
import io.teslasync.shared.core.presentation.guard.isGuardEventAcknowledged
import io.teslasync.shared.core.presentation.locations.Geofence
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `GuardModePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("guardMode", "/guard-mode", NavGroup.VehicleSystems)`, so [io.teslasync.android.navigation.PageHosts] binds
 * this surface to that destination (and its `/guard-mode` deep link) without the nav module depending on it.
 */
object GuardModePageRegistration {
    /** The navigation destination id (Destinations.kt `page("guardMode", "/guard-mode", …)`). */
    const val ROUTE_ID: String = "guardMode"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/guard-mode"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "GuardModePage"

    /** The web fallback sensitivity (`sensitivity || guardConfig?.sensitivity || 'medium'`). */
    const val DEFAULT_SENSITIVITY: String = "medium"
}

/**
 * The trigger sensitivity options — the port of the web `SENSITIVITY_OPTIONS` `value`s. The display labels are
 * resolved from the string catalog at the render boundary ([io.teslasync.android.vehiclesystems] screen), keyed by
 * the stable [value]; the field itself round-trips the value verbatim to the backend (web `Select value`).
 */
enum class GuardSensitivity(val value: String) {
    Low("low"),
    Medium("medium"),
    High("high"),
    ;

    companion object {
        /** The ordered option values shown in the sensitivity select (web `SENSITIVITY_OPTIONS`). */
        val values: List<String> = entries.map { it.value }
    }
}

/** The badge tone for a guard event — the port of the web `EVENT_BADGE_VARIANT` record (danger | warning | info). */
enum class GuardEventTone { Danger, Warning, Info }

/**
 * The icon kind for a guard-event row — the port of the web `EventRow` icon `cond` ladder. Acknowledged rows show a
 * check; a manual panic shows the siren; an `unlock` token shows the unlock glyph; a `drive` token shows the car; any
 * other unacknowledged event shows the warning triangle. Resolved to a concrete glyph at the render boundary.
 */
enum class GuardEventIcon { Acknowledged, Panic, Unlock, Drive, Alert }

/**
 * The badge tone for [eventType], mirroring the web `EVENT_BADGE_VARIANT[event_type] ?? 'info'` lookup-with-fallback:
 * an unmapped (e.g. newly-added backend) type tones to [GuardEventTone.Info] rather than throwing, so the timeline
 * never crashes on an unknown token (the data-modeling lookup-with-fallback rule).
 */
fun guardEventTone(eventType: String): GuardEventTone =
    when (eventType) {
        "vehicle_moved", "unauthorized_unlock", "unauthorized_drive", "manual_panic" -> GuardEventTone.Danger
        "sentry_triggered", "sentry_mode" -> GuardEventTone.Warning
        else -> GuardEventTone.Info
    }

/**
 * The row icon kind for [event], mirroring the web `EventRow` ternary ladder. The acknowledged check takes priority,
 * then the manual-panic siren, then a substring match on `unlock` / `drive` (so legacy `unauthorized_*` tokens still
 * map), then the warning fallback.
 */
fun guardEventIcon(event: GuardEvent): GuardEventIcon =
    when {
        isGuardEventAcknowledged(event) -> GuardEventIcon.Acknowledged
        event.eventType == "manual_panic" -> GuardEventIcon.Panic
        event.eventType.contains("unlock") -> GuardEventIcon.Unlock
        event.eventType.contains("drive") -> GuardEventIcon.Drive
        else -> GuardEventIcon.Alert
    }

// ── Derived chain (verbatim ports of the web useMemo / inline derivations) ──────────────────────────────────────

/** Whether guard is armed (web `guardConfig?.enabled ?? false`). */
fun guardArmed(config: GuardConfig?): Boolean = config?.enabled ?: false

/** The count of unacknowledged events (web `events.filter(e => !isGuardEventAcknowledged(e)).length`). */
fun unacknowledgedCount(events: List<GuardEvent>): Int = events.count { !isGuardEventAcknowledged(it) }

/** The most recent event (web `events[0] ?? null`); the feed is returned newest-first by the backend. */
fun latestGuardEvent(events: List<GuardEvent>): GuardEvent? = events.firstOrNull()

/**
 * Whether the surface is in the triggered/alert state (web
 * `latestEvent != null && !isGuardEventAcknowledged(latestEvent) && latestEvent.event_type !== 'test_alert'`).
 */
fun guardTriggered(events: List<GuardEvent>): Boolean {
    val latest = latestGuardEvent(events) ?: return false
    return !isGuardEventAcknowledged(latest) && latest.eventType != "test_alert"
}

/**
 * The sensitivity to render/save, mirroring the web `sensitivity || guardConfig?.sensitivity || 'medium'`: a blank
 * local [override] falls through to the persisted config, then to the medium default.
 */
fun effectiveSensitivity(
    override: String,
    config: GuardConfig?,
): String =
    when {
        override.isNotBlank() -> override
        !config?.sensitivity.isNullOrBlank() -> config.sensitivity
        else -> GuardModePageRegistration.DEFAULT_SENSITIVITY
    }

/**
 * The home-geofence id (as the select's string value) to render/save, mirroring the web
 * `homeGeofenceId || (guardConfig?.home_geofence_id != null ? String(...) : '')`: a blank local [override] falls
 * through to the persisted config's id, else the empty (no-fence) value.
 */
fun effectiveHomeGeofenceId(
    override: String,
    config: GuardConfig?,
): String =
    when {
        override.isNotBlank() -> override
        config?.homeGeofenceId != null -> config.homeGeofenceId.toString()
        else -> ""
    }

/**
 * The auto-panic toggle value, mirroring the web `autoPanic || guardConfig?.auto_panic || false`. A null local
 * [override] (untouched) reads the persisted config; once the user toggles, the explicit choice wins.
 */
fun effectiveAutoPanic(
    override: Boolean?,
    config: GuardConfig?,
): Boolean = override ?: (config?.autoPanic ?: false)

/** The selected home geofence, matched by its string id (web `geofences?.find(g => String(g.id) === id)`). */
fun homeGeofenceFor(
    geofences: List<Geofence>,
    effectiveId: String,
): Geofence? = geofences.firstOrNull { it.id.toString() == effectiveId }

/**
 * Whether a renderable live location is available (web `lat != null && lng != null && lat !== 0 && lng !== 0`). The
 * normalised [VehicleState] always carries doubles, so the guard reduces to the non-zero check plus a finite guard.
 */
fun guardHasLocation(state: VehicleState?): Boolean {
    if (state == null) return false
    val lat = state.latitude
    val lng = state.longitude
    return lat.isFinite() && lng.isFinite() && lat != 0.0 && lng != 0.0
}

/**
 * The event-trail polyline positions (web `eventPositions`). The backend's guard events are state-change rows sourced
 * from `security_events` and generally carry no coordinates, so the web memo resolves to an empty list and the trail
 * is omitted. This port reproduces that 1:1 while remaining defensively functional: any event whose opaque `details`
 * map happens to carry numeric `latitude`/`longitude` contributes a point, so the trail renders if the backend ever
 * re-attaches coordinates. Order follows the (newest-first) feed.
 */
fun eventTrailPositions(events: List<GuardEvent>): List<Pair<Double, Double>> =
    events.mapNotNull { event ->
        val details = event.details ?: return@mapNotNull null
        val lat = details["latitude"]?.jsonPrimitiveOrNull()?.doubleOrNull
        val lng = details["longitude"]?.jsonPrimitiveOrNull()?.doubleOrNull
        if (lat != null && lng != null && lat != 0.0 && lng != 0.0) lat to lng else null
    }

private fun kotlinx.serialization.json.JsonElement.jsonPrimitiveOrNull() =
    runCatching { jsonPrimitive }.getOrNull()

/** Emits the one PII-safe `view.opened` diagnostic with the surface [GuardModePageRegistration.SLUG] (P1/S11). */
fun recordGuardModePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to GuardModePageRegistration.SLUG))
}
