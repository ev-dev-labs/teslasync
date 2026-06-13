// Pure, framework-free model + projection + diagnostics for the AnimatedNumber shared surface — the native
// analogue of web/src/components/data-display/AnimatedNumber.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions (the accepted sibling-surface contract).
//
// The web source is a PURELY PRESENTATIONAL count-up primitive, not a data-fetching view. It takes a numeric
// `value` plus formatting knobs (`duration` seconds, `decimals`, `prefix`, `suffix`, `className`); on mount and
// on every `value` / `duration` change it animates a display number from 0 up to `value` with an ease-out-quad
// curve (`1 - (1 - progress) * (1 - progress)`) driven by requestAnimationFrame, formatting each frame through
// `fmtNumber(display, decimals)` and rendering `{prefix}{…}{suffix}` in a `tabular-nums` span. This file owns
// that math: the [easeOutQuad] curve, the count-from-zero [animatedValueAt] projection, the `fmtNumber`-parity
// [AnimatedNumberProjection.formatNumber] formatter, and the prefix/suffix display assembly.
//
// Because the surface has NO async cache-then-network feed (it is handed a finished number), there is no
// loading / empty / error / stale / offline lifecycle to project — modelling those would fabricate behaviour the
// web spec does not have, exactly as the accepted VisuallyHidden / AreaChartWrapper presentational ports
// document. The surface's real, reproduced states are the count-up frames (start at 0, eased middle, settled at
// `value`), the reduced-motion settle (straight to `value`), and the format variants (decimals / prefix /
// suffix / locale grouping). The web source renders no static copy of its own — the number and the
// caller-supplied prefix/suffix are its only text — so the surface carries NO i18n keys; there is none to map,
// and none is invented.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AnimatedNumber — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.animatednumber

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * Canonical registry metadata for the AnimatedNumber surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`AnimatedNumber`).
 */
object AnimatedNumberRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "animated-number"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "AnimatedNumber"
}

/**
 * The web-default knobs, kept as named constants so the composable and the unit gate agree on one source of
 * truth — no loose numerals drift between the render layer and its tests.
 */
object AnimatedNumberDefaults {
    /** The count-up origin — web `from = 0` (every animation restarts from zero). */
    const val FROM: Double = 0.0

    /** Fraction digits — web `decimals = 0`. */
    const val DECIMALS: Int = 0

    /**
     * Animation length in milliseconds — web `duration = 1` second. Intentionally the web value, not the 400ms
     * `MotionDurations.slow` design token, so the count-up cadence matches the web source exactly (parity).
     */
    const val DURATION_MS: Int = 1_000

    /** Upper clamp on fraction digits, matching the shared `ChartFormat` ceiling so formatting stays bounded. */
    const val MAX_DECIMALS: Int = 6
}

/**
 * The ease-out-quad curve — a 1:1 port of the web `1 - (1 - progress) * (1 - progress)`. Front-loaded motion:
 * the value advances quickly then decelerates into its final position. [progress] is clamped to `0..1` so the
 * function is total and never overshoots, mirroring the web `Math.min(elapsed / durationMs, 1)` clamp. This is
 * the single reference curve both the Compose animation and the unit gate consume.
 */
fun easeOutQuad(progress: Double): Double {
    val clamped = progress.coerceIn(0.0, 1.0)
    return 1.0 - (1.0 - clamped) * (1.0 - clamped)
}

/**
 * The eased display value at [progress] for a count from [AnimatedNumberDefaults.FROM] to [target] — the native
 * mirror of the web `from + (to - from) * eased` with `from = 0`. At `progress = 0` it is the origin, at
 * `progress = 1` it is exactly [target], so the count always lands on the requested number.
 */
fun animatedValueAt(
    target: Double,
    progress: Double,
): Double = AnimatedNumberDefaults.FROM + (target - AnimatedNumberDefaults.FROM) * easeOutQuad(progress)

/**
 * The presentational inputs — the native analogue of the web `AnimatedNumber` props that affect output text
 * (`value`, `decimals`, `prefix`, `suffix`). `duration` and `className` are render-layer concerns (animation
 * cadence and styling), so they live on the composable, not in this pure projection.
 */
data class AnimatedNumberSpec(
    val value: Double,
    val decimals: Int = AnimatedNumberDefaults.DECIMALS,
    val prefix: String = "",
    val suffix: String = "",
)

/**
 * One projected count-up frame — the pure data the composable would render at a given animation [progress].
 * [value] is the eased number, [text] is the fully formatted display string (prefix + grouped number + suffix).
 */
data class AnimatedNumberFrame(
    val progress: Double,
    val value: Double,
    val text: String,
)

/**
 * The pure projection the composable renders — a 1:1 port of the formatting the web `AnimatedNumber` performs
 * each animation tick. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the
 * composable only drives the animation clock and applies the tabular-figures text style.
 */
object AnimatedNumberProjection {
    /**
     * Locale-aware number formatting — the native parity of the web `fmtNumber(value, decimals)`
     * (`toLocaleString` with `minimumFractionDigits = maximumFractionDigits = decimals`). A non-finite value is
     * coerced to 0 first (web `safeNumber`), so a mid-flight count never renders `NaN`; [decimals] is clamped to
     * a sane range and the `%,` flag applies the locale grouping separators.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val digits = decimals.coerceIn(0, AnimatedNumberDefaults.MAX_DECIMALS)
        return String.format(locale, "%,.${digits}f", safe)
    }

    /**
     * The full display string — web `{prefix}{fmtNumber(display, decimals)}{suffix}`. [displayValue] is the
     * current (eased) number; the prefix and suffix are emitted verbatim, exactly as the web `<span>` children.
     */
    fun formatDisplay(
        spec: AnimatedNumberSpec,
        displayValue: Double,
        locale: Locale = Locale.getDefault(),
    ): String = "${spec.prefix}${formatNumber(displayValue, spec.decimals, locale)}${spec.suffix}"

    /**
     * The settled (`progress = 1`) display string — the value the count-up lands on. The composable exposes this
     * exact string as the node's accessibility label, so a screen reader reads the meaningful final number
     * instead of the rapidly-changing intermediate frames.
     */
    fun settledText(
        spec: AnimatedNumberSpec,
        locale: Locale = Locale.getDefault(),
    ): String = formatDisplay(spec, spec.value, locale)

    /**
     * The render-ready frame at [progress] — the eased value and its formatted text. [progress] is clamped to
     * `0..1` so a caller can never request a frame outside the animation window.
     */
    fun project(
        spec: AnimatedNumberSpec,
        progress: Double,
        locale: Locale = Locale.getDefault(),
    ): AnimatedNumberFrame {
        val clamped = progress.coerceIn(0.0, 1.0)
        val eased = animatedValueAt(spec.value, clamped)
        return AnimatedNumberFrame(progress = clamped, value = eased, text = formatDisplay(spec, eased, locale))
    }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [AnimatedNumberRegistration.SLUG] — never the rendered number, prefix, or suffix, so a
 * diagnostics line can never leak the value the surface displays. Kept free of Compose so it is unit-tested with
 * a recording [Logger]; the composable calls it once per surface open.
 */
object AnimatedNumberDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to AnimatedNumberRegistration.SLUG))
    }
}
