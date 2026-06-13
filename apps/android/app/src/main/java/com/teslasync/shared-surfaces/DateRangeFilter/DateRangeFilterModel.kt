// Pure, framework-free model + presets + projection + diagnostics for the DateRangeFilter shared surface —
// the native analogue of web/src/components/forms/DateRangeFilter.tsx together with its quick-select chips
// (web/src/components/forms/DatePresetChips.tsx) and the preset math (web/src/lib/datePresets.ts). No
// Compose, no Android UI, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web source is a CONTROLLED date-range filter: it receives `startDate`/`endDate` (ISO YYYY-MM-DD), emits
// `onStartDateChange` / `onEndDateChange` / `onRangeChange` / `onApply`, derives the active preset id with
// `matchPresetId(startDate,endDate)`, and renders two date inputs + an optional Apply button + a row of
// quick-select preset chips (DEFAULT_PRESET_IDS = today / 7d / 30d / mtd / ytd / all). It performs NO data
// fetching of its own; its only "data source" is the page URL the host wires through `useUrlBatch` (the
// `from`/`to` query params). This file reproduces that contract exactly — the ISO selection, the eleven
// presets resolved against the user's LOCAL calendar day (web `iso(new Date())`), the canonical preset match,
// and the render-ready projection — and folds the URL-state read into the cache-then-network freshness
// envelope so the surface can honestly render the prompt's loading / empty / error / stale / offline matrix
// without ever hiding the control.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): the web filter always shows its
// control; the loading / error / stale / offline branches here are the lifecycle envelope of the URL-state
// read the native surface binds through [DateRangeFilterSource] (the `useUrlBatch` analogue), never invented
// content. The control itself is identical in every state — only a freshness chip / skeleton / retry frame is
// added around it — so no region is ever blanked.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DateRangeFilter — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path, exactly as the sibling Range / ChartHiddenSeriesContext surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.daterangefilter

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate

/**
 * Canonical registry metadata for the DateRangeFilter surface — the native mirror of the web component's
 * contract. The diagnostics slug and the `from`/`to` query-param names the URL state persists under are
 * pinned here so the native and web surfaces stay in lockstep.
 */
object DateRangeFilterRegistration {
    /** Diagnostics surface slug emitted with the one-shot `view.opened` event (P1/S11). */
    const val SLUG: String = "DateRangeFilter"

    /** URL query-param the start date persists under (web `useUrlBatch({ from })`). */
    const val FROM_PARAM: String = "from"

    /** URL query-param the end date persists under (web `useUrlBatch({ to })`). */
    const val TO_PARAM: String = "to"

    /** The em dash drawn for a date field with no value (web empty `<input type="date">`). */
    const val EMPTY_VALUE: String = "\u2014"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface first composes (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted when the surface re-reads its URL state after an error / stale TTL. */
const val EVENT_REFRESH: String = "dateRangeFilter.refresh"

/** The structured-field key carrying the surface slug on every emitted diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The inclusive `[start, end]` date selection a filter carries — the native port of the web `startDate` /
 * `endDate` props (ISO `YYYY-MM-DD` strings). A blank string means "not set", which the projection renders
 * as the em-dash empty field, exactly like the web empty date input.
 *
 * @property start inclusive start date as `YYYY-MM-DD`, or `""` when unset.
 * @property end inclusive end date as `YYYY-MM-DD`, or `""` when unset.
 */
data class DateRangeSelection(
    val start: String = "",
    val end: String = "",
) {
    /** True when neither bound is set — the surface's structurally-empty state (web both inputs blank). */
    val isUnset: Boolean get() = start.isBlank() && end.isBlank()

    companion object {
        /** The empty selection — both bounds unset. */
        val EMPTY: DateRangeSelection = DateRangeSelection()
    }
}

/** A resolved preset window — the native port of the web `DatePresetRange` (`{ start, end }`). */
data class DatePresetRange(
    val start: String,
    val end: String,
)

/**
 * A quick-select preset — the native port of the web `DatePreset`. [resolve] returns the window for a given
 * "today" so the surface matches the user's wall-clock day (web `iso(new Date())`); tests pass a fixed date.
 *
 * @property id stable preset id (web `DatePreset.id`).
 * @property i18nKey the P1/S10 catalog key for the chip label (web `DatePreset.i18nKey`).
 * @property fallback the English fallback the web ships (web `DatePreset.fallback`).
 * @property resolve resolves the `[start, end]` window for a supplied local "today".
 */
class DatePreset(
    val id: String,
    val i18nKey: String,
    val fallback: String,
    val resolve: (LocalDate) -> DatePresetRange,
)

/** Formats a [LocalDate] as `YYYY-MM-DD` using its LOCAL calendar fields — the native port of web `iso(d)`. */
fun isoDate(date: LocalDate): String = date.toString()

/** The "All time" baseline start the web uses (`'2015-01-01'`, ≈ the Tesla data-history floor). */
const val ALL_TIME_BASELINE: String = "2015-01-01"

/**
 * The eleven quick-select presets — a verbatim native port of the web `DATE_PRESETS` list. Every window is
 * resolved against the supplied local "today" so "Today" matches the user's wall-clock day even at 23:30, and
 * month/quarter/year boundaries use the calendar, exactly like the web `Date` math.
 */
val DATE_PRESETS: List<DatePreset> =
    listOf(
        DatePreset("today", "date.preset.today", "Today") { now -> DatePresetRange(isoDate(now), isoDate(now)) },
        DatePreset("yesterday", "date.preset.yesterday", "Yesterday") { now ->
            val y = now.minusDays(1)
            DatePresetRange(isoDate(y), isoDate(y))
        },
        DatePreset("7d", "date.preset.last7", "Last 7 days") { now ->
            DatePresetRange(isoDate(now.minusDays(DAYS_7 - 1)), isoDate(now))
        },
        DatePreset("30d", "date.preset.last30", "Last 30 days") { now ->
            DatePresetRange(isoDate(now.minusDays(DAYS_30 - 1)), isoDate(now))
        },
        DatePreset("90d", "date.preset.last90", "Last 90 days") { now ->
            DatePresetRange(isoDate(now.minusDays(DAYS_90 - 1)), isoDate(now))
        },
        DatePreset("mtd", "date.preset.mtd", "Month to date") { now ->
            DatePresetRange(isoDate(now.withDayOfMonth(1)), isoDate(now))
        },
        DatePreset("qtd", "date.preset.qtd", "Quarter to date") { now ->
            val firstMonthOfQuarter = ((now.monthValue - 1) / MONTHS_PER_QUARTER) * MONTHS_PER_QUARTER + 1
            DatePresetRange(isoDate(LocalDate.of(now.year, firstMonthOfQuarter, 1)), isoDate(now))
        },
        DatePreset("ytd", "date.preset.ytd", "Year to date") { now ->
            DatePresetRange(isoDate(LocalDate.of(now.year, 1, 1)), isoDate(now))
        },
        DatePreset("lastMonth", "date.preset.lastMonth", "Last month") { now ->
            val start = now.minusMonths(1).withDayOfMonth(1)
            val end = now.withDayOfMonth(1).minusDays(1)
            DatePresetRange(isoDate(start), isoDate(end))
        },
        DatePreset("1y", "date.preset.last1y", "Last year") { now ->
            DatePresetRange(isoDate(now.minusYears(1)), isoDate(now))
        },
        DatePreset("all", "date.preset.all", "All time") { now ->
            DatePresetRange(ALL_TIME_BASELINE, isoDate(now))
        },
    )

/** Default chip set rendered when callers do not pass `presetIds` — the native port of web `DEFAULT_PRESET_IDS`. */
val DEFAULT_PRESET_IDS: List<String> = listOf("today", "7d", "30d", "mtd", "ytd", "all")

/** Looks up a preset by id, or `null` when unknown — the native port of web `getDatePreset`. */
fun getDatePreset(id: String): DatePreset? = DATE_PRESETS.firstOrNull { it.id == id }

/**
 * Resolves the "All time" start, optionally clamped to a smarter floor — the native port of web
 * `resolveAllTimeStart`. Defaults to [ALL_TIME_BASELINE]; a later [minDate] (the user's first data point)
 * wins so a 2024-onward user does not see nine empty years.
 */
fun resolveAllTimeStart(minDate: String? = null): String {
    if (minDate.isNullOrBlank()) return ALL_TIME_BASELINE
    return if (minDate > ALL_TIME_BASELINE) minDate else ALL_TIME_BASELINE
}

/**
 * Returns the id of the preset whose resolved window equals `[start, end]` for the supplied [today], or
 * `null` when none match — the native port of web `matchPresetId`. Drives the active-chip highlight.
 */
fun matchPresetId(
    start: String,
    end: String,
    today: LocalDate,
): String? {
    val match =
        DATE_PRESETS.firstOrNull { preset ->
            val window = preset.resolve(today)
            window.start == start && window.end == end
        }
    return match?.id
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `DateRangeFilter` folds
 * together: the [phase] surface, the current [start]/[end] selection, the [activePresetId] highlight, and the
 * cache-then-network freshness envelope ([stale]/[offline]/[refreshing] + [errorKind]) of the URL-state read
 * so cached selections are flagged honestly instead of shown as live. Pure data so [DateRangeFilterProjection]
 * is unit-tested without a UI host.
 *
 * @property freshnessStamp the `fetchedAt` of the shown selection; keys the stale auto-refresh effect.
 */
data class DateRangeFilterDisplay(
    val phase: UiPhase,
    val start: String = "",
    val end: String = "",
    val activePresetId: String? = null,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** The start value to draw: the ISO date, or the em dash when unset (web empty input). */
    val displayStart: String get() = start.ifBlank { DateRangeFilterRegistration.EMPTY_VALUE }

    /** The end value to draw: the ISO date, or the em dash when unset. */
    val displayEnd: String get() = end.ifBlank { DateRangeFilterRegistration.EMPTY_VALUE }

    /** True when a freshness chip (stale or offline) should be shown over the cached selection. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == UiPhase.Error
}

/**
 * Pure projection + error-classification logic for the DateRangeFilter surface — the native port of the web
 * component's render-time derivation (`matchPresetId` + the controlled selection) folded with the URL-state
 * read's lifecycle.
 */
object DateRangeFilterProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Folds the URL-state [state] (the selection feed the surface binds through [DateRangeFilterSource]) and
     * the local [today] into the render-ready [DateRangeFilterDisplay].
     *
     * Phase resolution honours the URL-state read's async lifecycle: a hard read failure with no cache →
     * [UiPhase.Error]; a first read with nothing cached → [UiPhase.Loading]; an unset selection (both bounds
     * blank) → [UiPhase.Empty]; otherwise the selection is available (fresh or cached) → [UiPhase.Content].
     * The active preset id is matched for the highlight in every non-error phase.
     */
    fun project(
        state: UiState<DateRangeSelection>,
        today: LocalDate,
    ): DateRangeFilterDisplay {
        val selection = state.data ?: DateRangeSelection.EMPTY
        val phase =
            when {
                state.isError -> UiPhase.Error
                state.isLoading -> UiPhase.Loading
                state.isEmpty -> UiPhase.Empty
                else -> UiPhase.Content
            }
        return DateRangeFilterDisplay(
            phase = phase,
            start = selection.start,
            end = selection.end,
            activePresetId = if (phase == UiPhase.Error) null else matchPresetId(selection.start, selection.end, today),
            stale = state.stale && state.errorKind == null,
            offline = state.stale && state.hasData && state.errorKind != null,
            refreshing = state.refreshing,
            errorKind = state.errorKind,
            httpStatus = state.httpStatus,
            freshnessStamp = state.fetchedAt,
        )
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP / decode / unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: DateRangeFilterDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [DateRangeFilterRegistration.SLUG] (P1/S11) — never the selected dates, a VIN, or a vehicle id, so a
 * diagnostics line can never leak which window a user is viewing. Kept free of Compose so it is unit-tested
 * with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordDateRangeFilterOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to DateRangeFilterRegistration.SLUG))
}

private const val DAYS_7 = 7L
private const val DAYS_30 = 30L
private const val DAYS_90 = 90L
private const val MONTHS_PER_QUARTER = 3
