// Pure, framework-free metadata + page state + projections + diagnostics for the SignalsWorkspacePage telemetry
// surface — the native analogue of the cross-cutting derivations the web page owns
// (web/src/features/telemetry/pages/SignalsWorkspacePage.tsx, the unified /signals workspace). No Compose, no
// Android framework, no HTTP lives here, so the registration identity, the mode model, the pin-name extraction,
// the server-diff filter (web `diffFilteredRows`), the window-span math, and the historical chart/stats/table
// derivations (web `chartData` / `historicalStats` / pagination) are all exercised off-device by the
// :android:testDebugUnitTest gate and the composable stays a thin render layer over these pure functions.
//
// The web page is a thin orchestrator that composes the seven shared telemetry surfaces (catalog tree, chart,
// stats, history table, live tail, compare controls, diff table) around two mutually-exclusive Live / Compare
// mode toggles, leaving a sensible Historical default. So this surface carries its navigation identity, the
// resolved selection/mode it lifts out of those children (so the headline StatCards and the Run/Live gating
// read from one source of truth), the server-diff filter + window-span the four compare StatCards display, the
// historical query derivations the chart/stats/history table consume, and the one PII-safe `view.opened`
// diagnostic; the embedded feature views own their own loading / empty / error / content states.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/telemetry — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling telemetry/SignalGapDetectorPage and driving/RegenEfficiencyPage surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located registration + state + recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signalsworkspace

import io.teslasync.android.featureviews.signalchartpanel.SignalChartRow
import io.teslasync.android.featureviews.signalchartpanel.SignalStat
import io.teslasync.android.featureviews.signalcomparecontrols.DiffCategory
import io.teslasync.android.sharedsurfaces.signalquerycontrols.SignalLogEntry
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.telemetry.SignalDiffRow
import java.time.Instant
import java.time.format.DateTimeParseException
import kotlin.math.abs

/**
 * Canonical metadata for the SignalsWorkspacePage surface. The web page is a top-level telemetry route, not a
 * draggable dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting
 * concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only
 * destination at Destinations.kt: `page("signalsWorkspace", "/signals", NavGroup.Telemetry)`) and the
 * diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object SignalsWorkspacePageRegistration {
    /** The navigation destination id (Destinations.kt `page("signalsWorkspace", "/signals", …)`). */
    const val ROUTE_ID: String = "signalsWorkspace"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/signals"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); also the `viewModel` key. */
    const val SLUG: String = "SignalsWorkspacePage"

    /** Default rows-per-page for the historical table (web `PER_PAGE_OPTIONS` default 25). */
    const val DEFAULT_PER_PAGE: Int = 25

    /** Rolling tail cap shared by the live tail (web `LIVE_TAIL_MAX`). */
    const val LIVE_TAIL_MAX: Int = 500
}

/**
 * The three mutually-exclusive workspace modes the toolbar drives — the native model of the web page's two
 * boolean toggles (`isLive` / `isCompare`, mutually exclusive) with the implicit Historical default. [Live] and
 * [Compare] are the toggled states; [Historical] is the resting default (web: neither toggle on).
 */
enum class WorkspaceMode {
    Historical,
    Live,
    Compare,
    ;

    val isLive: Boolean get() = this == Live
    val isCompare: Boolean get() = this == Compare
}

/** The unified pin context for a vehicle's signal-diff pins — web `signal-diff:vehicle:${vehicleId}`. */
fun signalDiffPinContext(vehicleId: Long): String = "$SIGNAL_DIFF_PIN_CONTEXT_PREFIX$vehicleId"

/** The pinned-item id for a signal name — web `signal:${name}`. */
fun signalPinItemId(signalName: String): String = "$SIGNAL_PIN_PREFIX$signalName"

/**
 * Extracts the pinned signal-name set from the unified pin rows — the native port of the web `pinnedSignals`
 * memo: keep only `item_id`s that begin with the `signal:` prefix, stripped of that prefix. Order-independent
 * (a `Set`), exactly as the web `Set<string>` is.
 */
fun pinnedSignalNames(items: List<PinnedItem>): Set<String> =
    items
        .asSequence()
        .map { it.itemId }
        .filter { it.startsWith(SIGNAL_PIN_PREFIX) }
        .map { it.removePrefix(SIGNAL_PIN_PREFIX) }
        .toSet()

/**
 * Filters the server-diff rows by the compare controls' search + category — the native port of the web
 * `diffFilteredRows` memo: a non-blank [search] keeps rows whose name contains it (case-insensitive), and a
 * non-null [categoryId] keeps rows the matching [DiffCategory] buckets. Both are applied in the web's order, so
 * the resulting count is exactly the web "Visible after filter" figure.
 */
fun filterDiffRows(
    rows: List<SignalDiffRow>,
    search: String,
    categoryId: String?,
): List<SignalDiffRow> {
    var result = rows
    val needle = search.trim()
    if (needle.isNotEmpty()) {
        result = result.filter { it.name.contains(needle, ignoreCase = true) }
    }
    if (categoryId != null) {
        DiffCategory.fromId(categoryId)?.let { category ->
            result = result.filter { category.matches(it.name) }
        }
    }
    return result
}

/** Whether the compare filter is active (web `diffFilterActive`): a non-blank search or a selected category. */
fun diffFilterActive(
    search: String,
    categoryId: String?,
): Boolean = search.trim().isNotEmpty() || categoryId != null

/**
 * The window span in whole seconds between two ISO instants — the native port of the web `windowSpan` figure
 * (`|atB - atA| / 1000`). Returns `null` when either instant is blank or unparseable (web shows the em-dash),
 * so the caller renders the same "—" fallback the web does.
 */
fun windowSpanSeconds(
    atAIso: String,
    atBIso: String,
): Long? {
    if (atAIso.isBlank() || atBIso.isBlank()) return null
    return try {
        val a = Instant.parse(atAIso).toEpochMilli()
        val b = Instant.parse(atBIso).toEpochMilli()
        abs(b - a) / 1000L
    } catch (_: DateTimeParseException) {
        null
    }
}

/**
 * Folds every selected signal's adapted history rows into a single time-descending list — the native port of
 * the web historical `queryFn`'s `results.flatMap(adaptSignalHistoryResp).sort(desc by created_at)`. The rows
 * arrive already adapted (one [adaptSignalHistoryResp][io.teslasync.android.sharedsurfaces.signalquerycontrols.adaptSignalHistoryResp]
 * call per signal upstream); this only flattens and orders them newest-first for the table.
 */
fun mergeHistoryRows(perSignal: List<List<SignalLogEntry>>): List<SignalLogEntry> =
    perSignal
        .flatten()
        .sortedByDescending { epochMillisOrZero(it.createdAt) }

/**
 * Projects the merged history rows into time-ordered chart rows — the native port of the web `chartData` memo:
 * group the rows by timestamp, and for each instant map every signal to its numeric sample (a boolean becomes
 * `1.0`/`0.0`, an absent value a `null` gap), then sort ascending by timestamp for the chart's x-axis.
 */
fun toChartRows(rows: List<SignalLogEntry>): List<SignalChartRow> {
    if (rows.isEmpty()) return emptyList()
    val byTimestamp = LinkedHashMap<String, MutableMap<String, Double?>>()
    for (row in rows) {
        val bucket = byTimestamp.getOrPut(row.createdAt) { linkedMapOf() }
        bucket[row.signal] = numericSample(row)
    }
    return byTimestamp
        .map { (timestamp, values) -> SignalChartRow(timestamp = timestamp, values = values.toMap()) }
        .sortedBy { epochMillisOrZero(it.timestamp) }
}

/**
 * Computes per-signal min/max/avg/count over the numeric samples — the native port of the web `historicalStats`
 * memo: only `value_num` samples count, and a signal with no numeric samples is omitted entirely (so the stats
 * panel shows exactly the signals the web would).
 */
fun toStats(rows: List<SignalLogEntry>): List<SignalStat> {
    if (rows.isEmpty()) return emptyList()
    val bySignal = LinkedHashMap<String, MutableList<Double>>()
    for (row in rows) {
        val value = row.valueNum ?: continue
        bySignal.getOrPut(row.signal) { mutableListOf() }.add(value)
    }
    return bySignal.mapNotNull { (signal, values) ->
        if (values.isEmpty()) {
            null
        } else {
            SignalStat(
                signal = signal,
                min = values.min(),
                max = values.max(),
                avg = values.sum() / values.size,
                count = values.size,
            )
        }
    }
}

/** A single page-slice of the merged rows — the web `paginatedRows` (`slice((page-1)*perPage, …)`). */
fun paginateRows(
    rows: List<SignalLogEntry>,
    page: Int,
    perPage: Int,
): List<SignalLogEntry> {
    if (rows.isEmpty() || perPage <= 0) return emptyList()
    val startIndex = (page - 1).coerceAtLeast(0) * perPage
    if (startIndex >= rows.size) return emptyList()
    return rows.subList(startIndex, (startIndex + perPage).coerceAtMost(rows.size))
}

/** A boolean becomes 1.0/0.0, a numeric stays itself, everything else a gap — web chart value coercion. */
private fun numericSample(row: SignalLogEntry): Double? =
    when {
        row.valueNum != null -> row.valueNum
        row.valueBool == true -> 1.0
        row.valueBool == false -> 0.0
        else -> null
    }

/** Epoch millis for an ISO timestamp, or 0 when unparseable — keeps the comparators total. */
private fun epochMillisOrZero(iso: String): Long =
    try {
        Instant.parse(iso).toEpochMilli()
    } catch (_: DateTimeParseException) {
        0L
    }

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no vehicle content. */
internal fun recordSignalsWorkspacePageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SignalsWorkspacePageRegistration.SLUG))
}

private const val SIGNAL_DIFF_PIN_CONTEXT_PREFIX = "signal-diff:vehicle:"
private const val SIGNAL_PIN_PREFIX = "signal:"
private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
