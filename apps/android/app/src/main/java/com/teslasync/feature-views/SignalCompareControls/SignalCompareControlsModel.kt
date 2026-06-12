// Pure, framework-free model + projection for the SignalCompareControls feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/telemetry/components/SignalCompareControls.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// SignalCompareControls is, in the web source's own words, "Pure controls (no data fetching, no diff table)":
// it receives the two compare windows (`atA` / `atB` as `datetime-local` strings), the signal `search`, and the
// active `category`, plus their change callbacks, and is mounted by both SignalDiffPage and SignalsWorkspacePage.
// The one data source the web binds is `useTranslation`. So, exactly as the sibling WeekSelector / AddWidgetButton
// presentational ports document, the loading / empty / error / stale / offline lifecycle lives on the OWNING
// page, not here; the conditional branches the web source itself defines — the optional top slot and the
// category-clear affordance shown only while a category is active — are the complete branch set this surface
// renders, alongside the always-visible windows, presets, filter and chips.
//
// This file owns the pure parts the web component exports so the pages can also drive their server-side filter
// strings: the eight category prefixes with their verbatim regex matchers (web `CATEGORY_PREFIXES`), the five
// quick presets with their relative-window math (web `DIFF_PRESETS`), the `datetime-local` <-> ISO helpers (web
// `toLocalDatetimeInput` / `isoOrEmpty`), the category toggle decision (web `category === c.id ? null : c.id`),
// the `t(key, default)` resolver for the two aria strings the i18n catalog does not define, and the PII-safe
// diagnostics contract (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SignalCompareControls — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalcomparecontrols

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The PII-safe diagnostics contract this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * window timestamp, signal name or category, any of which could narrow which vehicle/window an operator was
 * inspecting — so a diagnostics line can never leak the comparison an operator set up.
 */
object SignalCompareControlsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SignalCompareControls"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/**
 * One signal-name category prefix — the native mirror of a single web `CATEGORY_PREFIXES` entry. [id] is the
 * verbatim web id (the controlled-selection token the pages persist), and [matches] reproduces the web entry's
 * case-insensitive `matches(name)` regex so a host page can fold the live signal list into the same buckets the
 * chips toggle. Declaration order IS the web array order, so [ALL] renders the same chip sequence.
 */
enum class DiffCategory(
    val id: String,
    private val pattern: Regex,
) {
    Battery("battery", Regex("battery|charge|soc|range|kwh", RegexOption.IGNORE_CASE)),
    Drive("drive", Regex("speed|odometer|gear|drive|brake|throttle|steering", RegexOption.IGNORE_CASE)),
    Climate("climate", Regex("climate|hvac|cabin|seat|temp", RegexOption.IGNORE_CASE)),
    Security("security", Regex("lock|sentry|alarm|valet|guard", RegexOption.IGNORE_CASE)),
    Motor("motor", Regex("motor|inverter|torque|rpm", RegexOption.IGNORE_CASE)),
    Tire("tire", Regex("tpms|tire|pressure", RegexOption.IGNORE_CASE)),
    Media("media", Regex("media|audio|volume|playback", RegexOption.IGNORE_CASE)),
    Safety("safety", Regex("airbag|seatbelt|fcw|aeb|safety", RegexOption.IGNORE_CASE)),
    ;

    /** Whether [signalName] belongs to this category — web `matches: (n) => /.../i.test(n)`. */
    fun matches(signalName: String): Boolean = pattern.containsMatchIn(signalName)

    companion object {
        /** The chip order — the native mirror of the exported web `CATEGORY_PREFIXES` array. */
        val ALL: List<DiffCategory> = entries.toList()

        /** The category whose [id] equals the argument, or `null` (e.g. for the cleared selection). */
        fun fromId(id: String?): DiffCategory? = entries.firstOrNull { it.id == id }
    }
}

/**
 * A render-ready compare window pair — the two `datetime-local` strings a preset resolves to, matching the web
 * `applyPreset` which feeds `onChangeA(toLocalDatetimeInput(a))` / `onChangeB(toLocalDatetimeInput(b))`. Pure
 * data so the preset math is unit-tested without a UI host.
 */
data class DiffWindow(
    val atA: String,
    val atB: String,
)

/**
 * One quick datetime preset — the native mirror of a single web `DIFF_PRESETS` entry. [id] is the verbatim web
 * id; the offsets are how far before "now" each window sits, reproducing each web `compute()` exactly (Window B
 * is "now" for every preset except Last drive, which ends five minutes back). Declaration order IS the web array
 * order, so [ALL] renders the same button sequence.
 */
enum class DiffPreset(
    val id: String,
    private val offsetA: Duration,
    private val offsetB: Duration,
) {
    NowVs1h("now-vs-1h", Duration.ofHours(1), Duration.ZERO),
    NowVs1d("now-vs-1d", Duration.ofDays(1), Duration.ZERO),
    BeforeAfterCharge("before-after-charge", Duration.ofHours(4), Duration.ZERO),
    LastDrive("last-drive", Duration.ofMinutes(90), Duration.ofMinutes(5)),
    TodayVsYesterday("today-vs-yesterday", Duration.ofDays(1), Duration.ZERO),
    ;

    /**
     * Resolves this preset's window pair relative to [nowMillis], formatting each end in [zone] — web
     * `compute()` followed by `toLocalDatetimeInput`. [nowMillis] / [zone] are injected (never read from a global
     * clock) so the math is deterministic under test.
     */
    fun compute(
        nowMillis: Long,
        zone: ZoneId,
    ): DiffWindow {
        val now = Instant.ofEpochMilli(nowMillis)
        return DiffWindow(
            atA = SignalCompareTime.toLocalDatetimeInput(now.minus(offsetA).toEpochMilli(), zone),
            atB = SignalCompareTime.toLocalDatetimeInput(now.minus(offsetB).toEpochMilli(), zone),
        )
    }

    companion object {
        /** The button order — the native mirror of the exported web `DIFF_PRESETS` array. */
        val ALL: List<DiffPreset> = entries.toList()

        /** The preset whose [id] equals the argument, or `null` for an unrecognised token. */
        fun fromId(id: String): DiffPreset? = entries.firstOrNull { it.id == id }
    }
}

/**
 * The `datetime-local` <-> ISO helpers — the native mirror of the web `toLocalDatetimeInput` / `isoOrEmpty`
 * free functions. The window strings use the exact HTML `datetime-local` shape (`yyyy-MM-ddTHH:mm`) so the
 * controlled-prop contract matches the web component one-for-one and a host can drive the same server filter.
 */
object SignalCompareTime {
    private const val LOCAL_PATTERN = "yyyy-MM-dd'T'HH:mm"
    private const val DISPLAY_PATTERN = "yyyy-MM-dd HH:mm"
    private val LOCAL_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern(LOCAL_PATTERN, Locale.ROOT)
    private val DISPLAY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern(DISPLAY_PATTERN, Locale.ROOT)

    /**
     * Formats [epochMillis] (an absolute instant) as a `datetime-local` string in [zone] — web
     * `toLocalDatetimeInput`.
     */
    fun toLocalDatetimeInput(
        epochMillis: Long,
        zone: ZoneId,
    ): String =
        Instant
            .ofEpochMilli(epochMillis)
            .atZone(zone)
            .toLocalDateTime()
            .format(LOCAL_FORMAT)

    /** Formats an already-local [value] as a `datetime-local` string — the picker-confirm path. */
    fun toLocalDatetimeInput(value: LocalDateTime): String = value.format(LOCAL_FORMAT)

    /**
     * Parses a `datetime-local` string back to a [LocalDateTime], or `null` when blank or malformed — used to
     * seed the date/time pickers from the current window value. Mirrors the web component reading `value={atA}`.
     */
    fun parseLocalDatetime(localValue: String): LocalDateTime? {
        if (localValue.isBlank()) return null
        return runCatching { LocalDateTime.parse(localValue, LOCAL_FORMAT) }.getOrNull()
    }

    /**
     * Converts a `datetime-local` [localValue] (interpreted in [zone]) into a UTC ISO-8601 instant string, or
     * `""` when blank/invalid — the native mirror of web `isoOrEmpty` (`new Date(local).toISOString()`), the
     * exact server-filter string the owning pages send.
     */
    fun isoOrEmpty(
        localValue: String,
        zone: ZoneId,
    ): String {
        val parsed = parseLocalDatetime(localValue) ?: return ""
        return parsed.atZone(zone).toInstant().toString()
    }

    /**
     * The human-friendly field text for a window [localValue]: the parsed datetime rendered as
     * `yyyy-MM-dd HH:mm`, or [emptyLabel] when the window is unset — so the tap-to-pick field is never an empty
     * box (the web shows the browser's native `datetime-local` glyph for the same empty state).
     */
    fun displayLabel(
        localValue: String,
        emptyLabel: String,
    ): String = parseLocalDatetime(localValue)?.format(DISPLAY_FORMAT) ?: emptyLabel
}

/**
 * The category-chip toggle decision — the native mirror of web `onCategoryChange(category === c.id ? null : c.id)`:
 * tapping the active chip clears the selection, tapping any other chip selects it. Pure so it is unit-tested
 * without a UI host.
 */
fun toggleCategory(
    current: String?,
    clicked: String,
): String? = if (current == clicked) null else clicked

/** Resource name (absent ⇒ [SignalCompareDefaults.SNAPSHOT_ARIA]) for the Window A help trigger's accessible name. */
const val KEY_SNAPSHOT_ARIA: String = "translation_help_signal_snapshot_aria"

/** Resource name (absent ⇒ [SignalCompareDefaults.DIFF_ARIA]) for the Window B help trigger's accessible name. */
const val KEY_DIFF_ARIA: String = "translation_help_signal_diff_aria"

/** Resource name (absent ⇒ [SignalCompareDefaults.PICK_WINDOW]) for the empty-window tap-to-pick label. */
const val KEY_PICK_WINDOW: String = "translation_signalDiff_pickWindow"

/**
 * Native fallback microcopy reproducing i18next's "return the default when the key is absent" behaviour for the
 * three strings the web resolves via `t(key, default)` whose keys the generated catalog (P1/S10) does not define:
 * the two help-trigger aria names (web `ariaLabel={t('help.signal.*.aria', { defaultValue: '…' })}`) and the
 * empty-window tap-to-pick label (the web's native `datetime-local` input shows the browser's own empty glyph;
 * a tap-to-pick field needs an explicit, localized label so the control is never an empty box).
 */
object SignalCompareDefaults {
    /** web `help.signal.snapshot.aria` default. */
    const val SNAPSHOT_ARIA: String = "More info about signal snapshots"

    /** web `help.signal.diff.aria` default. */
    const val DIFF_ARIA: String = "More info about signal diffs"

    /** Empty-window tap-to-pick label. */
    const val PICK_WINDOW: String = "Select date & time"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns [lookup] of [resourceName] when
 * it resolves to a non-blank string, otherwise [fallback]. [lookup] is a thin seam over the Android string
 * catalog in production (an optional by-name read) and a map in tests, keeping the resolve-or-fallback decision
 * pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback
