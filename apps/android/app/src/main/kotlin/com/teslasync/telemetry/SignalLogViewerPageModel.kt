// Pure, framework-free model + projection for the SignalLogViewerPage telemetry surface — the native analogue of
// everything the web page derives before it returns JSX
// (web/src/features/telemetry/pages/SignalLogViewerPage.tsx, the /signal-log "query signal history from Postgres"
// workspace) plus the `adaptSignalHistoryResp`/`formatValue` reads it composes from
// web/src/components/SignalQueryControls.tsx. No Compose, no Android framework, no HTTP lives here, so the route id +
// the deferred-query control state + the `/signals/{id}/{sig}/history` → row adapter + the local-pagination slicing are
// all exercised off-device in the unit gate and the composable stays a thin render layer.
//
// The web page owns: the global `useSelectedVehicle` scope; the `useSignals` available-signal catalog that feeds the
// selector; the user's selected signals / date range / per-page / page client state; a deferred query (it only fetches
// when the user clicks Query — `enabled: queryKey !== null`) that fans out one `/signals/{id}/{sig}/history?from=&to=`
// request per selected signal, flat-maps + adapts the typed `{ts,value}` points into `SignalLogEntry` rows, and sorts
// them newest-first; and a purely-local pagination that slices that already-fetched batch (≤ a few hundred rows) per
// page. This file reproduces those decisions: [adaptSignalHistory] (the BE→FE point adapter), [signalLogIsoRange] (the
// web `new Date(`${d}T00:00:00`).toISOString()` window), [SignalLogQueryPhase] (the deferred-query lifecycle), and
// [projectResults] (the local page slice projected onto the shared [UiState]/[SignalHistoryData] the SignalHistoryTable
// feature view renders). Every visible string is resolved at the render boundary from the generated catalog (ADR-014).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/telemetry — the P3
// prompt's allowed-files path) cannot form the `io.teslasync.android.*` package the rest of the app uses, so the
// package intentionally diverges from the path — exactly as the sibling telemetry/SignalGapDetectorPage surface does.
// `MatchingDeclarationName` is suppressed for the co-located registration + state + adapter + projection + recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signallogviewer

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.android.featureviews.signalhistorytable.SignalHistoryData
import io.teslasync.android.featureviews.signalhistorytable.SignalLogEntry
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryPoint
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryResponse
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Canonical metadata for the SignalLogViewerPage surface. The web page is a top-level telemetry route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only destination in
 * Destinations.kt: `page("signalLog", "/signal-log", NavGroup.Telemetry)`) and the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11).
 */
object SignalLogViewerPageRegistration {
    /** The navigation destination id (Destinations.kt `page("signalLog", "/signal-log", …)`). */
    const val ROUTE_ID: String = "signalLog"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/signal-log"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); also the `viewModel` key. */
    const val SLUG: String = "SignalLogViewerPage"
}

/**
 * The per-page row counts offered by the "Per Page" select — the web `PER_PAGE_OPTIONS` (25 / 50 / 100 / 500).
 */
val SIGNAL_LOG_PER_PAGE_OPTIONS: List<Int> = listOf(25, 50, 100, 500)

/** The default per-page (web `useState(50)`). */
const val SIGNAL_LOG_DEFAULT_PER_PAGE: Int = 50

/**
 * The deferred-query client state — the native bundle of the web page's `useUrlArray('signals')` + `useRangeState`
 * (default preset `today`) + `useState(perPage)` + `useState(page)` + the `queryKey !== null` "has the user queried
 * yet" flag. Pure data so the page's interaction logic is unit-tested without a UI host.
 *
 * @property selectedSignals the ordered selected-signal list (web `selectedSignals`).
 * @property from inclusive start date of the query window (web `useRangeState` `start`).
 * @property to inclusive end date of the query window (web `useRangeState` `end`).
 * @property perPage the local page size (web `perPage`).
 * @property page the current 1-based page over the already-fetched batch (web `page`).
 * @property hasQueried whether the user has run at least one query (web `queryKey !== null`).
 */
data class SignalLogViewerControls(
    val selectedSignals: List<String>,
    val from: LocalDate,
    val to: LocalDate,
    val perPage: Int,
    val page: Int,
    val hasQueried: Boolean,
) {
    companion object {
        /** The neutral start state: nothing selected, the `today` preset window, page 1, never queried. */
        fun initial(today: LocalDate): SignalLogViewerControls =
            SignalLogViewerControls(
                selectedSignals = emptyList(),
                from = today,
                to = today,
                perPage = SIGNAL_LOG_DEFAULT_PER_PAGE,
                page = 1,
                hasQueried = false,
            )
    }
}

/**
 * The deferred history-query lifecycle — the native analogue of the web `useQuery({ enabled: queryKey !== null })`
 * states: it has not run yet ([NotQueried]); a fetch is in flight ([Loading]); the merged+sorted batch resolved
 * ([Loaded]); or every per-signal request rejected with nothing to show ([Failed], web `Promise.all` rejection →
 * `dataError`). Carried separately from [SignalLogViewerControls] so a page change re-slices [Loaded.rows] locally
 * without refetching.
 */
sealed interface SignalLogQueryPhase {
    /** The user has not clicked Query yet (web `queryKey === null`). */
    data object NotQueried : SignalLogQueryPhase

    /** A query is running (web `isFetching`). */
    data object Loading : SignalLogQueryPhase

    /** The merged, newest-first batch the local pagination slices (web `allRows`). */
    data class Loaded(val rows: List<SignalLogEntry>) : SignalLogQueryPhase

    /** Every per-signal request failed with no cached fallback (web `dataError`). */
    data class Failed(val error: Throwable) : SignalLogQueryPhase
}

/**
 * The immutable, render-ready page state — everything [SignalLogViewerPageContent] needs in one value. It folds the
 * resolved active-vehicle scope, the `useSignals` catalog, the deferred-query controls, and the local page slice (as a
 * shared [UiState] of [SignalHistoryData] the SignalHistoryTable renders) plus the page-level error banner text.
 *
 * @property vehicleId the resolved active-vehicle selection (web `useSelectedVehicle`), or null when none.
 * @property availableSignals the `useSignals` catalog feeding the selector options (web `availableSignals ?? []`).
 * @property selectedSignals the current selection (web `selectedSignals`).
 * @property from inclusive query-window start (web range `start`).
 * @property to inclusive query-window end (web range `end`).
 * @property perPage the local page size (web `perPage`).
 * @property page the current 1-based page (web `page`).
 * @property hasQueried whether a query has run (web `queryKey !== null`).
 * @property results the current page of history as a cache-then-network [UiState] (loading / empty / error / content).
 * @property errorMessage the page-level error-banner detail (web `getErrorMessage(anyError)`), or null when no failure.
 */
data class SignalLogViewerUiState(
    val vehicleId: Long?,
    val availableSignals: List<String>,
    val selectedSignals: List<String>,
    val from: LocalDate,
    val to: LocalDate,
    val perPage: Int,
    val page: Int,
    val hasQueried: Boolean,
    val results: UiState<SignalHistoryData>,
    val errorMessage: String?,
) {
    /** Whether a usable vehicle is selected (web `vehicleId > 0`). */
    val hasVehicle: Boolean get() = vehicleId != null && vehicleId > 0L

    /** Whether the Query button is enabled (web `canQuery` minus the always-true range guard). */
    val canQuery: Boolean get() = hasVehicle && selectedSignals.isNotEmpty()

    /** The unpaged record total used by the "{n} records" caption (web `totalRecords`). */
    val totalRecords: Int get() = results.data?.totalRows ?: 0

    companion object {
        /** The neutral start state — no vehicle, no catalog, the `today` window, never queried. */
        fun initial(today: LocalDate): SignalLogViewerUiState =
            SignalLogViewerUiState(
                vehicleId = null,
                availableSignals = emptyList(),
                selectedSignals = emptyList(),
                from = today,
                to = today,
                perPage = SIGNAL_LOG_DEFAULT_PER_PAGE,
                page = 1,
                hasQueried = false,
                results = UiState(UiPhase.Empty, SignalHistoryData.EMPTY),
                errorMessage = null,
            )
    }
}

/**
 * BE → FE point adapter — the native port of the web `adaptSignalHistoryPoint`. The typed `/signals/{id}/{sig}/history`
 * endpoint returns `{ts, kind, value}` points whose single [SignalHistoryPoint.value] is a raw JSON primitive; this
 * steers it into the `value_num` / `value_str` / `value_bool` tri-union the [SignalLogEntry] table row expects, exactly
 * as the web switch does: a JSON number → numeric (finite only, else nulled), a JSON boolean → boolean, a JSON string →
 * string, anything else (null / object / array) → a genuinely empty row (the web em-dash case).
 */
fun adaptSignalHistoryPoint(
    point: SignalHistoryPoint,
    signal: String,
): SignalLogEntry {
    val value = point.value
    return when {
        value is JsonPrimitive && value.isString -> SignalLogEntry(point.ts, signal, valueStr = value.content)
        value is JsonPrimitive -> adaptPrimitive(point.ts, signal, value)
        else -> SignalLogEntry(point.ts, signal)
    }
}

private fun adaptPrimitive(
    ts: String,
    signal: String,
    value: JsonPrimitive,
): SignalLogEntry {
    val bool = value.booleanOrNull
    if (bool != null) return SignalLogEntry(ts, signal, valueBool = bool)
    val number = value.doubleOrNull
    if (number != null && number.isFinite()) return SignalLogEntry(ts, signal, valueNum = number)
    return SignalLogEntry(ts, signal)
}

/**
 * Adapts a whole `/signals/{id}/{sig}/history` response onto its [SignalLogEntry] rows — the native port of the web
 * `adaptSignalHistoryResp`. The response's own [SignalHistoryResponse.signal] labels every row (web `resp.signal ?? ''`);
 * a [JsonNull] point value degrades to an empty row rather than throwing.
 */
fun adaptSignalHistory(response: SignalHistoryResponse): List<SignalLogEntry> {
    val signal = response.signal
    return response.data.map { point ->
        if (point.value is JsonNull) SignalLogEntry(point.ts, signal) else adaptSignalHistoryPoint(point, signal)
    }
}

/**
 * The query window as the two ISO-8601 instant strings the `from`/`to` params carry — the native port of the web
 * `new Date(`${start}T00:00:00`).toISOString()` / `new Date(`${end}T23:59:59.999`).toISOString()`. The inclusive
 * [from]/[to] dates are taken at local midnight / end-of-day in [zone] (the web `new Date('YYYY-MM-DDThh:mm:ss')` local
 * parse) and rendered as UTC instants. [zone] is injected so the conversion is unit-tested deterministically; the
 * composable supplies the device zone at the render boundary (S5).
 */
fun signalLogIsoRange(
    from: LocalDate,
    to: LocalDate,
    zone: ZoneId,
): Pair<String, String> {
    val fromInstant = from.atStartOfDay(zone).toInstant()
    val toInstant = to.atTime(END_OF_DAY).atZone(zone).toInstant()
    return DateTimeFormatter.ISO_INSTANT.format(fromInstant) to DateTimeFormatter.ISO_INSTANT.format(toInstant)
}

/**
 * Projects the deferred-query [phase] + the local pagination ([selectedSignals]/[page]/[perPage]) onto the shared
 * [UiState] of [SignalHistoryData] the SignalHistoryTable renders — the native equivalent of the web
 * `loading ? skeleton : rows.length ? table : empty` plus the deferred-query error tier:
 *  - [SignalLogQueryPhase.NotQueried] → an empty bundle (the page gates this behind its own "click Query" empty state).
 *  - [SignalLogQueryPhase.Loading] → a first-load [UiPhase.Loading] (the table's 5-line skeleton).
 *  - [SignalLogQueryPhase.Failed] → a hard [UiPhase.Error] (the table's retry surface) classified via [errorKindOf].
 *  - [SignalLogQueryPhase.Loaded] → the current page sliced locally from the batch; [UiPhase.Empty] when the slice is
 *    empty, else [UiPhase.Content].
 */
fun projectResults(
    phase: SignalLogQueryPhase,
    selectedSignals: List<String>,
    page: Int,
    perPage: Int,
): UiState<SignalHistoryData> =
    when (phase) {
        SignalLogQueryPhase.NotQueried -> UiState(UiPhase.Empty, SignalHistoryData.EMPTY)
        SignalLogQueryPhase.Loading -> UiState.loading()
        is SignalLogQueryPhase.Failed ->
            UiState(
                phase = UiPhase.Error,
                errorKind = errorKindOf(phase.error),
                httpStatus = httpStatusOf(phase.error),
            )
        is SignalLogQueryPhase.Loaded -> loadedSlice(phase.rows, selectedSignals, page, perPage)
    }

private fun loadedSlice(
    rows: List<SignalLogEntry>,
    selectedSignals: List<String>,
    page: Int,
    perPage: Int,
): UiState<SignalHistoryData> {
    val safePerPage = perPage.coerceAtLeast(1)
    val startIndex = ((page - 1) * safePerPage).coerceAtLeast(0)
    val slice = rows.drop(startIndex).take(safePerPage)
    val data =
        SignalHistoryData(
            rows = slice,
            selectedSignals = selectedSignals,
            page = page,
            pageSize = safePerPage,
            totalRows = rows.size,
        )
    return UiState(phase = if (slice.isEmpty()) UiPhase.Empty else UiPhase.Content, data = data)
}

/** The page-level error-banner detail for the [phase] — the web `getErrorMessage(anyError)`; null when not failed. */
fun signalLogErrorMessage(phase: SignalLogQueryPhase): String? =
    (phase as? SignalLogQueryPhase.Failed)?.let { failure ->
        failure.error.message?.takeIf { it.isNotBlank() } ?: failure.error::class.simpleName
    }

/**
 * Flattens the per-signal history results into one newest-first batch — the native port of the web
 * `results.flatMap(adaptSignalHistoryResp).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))`. Each row's
 * `created_at` is parsed tolerantly (RFC-3339 instant, then offset date-time, then a zoneless local date-time as UTC);
 * an unparseable timestamp sorts last so a malformed row never crashes the merge. Pure, so the deferred-query fan-out's
 * ordering is unit-tested off-device.
 */
fun mergeSignalLogRows(perSignal: List<List<SignalLogEntry>>): List<SignalLogEntry> =
    perSignal.flatten().sortedByDescending { signalLogSortKey(it.createdAt) }

/** The chronological sort key for a row's `created_at`, or [Long.MIN_VALUE] when it cannot be parsed (sorts last). */
fun signalLogSortKey(createdAt: String): Long = parseSignalLogInstant(createdAt)?.toEpochMilli() ?: Long.MIN_VALUE

private fun parseSignalLogInstant(raw: String): Instant? {
    if (raw.isBlank()) return null
    return SIGNAL_LOG_INSTANT_PARSERS.firstNotNullOfOrNull { it(raw) }
}

private val SIGNAL_LOG_INSTANT_PARSERS: List<(String) -> Instant?> =
    listOf(
        { raw -> trySignalLogInstant { Instant.parse(raw) } },
        { raw -> trySignalLogInstant { OffsetDateTime.parse(raw).toInstant() } },
        { raw -> trySignalLogInstant { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
    )

private fun trySignalLogInstant(block: () -> Instant): Instant? =
    try {
        block()
    } catch (_: DateTimeParseException) {
        null
    }

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no vehicle/signal content. */
internal fun recordSignalLogViewerPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SignalLogViewerPageRegistration.SLUG))
}

/** End-of-day with millisecond precision — the web `T23:59:59.999` upper bound. */
private val END_OF_DAY: LocalTime = LocalTime.of(23, 59, 59, 999_000_000)

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
