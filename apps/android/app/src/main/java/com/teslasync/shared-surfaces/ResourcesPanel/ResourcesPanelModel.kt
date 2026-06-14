// Pure, framework-free model + projection + diagnostics for the ResourcesPanel shared surface — the native
// analogue of every decision the web component makes (web/src/components/status/ResourcesPanel.tsx) before it
// paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL "server resources at-a-glance" panel: a "Resources" heading over a stack of rows.
//     Each row shows a label, a right-aligned value (e.g. "1.8 GB"), an optional sub/meta value (e.g.
//     "of 8 GB"), and — only when a `percent` is supplied — a horizontal usage bar. An optional footnote sits
//     beneath the rows. The parent owns the already-formatted rows + footnote; the component binds NO hook and
//     calls NO `t()` (its only literal is the hardcoded "Resources" heading). So there is no data port to bind
//     (no P1/S8 state holder, no Source/ViewModel) — modelling one would invent a fetch the web spec does not
//     have (honesty covenant: no scope narrowing, no silent drift). The sibling presentational status ports
//     HealthRow / StatusHero document the same rationale (composable + model, no Source).
//   • Each row's status is driven purely by its `percent` against two thresholds — the web
//     `percent == null ? 'normal' : percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'normal'`. The bar
//     colour follows the status (critical→red, warn→amber, normal→green) and the value-text colour follows it
//     too, EXCEPT that a normal value stays the primary text colour while its bar is green — so the surface
//     keeps two status→tone projections, [valueTone] and [barTone], reduced here and mapped to per-theme P1/S9
//     tokens at the Compose boundary (never a raw hex), so light / dark / high-contrast stay correct.
//   • The bar geometry mirrors the web exactly: the fill width is `max(0, min(100, percent))%` (clamped) and
//     the accessibility value is `round(percent)` (the web `aria-valuenow`, deliberately NOT clamped). Both are
//     projected here so the off-device gate pins the arithmetic without a Compose host.
//
// Why the generic data-surface states (loading / empty-as-spinner / error / stale / offline) are intentionally
// absent: this surface fetches nothing — it paints the rows the parent already holds. Its real, fully
// reproduced states are the per-row status branches (normal / warn / critical), the with-bar vs no-bar branch,
// the optional icon + optional meta branches, and the EMPTY panel (no rows). The web renders an empty row stack
// as a blank area; the prompt's states contract mandates a friendly, non-blank surface, so the composable shows
// an EmptyState there instead — never a blank box. There is no query to be loading, to fail, to go stale, or to
// be offline; the owning page that DOES fetch renders its own data surface (with those async states) and drops
// this panel into it.
//
// i18n: the panel's one owned literal in the web source is the hardcoded "Resources" heading, which the
// auto-generated P1/S10 catalog (gen-i18n.ts; "do not edit by hand") has no key for — the web hardcodes it with
// no `t()` call. Rather than invent a catalog key or drift onto the singular `Resource` key, the native surface
// hoists the heading to a caller-supplied, already-localized `title` parameter — the identical treatment the
// web already applies to this surface's every OTHER string (each row's label / value / meta and the footnote
// are caller-supplied and localized by the consumer's `t()`). The surface therefore owns no English literal,
// while still ALWAYS rendering the heading (the param is required and always painted — no scope narrowing). The
// only literal the composable resolves itself is the empty-state copy, taken from the generic catalog key
// `common.noData`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ResourcesPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling HealthRow / StatusHero surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.resourcespanel

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/**
 * The render-agnostic status a single resource row carries — the native mirror of the web
 * `normal | warn | critical` outcome of `percent == null ? 'normal' : percent >= 90 ? 'critical' :
 * percent >= 70 ? 'warn' : 'normal'`. Keeping it an enum lets the off-device test assert the choice without a
 * Compose host; the view maps it onto per-theme P1/S9 token colours (see [ResourceSeverity.barTone] /
 * [ResourceSeverity.valueTone]).
 */
enum class ResourceSeverity {
    /** Below the warn threshold (or no percent): a green bar but the primary value-text colour (web `normal`). */
    Normal,

    /** At/above 70% and below 90% — an amber bar and amber value text (web `warn`). */
    Warn,

    /** At/above 90% — a red bar and red value text (web `critical`). */
    Critical,
}

/**
 * The render tone the bar fill paints — the native mirror of the web `barColor` family
 * (critical→red-400, warn→amber-400, normal→green-400). Distinct from [ValueTone] because a `normal` row's
 * bar is green while its value text stays the primary colour. The Compose boundary maps each onto a P1/S9
 * status token.
 */
enum class BarTone { Success, Warning, Danger }

/**
 * The render tone the value text paints — the native mirror of the web `textColor` family
 * (critical→red-400, warn→amber-400, normal→`var(--text-primary)`). A `normal` value is the [Primary] surface
 * text colour, NOT green — the one place the value tone diverges from the [BarTone].
 */
enum class ValueTone { Primary, Warning, Danger }

/** The bar tone for a severity — web `barColor`: normal→green, warn→amber, critical→red. */
val ResourceSeverity.barTone: BarTone
    get() =
        when (this) {
            ResourceSeverity.Normal -> BarTone.Success
            ResourceSeverity.Warn -> BarTone.Warning
            ResourceSeverity.Critical -> BarTone.Danger
        }

/** The value-text tone for a severity — web `textColor`: normal→primary, warn→amber, critical→red. */
val ResourceSeverity.valueTone: ValueTone
    get() =
        when (this) {
            ResourceSeverity.Normal -> ValueTone.Primary
            ResourceSeverity.Warn -> ValueTone.Warning
            ResourceSeverity.Critical -> ValueTone.Danger
        }

/**
 * The fully reduced, render-ready projection of a single row's `percent` — everything the bar + value tone need,
 * derived purely so every branch is covered off-device. The view only maps the tones onto token colours and
 * draws the fill.
 *
 * @property severity the status tier driving both tones (web `severity`).
 * @property hasBar whether a usage bar is drawn at all — web `percent != null` (a row with no percent shows just
 *   its label + value, no bar).
 * @property barFraction the clamped fill as a `0f..1f` fraction — web `max(0, min(100, percent)) / 100`; also the
 *   value handed to the bar's `progressBarRangeInfo` accessibility semantics. `0f` when there is no bar.
 * @property barValueNow the whole-number accessibility value — web `aria-valuenow = Math.round(percent)`,
 *   deliberately NOT clamped (an over-100 percent reports its true rounded value). `0` when there is no bar.
 */
data class ResourceRowProjection(
    val severity: ResourceSeverity,
    val hasBar: Boolean,
    val barFraction: Float,
    val barValueNow: Int,
)

/**
 * Pure projections of the web `ResourcesPanel` per-row derivations — a 1:1 port of the status thresholds and the
 * bar arithmetic the web component computes before rendering each row. Every function is framework-free and
 * unit-tested in the :android:testReleaseUnitTest gate.
 */
object ResourcesPanelModel {
    /** Web `percent >= 70` warn threshold. */
    const val WARN_THRESHOLD: Double = 70.0

    /** Web `percent >= 90` critical threshold. */
    const val CRITICAL_THRESHOLD: Double = 90.0

    /** Web bar-fill clamp floor — `Math.max(0, …)`. */
    const val PERCENT_MIN: Double = 0.0

    /** Web bar-fill clamp ceiling — `Math.min(100, …)`. */
    const val PERCENT_MAX: Double = 100.0

    /**
     * Reduce a row's [percent] to its [ResourceSeverity] — the native mirror of
     * `percent == null ? 'normal' : percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'normal'`. A null
     * percent (a row with no bar) is [Normal], exactly as the web defaults. A non-finite percent compares false
     * against both thresholds (as it does in JS), so it also folds to [Normal].
     */
    fun severityFor(percent: Double?): ResourceSeverity =
        when {
            percent == null -> ResourceSeverity.Normal
            percent >= CRITICAL_THRESHOLD -> ResourceSeverity.Critical
            percent >= WARN_THRESHOLD -> ResourceSeverity.Warn
            else -> ResourceSeverity.Normal
        }

    /**
     * The clamped bar fill as a `0f..1f` fraction — web `Math.max(0, Math.min(100, percent)) / 100` expressed as
     * a fraction of the full track. A non-finite [percent] (a NaN/Infinity the web would turn into a broken
     * `NaN%` width) folds to `0f` so the bar is simply empty rather than undefined — the only native-safety
     * divergence from the web, mirroring the sibling ProgressRing guard.
     */
    fun barFraction(percent: Double): Float {
        if (!percent.isFinite()) return 0f
        return (percent.coerceIn(PERCENT_MIN, PERCENT_MAX) / PERCENT_MAX).toFloat()
    }

    /**
     * The whole-number accessibility value — web `aria-valuenow = Math.round(percent)`, deliberately NOT clamped
     * so an over-100 reading reports its true rounded value. Kotlin's [roundToInt] rounds ties toward positive
     * infinity, matching JavaScript's `Math.round`. A non-finite [percent] folds to `0` (native safety).
     */
    fun barValueNow(percent: Double): Int {
        if (!percent.isFinite()) return 0
        return percent.roundToInt()
    }

    /**
     * Project a row's [percent] into the render-ready [ResourceRowProjection] — the single "data adapter" the
     * composable consumes (raw value → render projection). Pure (no Compose), so every branch (no-bar / normal /
     * warn / critical / clamped-over-100 / non-finite) is covered by the JVM unit gate and doubles as the
     * per-state snapshot. `hasBar` follows the web `percent != null`; the fraction + value follow the web bar
     * width + `aria-valuenow`.
     */
    fun projectRow(percent: Double?): ResourceRowProjection =
        ResourceRowProjection(
            severity = severityFor(percent),
            hasBar = percent != null,
            barFraction = if (percent != null) barFraction(percent) else 0f,
            barValueNow = if (percent != null) barValueNow(percent) else 0,
        )
}

/**
 * Canonical registry metadata for the ResourcesPanel surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`ResourcesPanel`).
 */
object ResourcesPanelRegistration {
    /** Stable surface id (kebab-case). */
    const val ID: String = "resources-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = ResourcesPanelDiagnostics.SLUG
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a row label,
 * value, percent, or the footnote (which can name a host's memory/threads/pool) — so a diagnostics line can
 * never leak what the panel shows. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object ResourcesPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "ResourcesPanel"

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
