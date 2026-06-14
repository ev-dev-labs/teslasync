// Pure, framework-free model + projection + diagnostics for the WidgetGaugeHero widget primitive — the native
// analogue of every decision the web component makes (web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx)
// before it paints. No Compose, no Android, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, keeping the composable in WidgetGaugeHero.kt a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a purely presentational
// widget building block. It takes a `gauge` config ({ value, max, label, unit, color }), an optional `stats`
// array ({ label, value, unit? }), a `compact` flag, and arbitrary `children`. It renders:
//   • a `RadialGauge` sized `compact ? 70 : 100` (the compact widget never grows);
//   • when `!compact && stats?.length > 0`, a centered flex-wrap row of stat cells (each a small secondary label
//     over a `text-sm` semibold primary value with an optional smaller secondary unit suffix);
//   • when `!compact`, the `children` slot.
// Those three prop-driven branches — gauge (always), stats (standard + non-empty only), children (standard only) —
// are the surface's COMPLETE state set, reproduced verbatim. The gauge always renders, so the surface is never a
// blank box.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing — the web component has no hook, no `useTranslation`, and no async dependency at all; it
// is a leaf composition handed everything it draws by its parent widget. There is no query to be loading, to be
// empty, to go stale, or to be offline, so inventing those states would be dishonest (honesty covenant: no silent
// drift, no scope narrowing). The owning widget that DOES fetch renders its own data surface (with those states)
// and drops this primitive into it. The presentational precedents are the sibling Checkbox / Slider /
// StaggerContainer surfaces (composable + model, no Source/ViewModel).
//
// The web source has NO `t()` call — `label`, `unit`, and every `stat.label` are caller-supplied strings, and the
// gauge `color` is a caller-supplied value. So this surface adds NO i18n catalog key and NO English literal: the
// gauge's accessible description is composed by the shared RadialGauge from the caller's label + value, and each
// stat cell is named by the caller's own label + value (P1/S10 owns the catalog; the caller resolves its strings
// there before handing them in).
//
// `GaugeHeroConfig` (which carries a Compose `Color` — the native-idiomatic mirror of the web CSS color string)
// necessarily lives in the Compose render layer (WidgetGaugeHero.kt); the framework-free [GaugeHeroStat] lives
// here so its display text is asserted off-device. `InvalidPackageDeclaration` is suppressed because this surface's
// mandated directory (com/teslasync/widget-primitives — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling shared-surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetgaugehero

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no gauge value, label, unit, or
 * stat — only this constant identifier — so a diagnostics line can never leak what the widget is showing.
 */
const val WIDGET_GAUGE_HERO_SLUG: String = "WidgetGaugeHero"

/** Test tag the composable stamps on its root column, so the per-state + a11y UI test can locate the surface. */
const val WIDGET_GAUGE_HERO_TEST_TAG: String = "widget-gauge-hero"

/** Test tag the composable stamps on the stats row, so the UI test can assert the stats branch shows/hides. */
const val WIDGET_GAUGE_HERO_STATS_TEST_TAG: String = "widget-gauge-hero-stats"

/**
 * Canonical registry metadata for the WidgetGaugeHero surface — the native mirror of the web component's contract.
 * The diagnostics [SLUG] and the kebab-case [ID] are pinned here so the native and web surfaces stay in lockstep.
 */
object WidgetGaugeHeroRegistration {
    /** Stable surface id (kebab-case), also the root test tag the composable stamps. */
    const val ID: String = "widget-gauge-hero"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = WIDGET_GAUGE_HERO_SLUG
}

/**
 * One supporting statistic shown beneath the gauge — the native mirror of the web `GaugeHeroStat`
 * ({ label, value: string | number, unit? }). Framework-free (no Compose) so the projection's display text is
 * asserted off-device. The web renders `value` inline (a `number` via its default string form), so [value] is the
 * already-formatted display string the caller hands in; a Kotlin caller with a number passes `n.toString()`.
 *
 * @property label the small secondary caption above the value (web `stat.label`).
 * @property value the formatted primary value text (web `stat.value`, a string or stringified number).
 * @property unit the optional smaller secondary suffix after the value (web `stat.unit`); null/blank ⇒ no suffix.
 */
data class GaugeHeroStat(
    val label: String,
    val value: String,
    val unit: String? = null,
)

/**
 * The immutable, render-ready layout the composable draws — the three branch decisions the web component folds
 * together before returning JSX. Pure data so [WidgetGaugeHeroProjection] is unit-tested without a UI host.
 *
 * @property gaugeSizeDp the RadialGauge diameter in dp (web `compact ? 70 : 100`).
 * @property showStats whether the stats row renders (web `!compact && stats && stats.length > 0`).
 * @property showContent whether the children slot renders (web `!compact`).
 */
data class WidgetGaugeHeroLayout(
    val gaugeSizeDp: Int,
    val showStats: Boolean,
    val showContent: Boolean,
)

/**
 * Pure projection logic for the WidgetGaugeHero surface — the native port of the derivations the web component
 * performs (`size = compact ? 70 : 100`, the `!compact && stats?.length` stats guard, the `!compact` children
 * guard) plus the value clamp + decimal rule the web `RadialGauge` applies to the gauge it is handed. Every
 * function is exhaustively unit-tested off-device, doubling as the surface's per-state snapshot.
 */
object WidgetGaugeHeroProjection {
    /** RadialGauge diameter when `compact` (web `size = 70`); the compact widget never grows. */
    const val COMPACT_GAUGE_SIZE_DP: Int = 70

    /** RadialGauge diameter at the standard size (web `size = 100`). */
    const val STANDARD_GAUGE_SIZE_DP: Int = 100

    /**
     * Fraction digits used for a fractional gauge value when the caller supplies no explicit `decimals` — the web
     * `getGlobalPrecision()` default (`_globalPrecision = 2` in web/src/lib/numberFormat.ts). A pure primitive does
     * not bind the user's settings, so this mirrors the web module-global's default; callers that need a different
     * precision pass `GaugeHeroConfig.decimals` (the web `RadialGauge` `decimals` prop).
     */
    const val FALLBACK_PRECISION: Int = 2

    /**
     * Folds the [compact] flag and the [statCount] into the render-ready [WidgetGaugeHeroLayout]: the gauge size
     * (web `compact ? 70 : 100`), whether the stats row shows (web `!compact && stats.length > 0`), and whether the
     * children slot shows (web `!compact`). A negative [statCount] is treated as none.
     */
    fun project(
        compact: Boolean,
        statCount: Int,
    ): WidgetGaugeHeroLayout =
        WidgetGaugeHeroLayout(
            gaugeSizeDp = if (compact) COMPACT_GAUGE_SIZE_DP else STANDARD_GAUGE_SIZE_DP,
            showStats = !compact && statCount > 0,
            showContent = !compact,
        )

    /**
     * Clamps [value] into `[0, max]` — the web `RadialGauge` `Math.max(0, Math.min(value, max))`. This is the value
     * the gauge DISPLAYS (and, via the shared `gaugeFraction`, sweeps), so an over-max value pins to the ceiling, a
     * negative value pins to 0, and the arc never overshoots. A non-finite [value] collapses to 0 (the practical
     * web `safeNumber` path) so the gauge never renders `NaN`; a non-finite/non-positive [max] uses the raw value
     * as the ceiling so the floor-at-0 still applies.
     */
    fun clampGaugeValue(
        value: Double,
        max: Double,
    ): Double {
        if (!value.isFinite()) return 0.0
        val ceiling = if (max.isFinite()) max else value
        return value.coerceAtMost(ceiling).coerceAtLeast(0.0)
    }

    /**
     * The effective fraction-digit count for the gauge's centered value — the web `RadialGauge`
     * `decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())`. An explicit [override]
     * (web `decimals` prop) wins; otherwise a clamped value that is a whole number renders at 0 decimals and a
     * fractional value at [FALLBACK_PRECISION]. The integer test is on the CLAMPED value, exactly as the web does.
     */
    fun effectiveDecimals(
        value: Double,
        max: Double,
        override: Int?,
    ): Int {
        if (override != null) return override
        val clamped = clampGaugeValue(value, max)
        return if (clamped % 1.0 == 0.0) 0 else FALLBACK_PRECISION
    }

    /**
     * The plain (un-styled) display text for one stat — the native port of the web `{stat.value}{stat.unit && ...}`
     * inline span. Used for the stat cell's single TalkBack description (so the screen reader reads "value unit" as
     * one phrase). A null/blank unit yields just the value; otherwise the unit is appended after a single space
     * (the readable form of the web `ml-0.5` gap).
     */
    fun statValueText(stat: GaugeHeroStat): String =
        if (stat.unit.isNullOrBlank()) {
            stat.value
        } else {
            "${stat.value} ${stat.unit}"
        }

    /**
     * The full accessible description for one stat cell — the localized [GaugeHeroStat.label] joined to its
     * [statValueText], matching the single-description treatment the shared RadialGauge applies so a stat is read
     * as one phrase ("Range: 248 mi") rather than two disconnected nodes.
     */
    fun statDescription(stat: GaugeHeroStat): String = "${stat.label}: ${statValueText(stat)}"
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never a gauge value, label, unit, or stat — so a diagnostics line can never leak what the
 * widget is showing. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object WidgetGaugeHeroDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WIDGET_GAUGE_HERO_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
