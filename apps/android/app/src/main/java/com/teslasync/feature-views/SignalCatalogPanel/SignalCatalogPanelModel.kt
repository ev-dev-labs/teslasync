// Pure, framework-free model + projection for the SignalCatalogPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/telemetry/components/SignalCatalogPanel.tsx): the `signals` map projection, the
// `staleness`/`category` derivation (web `getCatalogStalenessStyle` + the `SignalRow.category` ternary), the
// `filtered`/sort memos, the `formatStaleness` "time since" buckets, and the active/stale/never summary
// counts. No Compose, no Android framework, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer. Values are the raw SI the
// backend serves (Phase-42); this layer renders them verbatim and performs no unit conversion.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SignalCatalogPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveSignalsTable does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalcatalogpanel

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.QueryErrorKind
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
const val SIGNAL_CATALOG_PANEL_SLUG: String = "SignalCatalogPanel"

/** Em dash shown for a missing value/timestamp — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The web `String(value)` literal for a JSON `null` value. */
internal const val NULL_LITERAL: String = "null"

/** The web stable column keys (web `Column.key`); shared by the header, the cells, and the tests. */
const val COL_STATUS: String = "status"
const val COL_SIGNAL: String = "signal"
const val COL_VALUE: String = "value"
const val COL_LAST_UPDATED: String = "lastUpdated"
const val COL_TIME_SINCE: String = "timeSince"

/** The web `pagination={{ defaultPageSize: 50 }}` page size for the catalog table. */
const val SIGNAL_CATALOG_PAGE_SIZE: Int = 50

/** Web `getCatalogStalenessStyle`: < 30s ⇒ Active (green). */
internal const val ACTIVE_THRESHOLD_SECONDS: Double = 30.0

/** Web `getCatalogStalenessStyle` + `SignalRow.category`: < 300s ⇒ Aging (amber); ≥ 300s ⇒ Stale (red). */
internal const val STALE_THRESHOLD_SECONDS: Double = 300.0

private const val SECONDS_PER_MINUTE: Long = 60
private const val SECONDS_PER_HOUR: Long = 3_600

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR = 500

/** Compact (no-whitespace) encoder mirroring the web `String(value)` of a compound JSON value. */
private val VALUE_JSON: Json = Json { encodeDefaults = false }

/** The web filter pills (`CatalogFilterMode = 'all' | 'stale' | 'active'`). */
enum class CatalogFilterMode { All, Stale, Active }

/** The web sort pills (`CatalogSortMode = 'staleness' | 'alpha' | 'category'`). */
enum class CatalogSortMode { Staleness, Alpha, Category }

/**
 * The three-way `SignalRow.category` the web type defines (`'active' | 'stale' | 'never'`). Drives the
 * status badge label/variant and the active/stale/never summary counts.
 */
enum class SignalCategory { Active, Stale, Never }

/**
 * The four-way staleness bucket the web `getCatalogStalenessStyle` returns. It is finer than
 * [SignalCategory] (it splits the < 300s "active" category into Active < 30s and Aging 30–300s); the extra
 * Aging gradient drives the "Time Since" column color, where the web also tints it amber.
 */
enum class StalenessBucket { NeverReceived, Active, Aging, Stale }

/**
 * The already-localized strings the panel renders. The web component reads each via `t('signalGap.…')` (and
 * the staleness badge labels); on Android they arrive through the P1/S10 i18n facade (`stringResource`) at
 * the Compose boundary and are passed in, keeping the projection locale-stable and free of any English
 * literal.
 */
data class SignalCatalogStrings(
    val statTotal: String,
    val statActive: String,
    val statStale: String,
    val statNever: String,
    val colStatus: String,
    val colSignal: String,
    val colValue: String,
    val colLastUpdated: String,
    val colTimeSince: String,
    val filterHint: String,
    val filterAria: String,
    val filterAll: String,
    val filterStaleOnly: String,
    val filterActiveOnly: String,
    val sortMostStale: String,
    val sortAlpha: String,
    val sortCategory: String,
    val refreshInterval: String,
    val lastRefreshed: String,
    val noData: String,
    val noMatch: String,
    val badgeActive: String,
    val badgeStale: String,
    val badgeNever: String,
    val resourceName: String,
)

/**
 * One normalised catalog row — the native mirror of the web `SignalRow`. [value] is the already-rendered
 * display string (web `value != null ? String(value) : '—'`); [timestampMillis] is the parsed epoch-ms of
 * the row's `timestamp` (web `new Date(ts).getTime()`), or `null` when the row carries no timestamp (a
 * "Never received" signal — the "Last Updated"/"Time Since" columns then show the em dash).
 */
data class SignalCatalogRow(
    val name: String,
    val value: String,
    val timestampMillis: Long?,
)

/**
 * The active/stale/never tallies behind the four summary StatCards — the native port of the web
 * `activeCount`/`staleCount`/`neverCount` reductions. [total] is the full catalog size (web
 * `signals.length`).
 */
data class CatalogSummary(
    val total: Int,
    val active: Int,
    val stale: Int,
    val never: Int,
) {
    companion object {
        /** The all-zero summary shown while nothing has loaded (web `signals = []`). */
        val EMPTY: CatalogSummary = CatalogSummary(total = 0, active = 0, stale = 0, never = 0)
    }
}

/**
 * The immutable state the view-model exposes — the cache-then-network projection of the single
 * `useSignalGaps` feed the web component owns. [response] is the last-known snapshot (kept across
 * refetch/error so stale/offline still render the cached rows); the freshness flags drive the header chip +
 * auto-refresh, and [errorKind] classifies a hard failure for the `QueryError` branch.
 */
data class SignalCatalogPanelState(
    val response: VehicleLiveSignalsResponse?,
    val updatedAtMillis: Long?,
    val isFetching: Boolean,
    val isStale: Boolean,
    val isError: Boolean,
    val errorKind: QueryErrorKind?,
) {
    companion object {
        /** The pre-resolution / no-vehicle state: nothing loaded, neutral freshness (web `enabled:false`). */
        val EMPTY: SignalCatalogPanelState =
            SignalCatalogPanelState(
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
 * Pure projection from a live-signals [VehicleLiveSignalsResponse] to render-ready [SignalCatalogRow]s plus
 * the staleness/category/filter/sort logic — the native port of the web component's `signals`, `filtered`,
 * `activeCount`/`staleCount`/`neverCount` memos, `getCatalogStalenessStyle`, and `formatStaleness`.
 */
object SignalCatalogProjection {
    /** Web `Object.entries(liveData).map(...)`: one row per signal, in the map's iteration order. */
    fun projectRows(response: VehicleLiveSignalsResponse?): List<SignalCatalogRow> {
        val signals = response?.signals ?: return emptyList()
        return signals.entries.map { (name, raw) -> rowFromEntry(name, raw) }
    }

    /**
     * Web `Object.entries(liveData).map`: when [raw] is an object carrying a `value` key it is unwrapped
     * into its value + optional `timestamp`; otherwise the whole element is the value (a bare scalar).
     */
    fun rowFromEntry(
        name: String,
        raw: JsonElement,
    ): SignalCatalogRow {
        if (raw is JsonObject && raw.containsKey("value")) {
            return SignalCatalogRow(
                name = name,
                value = renderValue(raw["value"]),
                timestampMillis = parseTimestampMillis(stringField(raw["timestamp"])),
            )
        }
        return SignalCatalogRow(name = name, value = renderValue(raw), timestampMillis = null)
    }

    /**
     * Web `value != null ? String(value) : '—'`: absent ⇒ em dash, `null` ⇒ "null", string ⇒ the string,
     * number/boolean ⇒ its literal, and any compound (object/array) is compact-JSON-encoded so a typed value
     * never crashes the cell.
     */
    fun renderValue(value: JsonElement?): String =
        when (value) {
            null -> EM_DASH
            is JsonNull -> NULL_LITERAL
            is JsonPrimitive -> value.content
            is JsonObject, is JsonArray ->
                runCatching { VALUE_JSON.encodeToString(JsonElement.serializer(), value) }.getOrDefault(EM_DASH)
        }

    /** Web `new Date(ts).getTime()`: the epoch-ms of an ISO-8601 instant, or `null` when blank/unparseable. */
    fun parseTimestampMillis(timestamp: String?): Long? {
        if (timestamp.isNullOrBlank()) return null
        return runCatching {
            java.time.Instant
                .parse(timestamp)
                .toEpochMilli()
        }.getOrNull()
    }

    /**
     * Web `(now - new Date(ts).getTime()) / 1000`: the row's age in seconds against [nowMillis], floored at
     * 0; `Infinity` (web) when the row has no timestamp, so a never-received signal sorts "most stale".
     */
    fun stalenessSeconds(
        timestampMillis: Long?,
        nowMillis: Long,
    ): Double {
        if (timestampMillis == null) return Double.POSITIVE_INFINITY
        val deltaMs = nowMillis - timestampMillis
        return if (deltaMs <= 0L) 0.0 else deltaMs / MILLIS_PER_SECOND
    }

    /** Web `!ts ? 'never' : staleness > 300 ? 'stale' : 'active'`. */
    fun categoryOf(
        timestampMillis: Long?,
        nowMillis: Long,
    ): SignalCategory {
        if (timestampMillis == null) return SignalCategory.Never
        return if (stalenessSeconds(timestampMillis, nowMillis) > STALE_THRESHOLD_SECONDS) {
            SignalCategory.Stale
        } else {
            SignalCategory.Active
        }
    }

    /** Web `getCatalogStalenessStyle`: never (no ts) / Active < 30s / Aging < 300s / Stale otherwise. */
    fun stalenessBucketOf(
        timestampMillis: Long?,
        nowMillis: Long,
    ): StalenessBucket {
        if (timestampMillis == null) return StalenessBucket.NeverReceived
        val seconds = stalenessSeconds(timestampMillis, nowMillis)
        return when {
            seconds < ACTIVE_THRESHOLD_SECONDS -> StalenessBucket.Active
            seconds < STALE_THRESHOLD_SECONDS -> StalenessBucket.Aging
            else -> StalenessBucket.Stale
        }
    }

    /** Web `activeCount`/`staleCount`/`neverCount` reductions plus the total catalog size. */
    fun summarize(
        rows: List<SignalCatalogRow>,
        nowMillis: Long,
    ): CatalogSummary {
        var active = 0
        var stale = 0
        var never = 0
        for (row in rows) {
            when (categoryOf(row.timestampMillis, nowMillis)) {
                SignalCategory.Active -> active++
                SignalCategory.Stale -> stale++
                SignalCategory.Never -> never++
            }
        }
        return CatalogSummary(total = rows.size, active = active, stale = stale, never = never)
    }

    /**
     * The web `filtered` memo: a case-insensitive name search, the active/stale filter pill, then the chosen
     * sort. Staleness sorts most-stale-first (never-received ⇒ `Infinity` ⇒ top); alpha is a locale-style
     * case-insensitive compare (web `localeCompare`); category orders never → stale → active (web `order`).
     */
    fun visibleRows(
        rows: List<SignalCatalogRow>,
        query: String,
        filterMode: CatalogFilterMode,
        sortMode: CatalogSortMode,
        nowMillis: Long,
    ): List<SignalCatalogRow> {
        val searched = filterByQuery(rows, query)
        val filtered =
            when (filterMode) {
                CatalogFilterMode.All -> searched
                CatalogFilterMode.Stale ->
                    searched.filter {
                        val category = categoryOf(it.timestampMillis, nowMillis)
                        category == SignalCategory.Stale || category == SignalCategory.Never
                    }
                CatalogFilterMode.Active ->
                    searched.filter { categoryOf(it.timestampMillis, nowMillis) == SignalCategory.Active }
            }
        return sortRows(filtered, sortMode, nowMillis)
    }

    /** Web `rows.filter(s => s.name.toLowerCase().includes(q))`; a blank query returns every row. */
    fun filterByQuery(
        rows: List<SignalCatalogRow>,
        query: String,
    ): List<SignalCatalogRow> {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) return rows
        return rows.filter { it.name.lowercase().contains(needle) }
    }

    private fun sortRows(
        rows: List<SignalCatalogRow>,
        sortMode: CatalogSortMode,
        nowMillis: Long,
    ): List<SignalCatalogRow> =
        when (sortMode) {
            CatalogSortMode.Staleness ->
                rows.sortedByDescending { stalenessSeconds(it.timestampMillis, nowMillis) }
            CatalogSortMode.Alpha ->
                rows.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            CatalogSortMode.Category ->
                rows.sortedBy { categoryOrder(categoryOf(it.timestampMillis, nowMillis)) }
        }

    /** Web `order = { never: 0, stale: 1, active: 2 }`. */
    private fun categoryOrder(category: SignalCategory): Int =
        when (category) {
            SignalCategory.Never -> 0
            SignalCategory.Stale -> 1
            SignalCategory.Active -> 2
        }

    /**
     * The "Time Since" bucket (web `formatStaleness`): `< 60s` ⇒ seconds, `< 3600s` ⇒ minutes, else hours.
     * Returns `null` for a never-received row (web `Number.isFinite` guard ⇒ the cell shows the em dash).
     * The Compose boundary renders the bucket through the localized `freshness.*` keys (P1/S10).
     */
    fun stalenessAge(
        timestampMillis: Long?,
        nowMillis: Long,
    ): FreshnessAge? {
        // A never-received row yields `Infinity` (web `Number.isFinite` guard ⇒ em dash), so the single
        // finiteness check covers both the null-timestamp and the unparseable cases.
        val seconds = stalenessSeconds(timestampMillis, nowMillis)
        if (!seconds.isFinite()) return null
        val whole = seconds.toLong().coerceAtLeast(0)
        return when {
            whole < SECONDS_PER_MINUTE -> FreshnessAge.Seconds(whole)
            whole < SECONDS_PER_HOUR -> FreshnessAge.Minutes(whole / SECONDS_PER_MINUTE)
            else -> FreshnessAge.Hours(whole / SECONDS_PER_HOUR)
        }
    }

    /** The "Last refreshed" relative bucket (web `<TimeStamp format="relative" />` of `dataUpdatedAt`). */
    fun lastRefreshedAge(
        updatedAtMillis: Long?,
        nowMillis: Long,
    ): FreshnessAge = relativeAge(computeAgeSeconds(updatedAtMillis, nowMillis))

    /** The localized badge label for a [category], picked from the resolved [strings]. */
    fun badgeLabel(
        category: SignalCategory,
        strings: SignalCatalogStrings,
    ): String =
        when (category) {
            SignalCategory.Active -> strings.badgeActive
            SignalCategory.Stale -> strings.badgeStale
            SignalCategory.Never -> strings.badgeNever
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

    /** Read a JSON string field, or `null` when absent / `JsonNull` / not a quoted string. */
    private fun stringField(element: JsonElement?): String? = (element as? JsonPrimitive)?.let { if (it.isString) it.content else null }

    private const val MILLIS_PER_SECOND = 1000.0
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SIGNAL_CATALOG_PANEL_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * composable's first-composition effect.
 */
fun recordSignalCatalogPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SIGNAL_CATALOG_PANEL_SLUG))
}
