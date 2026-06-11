// Pure, framework-free model + projection for the LiveSignalsTable feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer. The shared logic helpers it leans on (SortState /
// freshness bucketing / QueryErrorKind) are themselves pure Kotlin, so the projection stays JVM-pure.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveSignalsTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling TelemetryErrorsPanel does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livesignalstable

import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.formatFreshnessAge
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, signal name, or
 * value, so a diagnostics line can never leak the vehicle's live state.
 */
const val LIVE_SIGNALS_TABLE_SLUG: String = "LiveSignalsTable"

/** Em dash shown for a missing timestamp — the web `'—'` fallback in the "Last update" column. */
internal const val EM_DASH: String = "\u2014"

/** The web `renderValue(null)` literal for a JSON `null` value. */
internal const val NULL_LITERAL: String = "null"

/** The web stable column keys (web `Column.key`); shared by the header, the sort toggle, and the cells. */
const val COL_NAME: String = "name"
const val COL_VALUE: String = "value"
const val COL_TIMESTAMP: String = "timestamp"

/** The web `pagination={{ defaultPageSize: 50 }}` page size for the live-signal table. */
const val LIVE_SIGNALS_PAGE_SIZE: Int = 50

/** Compact (no-whitespace) encoder mirroring the web `JSON.stringify(value)` used for compound values. */
private val VALUE_JSON: Json = Json { encodeDefaults = false }

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR = 500

/**
 * The already-localized strings the table renders. The web component reads each via
 * `t('admin.liveSignals.…')`; on Android they arrive through the P1/S10 i18n facade (`stringResource`) at
 * the Compose boundary and are passed in, keeping the projection locale-stable and free of any English
 * literal. [filterHint] is the web filter prompt; [filterAria] is the web `aria-label`.
 */
data class LiveSignalsTableStrings(
    val colName: String,
    val colValue: String,
    val colTimestamp: String,
    val emptyTitle: String,
    val emptyMessage: String,
    val filterHint: String,
    val filterAria: String,
    val loadingText: String,
    val filteredText: String,
    val snapshotLabel: String,
)

/**
 * One normalised table row — the native mirror of the web `LiveSignalRow`. [value] is the already-rendered
 * display string (web `renderValue`); [timestampMillis] is the parsed epoch-ms of the row's `timestamp`
 * (web `Date.parse`), or `null` when the row carries no timestamp (the "Last update" column then shows the
 * em dash, exactly as the web `row.timestamp ? <TimeStamp/> : '—'` ternary does).
 */
data class LiveSignalRow(
    val name: String,
    val value: String,
    val timestampMillis: Long?,
)

/**
 * The immutable state the [LiveSignalsTableViewModel] exposes — the cache-then-network projection of the
 * single `useVehicleLiveSignals` feed the web parent owns. [response] is the last-known snapshot (kept
 * across refetch/error so stale/offline still render the cached rows); the freshness flags drive the header
 * chip + auto-refresh, and [errorKind] classifies a hard failure for the `QueryError` branch.
 */
data class LiveSignalsTableState(
    val response: VehicleLiveSignalsResponse?,
    val updatedAtMillis: Long?,
    val isFetching: Boolean,
    val isStale: Boolean,
    val isError: Boolean,
    val errorKind: QueryErrorKind?,
) {
    companion object {
        /** The pre-resolution / no-vehicle state: nothing loaded, neutral freshness (web `enabled:false`). */
        val EMPTY: LiveSignalsTableState =
            LiveSignalsTableState(
                response = null,
                updatedAtMillis = null,
                isFetching = false,
                isStale = false,
                isError = false,
                errorKind = null,
            )
    }
}

/**
 * Pure projection from a live-signals [VehicleLiveSignalsResponse] to render-ready [LiveSignalRow]s — the
 * native port of the web `rowFromEntry` + `renderValue` field reads. Each `signals` entry is either a
 * `{ value, timestamp }` envelope or a bare scalar; both shapes flow through unchanged.
 */
object LiveSignalsTableProjection {
    /** Web `Object.keys(signals).map(rowFromEntry)`: one row per signal, in the map's iteration order. */
    fun projectRows(response: VehicleLiveSignalsResponse?): List<LiveSignalRow> {
        val signals = response?.signals ?: return emptyList()
        return signals.entries.map { (name, raw) -> rowFromEntry(name, raw) }
    }

    /**
     * Web `rowFromEntry`: when [raw] is an object carrying a `value` key it is unwrapped into its value +
     * optional `timestamp`; otherwise the whole element is the value (e.g. a compound location triple).
     */
    fun rowFromEntry(
        name: String,
        raw: JsonElement,
    ): LiveSignalRow {
        if (raw is JsonObject && raw.containsKey("value")) {
            return LiveSignalRow(
                name = name,
                value = renderValue(raw["value"]),
                timestampMillis = parseTimestampMillis(stringField(raw["timestamp"])),
            )
        }
        return LiveSignalRow(name = name, value = renderValue(raw), timestampMillis = null)
    }

    /**
     * Web `renderValue`: `null`→"null", absent→em dash, string→the string, number/boolean→its literal,
     * and any compound (object/array) is compact-JSON-encoded so a typed value never crashes the cell.
     */
    fun renderValue(value: JsonElement?): String =
        when (value) {
            null -> EM_DASH
            is JsonNull -> NULL_LITERAL
            is JsonPrimitive -> value.content
            is JsonObject, is JsonArray ->
                runCatching { VALUE_JSON.encodeToString(JsonElement.serializer(), value) }.getOrDefault(EM_DASH)
        }

    /** Web `Date.parse(timestamp)`: the epoch-ms of an ISO-8601 instant, or `null` when blank/unparseable. */
    fun parseTimestampMillis(timestamp: String?): Long? {
        if (timestamp.isNullOrBlank()) return null
        return runCatching {
            java.time.Instant
                .parse(timestamp)
                .toEpochMilli()
        }.getOrNull()
    }

    /** Web `rows.filter(r => r.name.toLowerCase().includes(q))`; a blank query returns every row. */
    fun filterRows(
        rows: List<LiveSignalRow>,
        query: String,
    ): List<LiveSignalRow> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return rows
        return rows.filter { it.name.lowercase().contains(q) }
    }

    /**
     * Web sort comparator: by `name` (lexicographic) or by `timestamp` (parsed ms, missing→0), flipped by
     * the [sort] direction. An unsortable / unknown key leaves the (already filtered) order untouched (web
     * `return 0`).
     */
    fun sortRows(
        rows: List<LiveSignalRow>,
        sort: SortState,
    ): List<LiveSignalRow> {
        val dir = if (sort.direction == SortDirection.Asc) 1 else -1
        val comparator =
            when (sort.key) {
                COL_NAME -> Comparator { a: LiveSignalRow, b: LiveSignalRow -> a.name.compareTo(b.name) * dir }
                COL_TIMESTAMP ->
                    Comparator { a: LiveSignalRow, b: LiveSignalRow ->
                        (a.timestampMillis ?: 0L).compareTo(b.timestampMillis ?: 0L) * dir
                    }
                else -> return rows
            }
        return rows.sortedWith(comparator)
    }

    /**
     * The relative "Last update" label (web `<TimeStamp format="relative" />`) for a parsed [millis] against
     * [nowMillis], or `null` when the row has no timestamp (the cell then renders the em dash). Reuses the
     * shared freshness bucketing/formatter so it matches every other relative time in the app; a localized
     * formatter may be substituted at the boundary (ADR-014).
     */
    fun relativeTimestampLabel(
        millis: Long?,
        nowMillis: Long,
    ): String? {
        if (millis == null) return null
        return formatFreshnessAge(relativeAge(computeAgeSeconds(millis, nowMillis)))
    }

    /**
     * Classify a feed failure into the recovery copy the `QueryError` branch shows — the native analogue of
     * the web `classifyQueryError`. HTTP status drives not-found / unauthorized / server; transport failures
     * map to the generic network branch and an open breaker to the transient waiting branch.
     */
    fun queryErrorKindOf(error: Throwable?): QueryErrorKind =
        when (error) {
            is ApiError.Http ->
                when {
                    error.status == HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    error.status == HTTP_UNAUTHORIZED || error.status == HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    error.status >= HTTP_SERVER_ERROR -> QueryErrorKind.ServerError
                    else -> QueryErrorKind.Network
                }
            is ApiError.CircuitOpen -> QueryErrorKind.Waiting
            else -> QueryErrorKind.Network
        }

    /** Read a JSON string field, or `null` when absent / `JsonNull` / not a quoted string (web typed `string`). */
    private fun stringField(element: JsonElement?): String? = (element as? JsonPrimitive)?.let { if (it.isString) it.content else null }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [LIVE_SIGNALS_TABLE_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * composable's first-composition effect.
 */
fun recordLiveSignalsTableOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to LIVE_SIGNALS_TABLE_SLUG))
}
