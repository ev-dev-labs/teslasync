// Pure, framework-free model + projection for the DatePresetChips shared surface — the native analogue of the
// data the web component derives before returning JSX (web/src/components/forms/DatePresetChips.tsx and its
// registry web/src/lib/datePresets.ts). No Compose, no Android UI, no HTTP: every declaration here is exercised
// by the :android:testReleaseUnitTest gate so the composable stays a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a tiny presentational
// chip row. It filters the static `DATE_PRESETS` registry down to the caller's `presetIds`, renders one shared
// `<Button>` chip per preset (variant `primary` when it is the `activeId`, else `ghost`, with `aria-pressed`),
// and on click resolves the preset against the local wall-clock day into `{ id, start, end }` ISO date strings
// and hands that to `onSelect`. Its only hook is `useTranslation` (the i18n catalog, P1/S10) — there is NO data
// hook, NO fetch, and NO data port to bind.
//
// Why there is no P1/S8 Source/ViewModel and why the generic data-surface lifecycle states (loading / error /
// stale / offline) are intentionally absent: this surface fetches nothing. Its inputs are a static preset
// registry and the current calendar day; there is no query to be loading, to fail, to go stale, or to be
// offline, so modelling one would invent an async dependency the web spec does not have (honesty covenant: no
// scope narrowing, no silent drift). The closest sibling precedents are the equally presentational
// SectionErrorBoundary / AlertBanner / InlineCallout surfaces (composable + model, no Source/ViewModel). The
// surface's REAL, fully-reproduced states are therefore [DatePresetChipsPhase.Content] (one or more chips) and
// [DatePresetChipsPhase.Empty] (the caller's `presetIds` matched no known preset → a friendly empty state,
// never a blank box — the web renders an empty row there, which the prompt's matrix upgrades to a labelled
// empty state). Both are reduced here in [projectDatePresetChips] and asserted off-device.
//
// The existing component-library `io.teslasync.android.components.forms.DatePreset` is a different, lossy model
// (5 rolling windows in epoch-days, hard-coded English, no calendar presets) and is deliberately NOT reused:
// faithfully reproducing the web component requires the full 11-preset, calendar-aware, i18n + ISO-string
// registry, ported here exactly as web `lib/datePresets.ts` (and verified against its test vectors), the same
// approach the sibling Range surface took when the shared core lacked a port of its web helper.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DatePresetChips — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling AlertBanner / SectionErrorBoundary surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datepresetchips

import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the group's accessible-name i18n key are pinned here so the native and web surfaces stay
 * in lockstep.
 */
object DatePresetChipsRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DatePresetChips"

    /** The structured-log field key carrying the surface slug. */
    const val SURFACE_KEY: String = "surface"

    /** The one-shot diagnostic event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** i18n key for the chip group's accessible name (web `t('date.preset.label', 'Quick date range')`). */
    const val GROUP_LABEL_KEY: String = "date.preset.label"

    /** Web English fallback for the group label, rendered when the key is absent from the catalog. */
    const val GROUP_LABEL_EN: String = "Quick date range"

    /** i18n key for the empty state — reuses the present catalog key `common.noData`. */
    const val EMPTY_KEY: String = "common.noData"

    /** Web English fallback for the empty state ("No data available"). */
    const val EMPTY_EN: String = "No data available"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DatePresetChipsRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the host view calls it from the
 * first-composition effect. It carries only the static slug, so a diagnostics line can never leak a selected
 * range or any caller data.
 */
fun recordDatePresetChipsViewOpened(logger: Logger) {
    logger.info(
        DatePresetChipsRegistration.EVENT_VIEW_OPENED,
        mapOf(DatePresetChipsRegistration.SURFACE_KEY to DatePresetChipsRegistration.SLUG),
    )
}

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/** A by-name string resolver — the P1/S10 i18n facade in production, a map/fallback in tests (web `t`). */
typealias StringResolver = (key: String, fallback: String) -> String

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9_]")

/**
 * Folds a dotted i18next key into the generated Android catalog resource name (web `a.b.c` → `translation_a_b_c`),
 * matching apps/shared/i18n/generators/gen-i18n.ts `androidName`. The production resolver looks this up by name
 * and falls back to the web English when the key is absent.
 */
fun foldCatalogKey(dottedKey: String): String = "translation_" + dottedKey.replace(NON_IDENTIFIER, "_").trim('_')

/** A resolver that always returns the web English fallback — used by @Preview and the off-device unit tests. */
val FallbackResolver: StringResolver = { _, fallback -> fallback }

// ── Date-preset registry (faithful port of web/src/lib/datePresets.ts) ───────────────────────────────────────

/** An inclusive quick-range expressed as ISO `YYYY-MM-DD` strings (web `DatePresetRange`). */
data class DatePresetRange(
    val start: String,
    val end: String,
)

/**
 * One quick-select date-range preset — the native port of the web `DatePreset`. [resolve] computes the inclusive
 * [DatePresetRange] from a [LocalDate] "today" (the web `now`'s LOCAL calendar day), so "Today" matches the
 * user's wall-clock day. [i18nKey] always starts with `date.preset.`; [fallback] is the web English label.
 */
data class DatePreset(
    val id: String,
    val i18nKey: String,
    val fallback: String,
    val resolve: (today: LocalDate) -> DatePresetRange,
)

/** Format a [LocalDate] as ISO `YYYY-MM-DD` (the web `iso()` over LOCAL calendar fields). */
private fun iso(date: LocalDate): String = date.toString()

private const val LAST_7_OFFSET = 6L
private const val LAST_30_OFFSET = 29L
private const val LAST_90_OFFSET = 89L
private const val MONTHS_PER_QUARTER = 3

/** The fixed "All time" floor (≈ Tesla data-history baseline), matching the web `'2015-01-01'`. */
const val ALL_TIME_BASELINE: String = "2015-01-01"

/** The full quick-select preset registry — order-for-order identical to web `DATE_PRESETS`. */
val DATE_PRESETS: List<DatePreset> =
    listOf(
        DatePreset("today", "date.preset.today", "Today") { today ->
            DatePresetRange(iso(today), iso(today))
        },
        DatePreset("yesterday", "date.preset.yesterday", "Yesterday") { today ->
            val day = today.minusDays(1)
            DatePresetRange(iso(day), iso(day))
        },
        DatePreset("7d", "date.preset.last7", "Last 7 days") { today ->
            DatePresetRange(iso(today.minusDays(LAST_7_OFFSET)), iso(today))
        },
        DatePreset("30d", "date.preset.last30", "Last 30 days") { today ->
            DatePresetRange(iso(today.minusDays(LAST_30_OFFSET)), iso(today))
        },
        DatePreset("90d", "date.preset.last90", "Last 90 days") { today ->
            DatePresetRange(iso(today.minusDays(LAST_90_OFFSET)), iso(today))
        },
        DatePreset("mtd", "date.preset.mtd", "Month to date") { today ->
            DatePresetRange(iso(today.withDayOfMonth(1)), iso(today))
        },
        DatePreset("qtd", "date.preset.qtd", "Quarter to date") { today ->
            val quarterStartMonth = ((today.monthValue - 1) / MONTHS_PER_QUARTER) * MONTHS_PER_QUARTER + 1
            DatePresetRange(iso(today.withMonth(quarterStartMonth).withDayOfMonth(1)), iso(today))
        },
        DatePreset("ytd", "date.preset.ytd", "Year to date") { today ->
            DatePresetRange(iso(today.withDayOfYear(1)), iso(today))
        },
        DatePreset("lastMonth", "date.preset.lastMonth", "Last month") { today ->
            val lastMonthEnd = today.withDayOfMonth(1).minusDays(1)
            DatePresetRange(iso(lastMonthEnd.withDayOfMonth(1)), iso(lastMonthEnd))
        },
        DatePreset("1y", "date.preset.last1y", "Last year") { today ->
            DatePresetRange(iso(today.minusYears(1)), iso(today))
        },
        DatePreset("all", "date.preset.all", "All time") { today ->
            DatePresetRange(ALL_TIME_BASELINE, iso(today))
        },
    )

/** Default chip set rendered when the caller passes no `presetIds` (web `DEFAULT_PRESET_IDS`). */
val DEFAULT_PRESET_IDS: List<String> = listOf("today", "7d", "30d", "mtd", "ytd", "all")

/** Look up a preset by [id]; null when unknown (web `getDatePreset`). */
fun getDatePreset(id: String): DatePreset? = DATE_PRESETS.firstOrNull { it.id == id }

/**
 * Resolve the start date for the "All time" preset, clamped up to [minDate] (typically the user's first data
 * point) so a user whose data starts in 2024 doesn't see years of empty buckets (web `resolveAllTimeStart`).
 * ISO `YYYY-MM-DD` strings compare lexicographically in chronological order.
 */
fun resolveAllTimeStart(minDate: String? = null): String {
    if (minDate == null) return ALL_TIME_BASELINE
    return if (minDate > ALL_TIME_BASELINE) minDate else ALL_TIME_BASELINE
}

/**
 * Return the id of the preset whose resolved range matches ([start], [end]) on [today], or null when no preset
 * produces that range (web `matchPresetId`). Backs an `activeId` highlight derived from a persisted range.
 */
fun matchPresetId(
    start: String,
    end: String,
    today: LocalDate,
): String? {
    val match =
        DATE_PRESETS.firstOrNull { preset ->
            val range = preset.resolve(today)
            range.start == start && range.end == end
        }
    return match?.id
}

// ── Selection + chip projection ──────────────────────────────────────────────────────────────────────────────

/** The payload handed to the host on a chip tap — the native port of the web `DatePresetSelection`. */
data class DatePresetSelection(
    val id: String,
    val start: String,
    val end: String,
)

/**
 * Resolve a tapped preset [id] against [today] into the [DatePresetSelection] the host receives (web
 * `onSelect({ id, start, end })`). Returns null for an unknown id so the view simply ignores a stale tap.
 */
fun resolveSelection(
    id: String,
    today: LocalDate,
): DatePresetSelection? {
    val preset = getDatePreset(id) ?: return null
    val range = preset.resolve(today)
    return DatePresetSelection(preset.id, range.start, range.end)
}

/** The mutually-exclusive render surface the chip row draws. */
enum class DatePresetChipsPhase {
    /** One or more presets matched — render the chip row (the web component's visible state). */
    Content,

    /** The caller's `presetIds` matched no known preset — render a friendly empty state, never a blank box. */
    Empty,
}

/**
 * One render-ready chip — everything the composable needs to draw a single `<Button>`: the preset [id] (for the
 * tap callback), its [i18nKey] + English [fallback] (resolved to the label at the render boundary), and whether
 * it is [active] (web `p.id === activeId` → `primary` vs `ghost`, `aria-pressed`).
 */
data class DatePresetChip(
    val id: String,
    val i18nKey: String,
    val fallback: String,
    val active: Boolean,
)

/**
 * The immutable, render-ready projection the composable draws — the ordered [chips] (filtered from the registry,
 * preserving the web `DATE_PRESETS.filter(...)` order, NOT the caller's `presetIds` order) plus the resolved
 * [phase]. Pure data so [projectDatePresetChips] is unit-tested without a UI host.
 */
data class DatePresetChipsDisplay(
    val phase: DatePresetChipsPhase,
    val chips: List<DatePresetChip>,
) {
    /** True when there are no chips to render and the empty state shows instead. */
    val isEmpty: Boolean get() = phase == DatePresetChipsPhase.Empty
}

/**
 * Folds the caller's [presetIds] + optional [activeId] into the render-ready [DatePresetChipsDisplay] — the
 * native port of the web component's `DATE_PRESETS.filter(p => ids.has(p.id))` mapping. Unknown ids in
 * [presetIds] are ignored (no chip), and an empty result resolves to [DatePresetChipsPhase.Empty] so the surface
 * shows a labelled empty state rather than nothing.
 */
fun projectDatePresetChips(
    presetIds: List<String> = DEFAULT_PRESET_IDS,
    activeId: String? = null,
): DatePresetChipsDisplay {
    val ids = presetIds.toSet()
    val chips =
        DATE_PRESETS
            .filter { it.id in ids }
            .map { DatePresetChip(id = it.id, i18nKey = it.i18nKey, fallback = it.fallback, active = it.id == activeId) }
    val phase = if (chips.isEmpty()) DatePresetChipsPhase.Empty else DatePresetChipsPhase.Content
    return DatePresetChipsDisplay(phase = phase, chips = chips)
}

// ── Accessibility (localized labels folded here so they are unit-tested without a Compose host) ───────────────

/**
 * The chip group's accessible name — the web `aria-label={ariaLabel ?? t('date.preset.label', 'Quick date
 * range')}`. A non-blank caller [override] wins; otherwise the [resolve]r looks up the group key with the web
 * English fallback. Pure so TalkBack-label presence is unit-tested without a Compose host.
 */
fun datePresetGroupLabel(
    resolve: StringResolver,
    override: String? = null,
): String =
    override?.takeIf { it.isNotBlank() }
        ?: resolve(DatePresetChipsRegistration.GROUP_LABEL_KEY, DatePresetChipsRegistration.GROUP_LABEL_EN)

/** The localized label drawn on a [chip] — the web `t(p.i18nKey, p.fallback)`. */
fun chipLabel(
    chip: DatePresetChip,
    resolve: StringResolver,
): String = resolve(chip.i18nKey, chip.fallback)
