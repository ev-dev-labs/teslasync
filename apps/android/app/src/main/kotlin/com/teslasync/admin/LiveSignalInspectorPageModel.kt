// Pure, framework-free model + derivations for the LiveSignalInspectorPage admin surface — the native
// analogue of everything the web page + its LiveSignalsTable compute before they return JSX
// (web/src/features/admin/pages/LiveSignalInspectorPage.tsx and
// web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx, the realtime per-vehicle
// signal viewer). No Compose, no Android framework, no HTTP lives here: every type is exercised off-device,
// keeping the composable a thin render layer.
//
// The live feed arrives as the shared, already-decoded S8 payload (the KMP `TelemetryStore.vehicleLiveSignals
// (id)` ▸ `GET /signals/{id}/live`, a typed `VehicleLiveSignalsResponse` whose `signals` map carries each
// per-field value as a raw `JsonElement`). So this file owns only the client-side derivations the web table
// does inline: normalizing each entry into a flat row (the `{value, timestamp}` envelope OR a bare scalar —
// web `rowFromEntry`), coercing any value to a display string (web `renderValue`), and the case-insensitive
// name filter + name/timestamp sort (web `useState(filter)` + `useSortToggle`). Phase-42 stores everything as
// SI, so values round-trip verbatim; any unit formatting would be the render boundary's job (S5) — these raw
// signal values are unit-agnostic key/value pairs and carry none.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling ApiLogsPage / FeedbackQueuePage admin surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.livesignals

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11).
 */
object LiveSignalInspectorRegistration {
    /** The navigation destination id (Destinations.kt `page("adminLiveSignals", "/admin/live-signals", …)`). */
    const val ROUTE_ID: String = "adminLiveSignals"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/live-signals"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LiveSignalInspectorPage"
}

/**
 * One flat row of the live snapshot — the native port of the web `LiveSignalRow`. [name] is the signal field,
 * [value] the raw per-field element (already unwrapped from its `{value, timestamp}` envelope when present),
 * and [timestamp] the optional ISO-8601 update stamp the envelope carried.
 */
data class LiveSignalRow(
    val name: String,
    val value: JsonElement?,
    val timestamp: String? = null,
)

/** The two sortable columns (web `useSortToggle('name'|'timestamp')`). */
enum class LiveSignalSortKey { Name, Timestamp }

/**
 * Normalises a single `signals` entry into a flat [LiveSignalRow] — the web `rowFromEntry`. The backend may
 * return either a `{value, timestamp}` envelope OR a bare scalar (`true`, `42`, "Drive") depending on which
 * signal repo shipped the row; both shapes flow through unchanged. An object that carries a `value` key is
 * treated as the envelope (its `timestamp` is taken when it is a JSON string); anything else is a bare value.
 */
fun rowFromEntry(
    name: String,
    raw: JsonElement,
): LiveSignalRow {
    if (raw is JsonObject && raw.containsKey("value")) {
        val ts = (raw["timestamp"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return LiveSignalRow(name = name, value = raw["value"], timestamp = ts)
    }
    return LiveSignalRow(name = name, value = raw)
}

/**
 * Coerces a raw signal value to its display string — the web `renderValue`. A Kotlin-`null` (an absent key)
 * is the em dash; a JSON `null` literal renders the word "null"; a string/number/boolean renders its content;
 * a compound object/array is shown as its compact JSON so a typed triple (e.g. a location) never crashes the
 * row.
 */
fun renderValue(value: JsonElement?): String =
    when (value) {
        null -> EM_DASH
        is JsonNull -> "null"
        is JsonPrimitive -> value.content
        else -> value.toString()
    }

/**
 * Projects the decoded live response into flat rows (web `Object.keys(signals).map(rowFromEntry)`). A `null`
 * response (nothing loaded yet) yields an empty list so the caller never dereferences a missing payload.
 */
fun liveSignalRows(response: VehicleLiveSignalsResponse?): List<LiveSignalRow> {
    val signals = response?.signals ?: return emptyList()
    return signals.map { (name, raw) -> rowFromEntry(name, raw) }
}

/**
 * Case-insensitive name filter (web `rows.filter(r => r.name.toLowerCase().includes(q))`). A blank query
 * returns every row unchanged.
 */
fun filterRows(
    rows: List<LiveSignalRow>,
    query: String,
): List<LiveSignalRow> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return rows
    return rows.filter { it.name.lowercase().contains(q) }
}

/**
 * Sorts rows by [key] in [ascending] order (web `useSortToggle` comparator). Name uses a locale-agnostic
 * case-insensitive comparison; timestamp orders by parsed epoch (missing stamps sort as epoch zero), matching
 * the web `Date.parse(a.timestamp ?? 0)`.
 */
fun sortRows(
    rows: List<LiveSignalRow>,
    key: LiveSignalSortKey,
    ascending: Boolean,
): List<LiveSignalRow> {
    val base =
        when (key) {
            LiveSignalSortKey.Name -> rows.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            LiveSignalSortKey.Timestamp -> rows.sortedBy { parseTimestampMillis(it.timestamp) }
        }
    return if (ascending) base else base.asReversed()
}

/**
 * Best-effort ISO-8601 → epoch-millis parse for timestamp sorting (web `Date.parse`). An absent or
 * unparseable stamp is treated as epoch zero so it sorts to the bottom of an ascending list, never throwing.
 */
internal fun parseTimestampMillis(timestamp: String?): Long {
    if (timestamp.isNullOrBlank()) return 0L
    return try {
        OffsetDateTime.parse(timestamp).toInstant().toEpochMilli()
    } catch (_: DateTimeParseException) {
        0L
    }
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no signal content. */
internal fun recordLiveSignalInspectorOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to LiveSignalInspectorRegistration.SLUG))
}
