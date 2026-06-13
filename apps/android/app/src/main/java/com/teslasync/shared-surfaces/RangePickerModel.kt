// Pure, framework-free model + preset taxonomy + projection for the RangePicker shared surface — the native
// analogue of every value the web component derives before it returns JSX
// (web/src/components/forms/RangePicker.tsx + web/src/lib/datePresets.ts). No Compose, no Android UI, no HTTP:
// every declaration here is exercised by the :android:testReleaseUnitTest gate so the composable stays a thin
// render layer (the same split the sibling SectionErrorBoundary / SavedViewMenu surfaces use).
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a single-trigger date
// range filter. A compact trigger shows the active preset label + the formatted committed range; clicking it
// opens a popover with a preset list (each preset applies immediately + closes + fires `onChange`), a range
// calendar that STAGES a selection (only `Apply` commits; `Cancel` / dismiss discards), an optional "Compare to
// previous period" toggle (`onCompareChange`), and a footer day-count summary. `presetsOnly` hides the calendar
// + footer for pages whose backend only accepts trailing-period queries. This model reproduces the preset
// resolution, the active-preset match, the "All time" floor, the inclusive day-count math, the locale range
// formatting, and the staged-dirty/Apply-enabled decision exactly so the composable never re-implements logic.
//
// The one hook the prompt lists, `useTranslation`, is the i18n catalog (P1/S10) — resolved at the render
// boundary by the composable, never here. There is NO data hook, NO fetch, and NO data port to bind (no P1/S8
// Source/ViewModel): modelling one would invent an async dependency the web spec does not have (honesty
// covenant: no scope narrowing, no silent drift). The closest precedent is the equally presentational
// SectionErrorBoundary surface (composable + model, no Source/ViewModel).
//
// Why the generic data-surface states (loading / empty / stale / offline / error) are intentionally absent: this
// surface fetches nothing — it is a controlled input whose value + callbacks come from its host. There is no
// query to be loading, to be empty, to go stale, to be offline, or to fail, so inventing those states would be
// dishonest. The surface's REAL, fully-reproduced states are instead: the collapsed trigger, the open preset
// list (with the active preset highlighted vs. a custom range), the open calendar with NO staged selection
// (Apply disabled — the genuine "empty" analogue), the open calendar with a dirty staged range (Apply enabled),
// the `presetsOnly` variant (calendar + footer hidden), and the compare-enabled variant (toggle shown) — each
// reduced here as pure data and asserted off-device, doubling as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/RangePicker — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling SectionErrorBoundary / SavedViewMenu surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.rangepicker

import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Canonical registry metadata for the RangePicker surface — the native mirror of the web component's contract.
 * The diagnostics [SLUG], the structured-log event names, and the structured-field keys are pinned here so the
 * native and web surfaces stay in lockstep. The diagnostics carry only constant identifiers (the surface slug,
 * a preset id, a boolean) — never the selected dates — so a diagnostics line can never leak a user's range.
 */
object RangePickerRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RangePicker"

    /** Structured-log field key carrying the surface slug on every diagnostic. */
    const val SURFACE_KEY: String = "surface"

    /** Structured-log field key carrying the applied preset id (a constant like `7d`, never a date). */
    const val PRESET_KEY: String = "preset"

    /** Structured-log field key carrying the compare-toggle boolean as a string. */
    const val ENABLED_KEY: String = "enabled"

    /** Emitted once when the surface first composes. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** Emitted when a preset is clicked (web `onChange(r, preset.id)`); carries only the preset id. */
    const val EVENT_PRESET_APPLIED: String = "dateRange.presetApplied"

    /** Emitted when a staged custom range is applied (web `Apply` → `onChange`); carries no dates. */
    const val EVENT_CUSTOM_APPLIED: String = "dateRange.customApplied"

    /** Emitted when a staged range is discarded (web `Cancel` / dismiss). */
    const val EVENT_CANCELED: String = "dateRange.canceled"

    /** Emitted when the compare toggle flips (web `onCompareChange`); carries the new boolean. */
    const val EVENT_COMPARE_TOGGLED: String = "dateRange.compareToggled"
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). Every event carries only constant identifiers — the
 * surface [SLUG], a preset id, or a boolean — never the selected start/end dates, so a diagnostics line can
 * never leak the range a user picked. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object RangePickerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = RangePickerRegistration.SLUG

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG] (P1/S11). Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(RangePickerRegistration.EVENT_VIEW_OPENED, surfaceFields())
    }

    /** Emits the preset-applied diagnostic carrying only the surface slug + the constant [presetId]. */
    fun recordPresetApplied(
        logger: Logger,
        presetId: String,
    ) {
        logger.info(RangePickerRegistration.EVENT_PRESET_APPLIED, surfaceFields(RangePickerRegistration.PRESET_KEY to presetId))
    }

    /** Emits the custom-range-applied diagnostic — surface slug only, never the staged dates. */
    fun recordCustomApplied(logger: Logger) {
        logger.info(RangePickerRegistration.EVENT_CUSTOM_APPLIED, surfaceFields())
    }

    /** Emits the staged-range-discarded diagnostic (web `Cancel` / dismiss) — surface slug only. */
    fun recordCanceled(logger: Logger) {
        logger.info(RangePickerRegistration.EVENT_CANCELED, surfaceFields())
    }

    /** Emits the compare-toggled diagnostic carrying the surface slug + the new [enabled] boolean. */
    fun recordCompareToggled(
        logger: Logger,
        enabled: Boolean,
    ) {
        logger.info(
            RangePickerRegistration.EVENT_COMPARE_TOGGLED,
            surfaceFields(RangePickerRegistration.ENABLED_KEY to enabled.toString()),
        )
    }

    private fun surfaceFields(vararg extra: Pair<String, String>): Map<String, String> =
        mapOf(RangePickerRegistration.SURFACE_KEY to SLUG, *extra)
}

/**
 * An inclusive ISO date range (`YYYY-MM-DD` strings) — the native mirror of the web `RangePickerValue`. Both
 * bounds are local calendar days, never instants, so a range never shifts across time zones.
 */
data class RangePickerValue(
    val start: String,
    val end: String,
)

/**
 * One quick-select preset — the native port of the web `DatePreset` (`web/src/lib/datePresets.ts`). [id] is the
 * stable identifier matched against the active range and emitted in diagnostics; [i18nKey] is the web
 * translation key (the composable maps it to the matching Android string resource); [resolve] computes the
 * inclusive range relative to a supplied "today" so the function is deterministic and unit-testable (the web
 * `resolve(now)` defaulting to the wall clock).
 */
data class DatePresetSpec(
    val id: String,
    val i18nKey: String,
    val resolve: (today: LocalDate) -> RangePickerValue,
)

/**
 * Pure preset taxonomy + range logic for the RangePicker surface — the native port of `web/src/lib/datePresets.ts`
 * and the web component's `useMemo`-derived active preset / formatted range / day-count / staged-dirty values.
 */
object RangePickerLogic {
    /** Floor for the "All time" preset and for any user-selectable date (web `'2015-01-01'` baseline). */
    const val ALL_TIME_BASELINE: String = "2015-01-01"

    /** The full preset set, in render order — a 1:1 port of the web `DATE_PRESETS` array. */
    val DATE_PRESETS: List<DatePresetSpec> =
        listOf(
            DatePresetSpec("today", "date.preset.today") { now -> RangePickerValue(iso(now), iso(now)) },
            DatePresetSpec("yesterday", "date.preset.yesterday") { now ->
                val y = now.minusDays(1)
                RangePickerValue(iso(y), iso(y))
            },
            DatePresetSpec("7d", "date.preset.last7") { now -> RangePickerValue(iso(now.minusDays(DAYS_WEEK)), iso(now)) },
            DatePresetSpec("30d", "date.preset.last30") { now -> RangePickerValue(iso(now.minusDays(DAYS_MONTH)), iso(now)) },
            DatePresetSpec("90d", "date.preset.last90") { now -> RangePickerValue(iso(now.minusDays(DAYS_QUARTER)), iso(now)) },
            DatePresetSpec("mtd", "date.preset.mtd") { now -> RangePickerValue(iso(now.withDayOfMonth(1)), iso(now)) },
            DatePresetSpec("qtd", "date.preset.qtd") { now ->
                val firstMonthOfQuarter = ((now.monthValue - 1) / MONTHS_PER_QUARTER) * MONTHS_PER_QUARTER + 1
                RangePickerValue(iso(LocalDate.of(now.year, firstMonthOfQuarter, 1)), iso(now))
            },
            DatePresetSpec("ytd", "date.preset.ytd") { now -> RangePickerValue(iso(LocalDate.of(now.year, 1, 1)), iso(now)) },
            DatePresetSpec("lastMonth", "date.preset.lastMonth") { now ->
                val firstOfThisMonth = now.withDayOfMonth(1)
                RangePickerValue(iso(firstOfThisMonth.minusMonths(1)), iso(firstOfThisMonth.minusDays(1)))
            },
            DatePresetSpec("1y", "date.preset.last1y") { now -> RangePickerValue(iso(now.minusYears(1)), iso(now)) },
            DatePresetSpec("all", "date.preset.all") { now -> RangePickerValue(ALL_TIME_BASELINE, iso(now)) },
        )

    /** Default chip set rendered when a caller passes no `presetIds` (web `DEFAULT_PRESET_IDS`). */
    val DEFAULT_PRESET_IDS: List<String> = listOf("today", "7d", "30d", "mtd", "ytd", "all")

    /** Looks up a preset by [id] (web `getDatePreset`), or `null` when unknown. */
    fun getDatePreset(id: String): DatePresetSpec? = DATE_PRESETS.firstOrNull { it.id == id }

    /**
     * The presets to render for [presetIds], preserving the canonical [DATE_PRESETS] order regardless of the
     * order of [presetIds] — the web `DATE_PRESETS.filter(p => presetIds.includes(p.id))`.
     */
    fun presetsFor(presetIds: List<String>): List<DatePresetSpec> = DATE_PRESETS.filter { it.id in presetIds }

    /**
     * The start date for the "All time" preset (web `resolveAllTimeStart`): the [ALL_TIME_BASELINE] baseline,
     * clamped up to [minDate] when the caller passes a later first-data-point floor.
     */
    fun resolveAllTimeStart(minDate: String?): String = if (minDate != null && minDate > ALL_TIME_BASELINE) minDate else ALL_TIME_BASELINE

    /**
     * The committed range for clicking preset [id] (web `handlePreset`): the preset's resolved range, with the
     * "All time" start floored to [minDate] via [resolveAllTimeStart]. `null` when [id] is unknown.
     */
    fun appliedRangeForPreset(
        id: String,
        today: LocalDate,
        minDate: String?,
    ): RangePickerValue? {
        val preset = getDatePreset(id) ?: return null
        val resolved = preset.resolve(today)
        return if (id == "all") resolved.copy(start = resolveAllTimeStart(minDate)) else resolved
    }

    /**
     * The id of the preset whose resolved range equals ([start], [end]) relative to [today] (web `matchPresetId`),
     * or `null` when the committed range is a custom range matching no preset.
     */
    fun matchPresetId(
        start: String,
        end: String,
        today: LocalDate,
    ): String? = DATE_PRESETS.firstOrNull { it.resolve(today).let { r -> r.start == start && r.end == end } }?.id

    /** Parses a `YYYY-MM-DD` string to a local [LocalDate] (web `dateFromIso`, time-zone-free). */
    fun dateOf(iso: String): LocalDate = LocalDate.parse(iso, DateTimeFormatter.ISO_LOCAL_DATE)

    /** Formats a [LocalDate] as `YYYY-MM-DD` (web `isoFromDate`). */
    fun iso(date: LocalDate): String = date.format(DateTimeFormatter.ISO_LOCAL_DATE)

    /**
     * UTC-midnight epoch-millisecond value for a `YYYY-MM-DD` string — the value the Material 3 range calendar
     * (which works in UTC epoch millis) consumes to seed + bound its selection. The inverse is [utcMillisToIso].
     */
    fun isoToUtcMillis(iso: String): Long = dateOf(iso).toEpochDay() * MILLIS_PER_DAY

    /** Projects a Material 3 UTC-midnight selection back to a `YYYY-MM-DD` string (inverse of [isoToUtcMillis]). */
    fun utcMillisToIso(millis: Long): String = iso(LocalDate.ofEpochDay(Math.floorDiv(millis, MILLIS_PER_DAY)))

    /** Inclusive day count between [start] and [end], floored at 1 (web `diffDaysInclusive`). */
    fun diffDaysInclusive(
        start: String,
        end: String,
    ): Int = maxOf(1L, ChronoUnit.DAYS.between(dateOf(start), dateOf(end)) + 1).toInt()

    /**
     * The trigger sub-label range text (web `formatRange`): a single localized day for a one-day range, else
     * `start – end` with an en-dash, omitting the start year when both bounds share a year.
     */
    fun formatRange(
        start: String,
        end: String,
        locale: Locale,
    ): String {
        val s = dateOf(start)
        val e = dateOf(end)
        if (start == end) return formatDay(s, withYear = true, locale = locale)
        val sameYear = s.year == e.year
        return "${formatDay(s, withYear = !sameYear, locale = locale)} – ${formatDay(e, withYear = true, locale = locale)}"
    }

    /**
     * Whether the staged range differs from the committed [value] and is therefore appliable (web `stagedDirty`):
     * both staged bounds must be present and at least one must differ from the committed bound.
     */
    fun stagedIsDirty(
        stagedStart: String?,
        stagedEnd: String?,
        value: RangePickerValue,
    ): Boolean = stagedStart != null && stagedEnd != null && (stagedStart != value.start || stagedEnd != value.end)

    /** Inclusive day count of the staged range, or `null` when the range is incomplete (web `stagedDays`). */
    fun stagedDayCount(
        stagedStart: String?,
        stagedEnd: String?,
    ): Int? = if (stagedStart != null && stagedEnd != null) diffDaysInclusive(stagedStart, stagedEnd) else null

    /**
     * The merged TalkBack announcement for the trigger — the localized [triggerName] (web `aria-label`
     * "Date range"), the active preset [activeLabel], and the formatted [rangeText] joined into one sentence so
     * the control is never an unlabelled tap target. Pure so the label is unit-tested without a Compose host.
     */
    fun triggerAccessibilityLabel(
        triggerName: String,
        activeLabel: String,
        rangeText: String,
    ): String = listOf(triggerName, activeLabel, rangeText).filter { it.isNotBlank() }.joinToString(separator = ", ")

    private fun formatDay(
        date: LocalDate,
        withYear: Boolean,
        locale: Locale,
    ): String = date.format(DateTimeFormatter.ofPattern(if (withYear) "MMM d, yyyy" else "MMM d", locale))

    /** Milliseconds in a UTC calendar day — the Material 3 date-picker epoch-millis unit. */
    const val MILLIS_PER_DAY: Long = 86_400_000L

    private const val DAYS_WEEK = 6L
    private const val DAYS_MONTH = 29L
    private const val DAYS_QUARTER = 89L
    private const val MONTHS_PER_QUARTER = 3
}

/**
 * The immutable, render-ready projection the composable's trigger draws — everything the web `RangePicker` folds
 * from `value` before it paints the trigger: the [activePresetId] (the matched preset, or `null` for a custom
 * range), the formatted [rangeText] sub-label, and the inclusive [totalDays] count. Pure data so
 * [RangePickerProjection] is unit-tested without a UI host.
 */
data class RangePickerTriggerDisplay(
    val activePresetId: String?,
    val rangeText: String,
    val totalDays: Int,
) {
    /** True when the committed range matches a named preset (the trigger shows that preset's label). */
    val hasActivePreset: Boolean get() = activePresetId != null
}

/** Pure trigger projection for the RangePicker surface — the native port of the web component's derived trigger. */
object RangePickerProjection {
    /**
     * Folds the committed [value] (relative to [today], formatted in [locale]) into the render-ready
     * [RangePickerTriggerDisplay] the composable draws — the active preset match, the formatted range text, and
     * the inclusive total day count.
     */
    fun project(
        value: RangePickerValue,
        today: LocalDate,
        locale: Locale,
    ): RangePickerTriggerDisplay =
        RangePickerTriggerDisplay(
            activePresetId = RangePickerLogic.matchPresetId(value.start, value.end, today),
            rangeText = RangePickerLogic.formatRange(value.start, value.end, locale),
            totalDays = RangePickerLogic.diffDaysInclusive(value.start, value.end),
        )
}
