// Pure, framework-free model + value/step projection + diagnostics for the RangeSlider shared surface — the
// native analogue of every decision the web component makes (web/src/components/ui/RangeSlider.tsx) before it
// paints. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a PURE, CONTROLLED
// dual-thumb range slider built from two stacked native `<input type="range">` elements. The parent owns the
// `[low, high]` value; the component renders an optional label/value row (the `label` on the left, the
// formatted `low – high` summary on the right, hidden when `showLabel` is false), the two grabbable thumbs,
// and — per WAI-ARIA APG — exposes each thumb individually with its own accessible name (`slider.thumbMin` /
// `slider.thumbMax`, overridable via `minThumbLabel`/`maxThumbLabel`) and value text (`formatValue` or
// `String(n)`). Dragging the low thumb past the high thumb (or vice versa) "swaps" them so `onChange` always
// receives a SORTED `[low, high]` tuple. A `step` increment governs keyboard/drag granularity, `disabled` dims
// and freezes both thumbs. Its only hooks are `useTranslation` (the i18n thumb labels, P1/S10) and `useId`
// (DOM ids the native platform does not need) — it FETCHES NOTHING.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface performs no query — it renders one controlled `[low, high]` value handed in by its parent.
// There is no request to be loading, to be empty, to fail, to go stale, or to be offline, so inventing those
// states would model an async dependency the web spec does not have (honesty covenant: no scope narrowing, no
// silent drift). There is likewise NO data hook and NO data port to bind (no P1/S8 Source/ViewModel). The
// sibling presentational ports Checkbox / Accordion / StaggerContainer set the same precedent (composable +
// pure model, no Source/ViewModel). The surface's REAL, fully-reproduced states are therefore the controlled
// value rendered as the two thumbs + the `low – high` summary, crossed with enabled/disabled, the label
// shown/hidden (`showLabel`), the default vs caller `formatValue`, the default i18n vs overridden thumb
// labels, and the thumb-swap normalization — each reduced here by a pure function and asserted off-device,
// doubling as the per-state snapshot. The owning screen that DOES fetch renders its own data surface (with
// those states) and drops this slider into it.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/RangeSlider — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.rangeslider

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no value, bounds, or label —
 * only this constant identifier — so a diagnostics line can never leak what the user is selecting.
 */
const val RANGE_SLIDER_SLUG: String = "RangeSlider"

/**
 * The separator the web renders between the two formatted values (`{displayLow}{' – '}{displayHigh}`): a
 * space, an en dash (U+2013), and a space. Pinned here so the summary text is byte-identical to the web.
 */
const val RANGE_SUMMARY_SEPARATOR: String = " \u2013 "

/** Floats at or beyond this magnitude lose integer precision, so the integral-text shortcut is skipped. */
private const val INTEGRAL_LIMIT: Float = 1e15f

/**
 * Canonical registry metadata for the RangeSlider surface — the native mirror of the web component's contract.
 * The diagnostics [SLUG] is the surface slug the prompt mandates (`RangeSlider`) and [DEFAULT_STEP] mirrors the
 * web `step = 1` default.
 */
object RangeSliderRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on the slider. */
    const val ID: String = "range-slider"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = RANGE_SLIDER_SLUG

    /** The web `step = 1` default increment. */
    const val DEFAULT_STEP: Float = 1f
}

/**
 * Convert the web `step` (an increment over `[min, max]`) into the Material 3 `steps` count (the number of
 * discrete stops strictly BETWEEN the endpoints). The web slider snaps to `min + k·step`; Material 3 with
 * `steps = n` snaps to `n + 1` equal intervals, so `n = round((max − min) / step) − 1`, clamped to ≥ 0. A
 * non-positive/non-finite step or a non-positive span yields `0` (a continuous Material 3 slider), matching a
 * web slider whose step would place no interior stop. Pure, so the snapping contract is asserted off-device.
 */
fun rangeSliderSteps(
    min: Float,
    max: Float,
    step: Float,
): Int {
    val span = max - min
    val hasInteriorStops = min.isFinite() && max.isFinite() && step.isFinite() && span > 0f && step > 0f
    return if (hasInteriorStops) ((span / step).roundToInt() - 1).coerceAtLeast(0) else 0
}

/**
 * Sort two thumb positions into a `low..high` range — the native mirror of the web thumb-swap, whose `onChange`
 * always receives a SORTED `[low, high]` tuple regardless of which thumb the user dragged past the other. Pure,
 * so the swap contract is asserted off-device.
 */
fun sortedBounds(
    a: Float,
    b: Float,
): ClosedFloatingPointRange<Float> = if (a <= b) a..b else b..a

/**
 * Clamp a `[low, high]` selection into the slider [bounds] and re-sort it — the defensive native guard that
 * keeps the value Material 3 requires (`bounds.start ≤ low ≤ high ≤ bounds.endInclusive`) even if a caller
 * hands in an out-of-range or inverted tuple. Applied to both the incoming value and every emitted change so
 * the callback honours the web's "always normalised so low ≤ high" contract. Pure, asserted off-device.
 */
fun coerceRangeIntoBounds(
    range: ClosedFloatingPointRange<Float>,
    bounds: ClosedFloatingPointRange<Float>,
): ClosedFloatingPointRange<Float> {
    val low = range.start.coerceIn(bounds.start, bounds.endInclusive)
    val high = range.endInclusive.coerceIn(bounds.start, bounds.endInclusive)
    return sortedBounds(low, high)
}

/**
 * Format a single bound the way the web does WITHOUT a `formatValue` (`String(n)`): an integral value renders
 * with no decimal (`3`, not `3.0`), a fractional value renders as-is (`3.5`). Pure, so the default-text path is
 * asserted off-device. Used only when the caller supplies no formatter — see [formatBound].
 */
fun defaultBoundText(value: Float): String {
    if (value.isFinite() && abs(value) < INTEGRAL_LIMIT) {
        val whole = value.toLong()
        if (whole.toFloat() == value) return whole.toString()
    }
    return value.toString()
}

/**
 * Format one bound — the caller's [formatValue] when supplied (web `formatValue ? formatValue(n) : …`),
 * otherwise [defaultBoundText] (web `String(n)`). Drives both the displayed summary and each thumb's spoken
 * value text. Pure, asserted off-device.
 */
fun formatBound(
    value: Float,
    formatValue: ((Float) -> String)?,
): String = formatValue?.invoke(value) ?: defaultBoundText(value)

/**
 * Build the `low – high` summary the label row shows (web `{displayLow}{' – '}{displayHigh}`), formatting each
 * bound with [formatBound] and joining with [RANGE_SUMMARY_SEPARATOR]. Pure, asserted off-device.
 */
fun formatRangeSummary(
    low: Float,
    high: Float,
    formatValue: ((Float) -> String)?,
): String = formatBound(low, formatValue) + RANGE_SUMMARY_SEPARATOR + formatBound(high, formatValue)

/**
 * Resolve a thumb's accessible name — the caller [override] when present, otherwise the i18n [fallback] (web
 * `minThumbLabel ?? t('slider.thumbMin', '{{label}} minimum', { label })`). Matches the web `??` exactly: only
 * a `null` override falls back, so an explicit (even empty) override is honoured verbatim. Pure, asserted
 * off-device.
 */
fun resolveThumbLabel(
    override: String?,
    fallback: String,
): String = override ?: fallback

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant
 * surface [SLUG] — never the value, the bounds, or the label — so observability can never leak what is being
 * selected. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object RangeSliderDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = RANGE_SLIDER_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
