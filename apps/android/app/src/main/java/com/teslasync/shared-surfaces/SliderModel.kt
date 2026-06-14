// Pure, framework-free model + projection + diagnostics for the Slider shared surface — the native analogue
// of every decision the web component makes (web/src/components/ui/Slider.tsx) before it paints its track. No
// Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, keeping the composable in Slider.kt a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a single-thumb slider
// primitive wrapping a native `<input type="range">`. It takes a numeric `value` inside `[min, max]`, snaps to a
// `step` increment (default 1), reports the new value through `onChange`, and exposes the full WAI-ARIA APG slider
// keyboard contract (Arrow/Page/Home/End). An optional `formatValue` turns the raw number into unit-aware copy
// that is shown in the live value span AND announced via `aria-valuetext`; without it the raw number is used.
// `showLabel` (default true) toggles the visible label row — when false the visible label is hidden and the name
// is exposed through `aria-label`. `disabled` dims and disables the control. Every one of those is reproduced by
// the composable over this model: the discrete-step count, the value coercion, and the displayed/announced text
// are all derived here so the render layer only lays out primitives.
//
// The web source has NO `useTranslation` and NO `t()` call — the `label` is a caller-supplied string and the
// accessible name comes from that label (or the spread `aria-label`), never a literal owned by the component. So
// this surface adds NO i18n catalog key and NO English literal (honesty covenant: no silent drift): the slider's
// value is announced through the platform `stateDescription` (the native mirror of `aria-valuetext`) carrying the
// already-localized, caller-formatted text, and the control is named by the caller's label.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing — its only React dependency is `useId`. It renders one controlled value control whose
// real, fully-reproduced states are the value position along the track, the discrete vs continuous step mode, the
// label-shown vs label-hidden row, and the enabled vs disabled dim. There is no query to be loading, to be empty,
// to go stale, or to be offline, so inventing those states would be dishonest. The owning screen that DOES fetch
// renders its own data surface (with those states) and drops this slider into it. The presentational precedent is
// the sibling Checkbox surface (composable + model, no Source/ViewModel).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Slider — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling Checkbox surface does. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.slider

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no slider value, bound, or
 * label — only this constant identifier — so a diagnostics line can never leak what the user is adjusting.
 */
const val SLIDER_SLUG: String = "Slider"

/** Test tag the composable stamps on its track, so the per-state + a11y UI test can target the slider node. */
const val SLIDER_TEST_TAG: String = "slider"

/**
 * Canonical registry metadata for the Slider surface — the native mirror of the web component's contract. The
 * diagnostics [SLUG], the kebab-case [ID], and the web `step = 1` default are pinned here so the native and web
 * surfaces stay in lockstep.
 */
object SliderRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its track. */
    const val ID: String = "slider"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = SLIDER_SLUG

    /** The web `step` default (`step = 1`) used by Arrow-key + drag snapping when the caller omits it. */
    const val DEFAULT_STEP: Float = 1f
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `Slider` folds together before
 * returning JSX: the [thumbValue] coerced into `[min, max]` (so the Material 3 track never receives an
 * out-of-range value), the [valueRange] and discrete [steps] the track is laid out with, and the [valueText] shown
 * in the live span and announced via `stateDescription` (the native mirror of `aria-valuetext`). Pure data so
 * [SliderProjection] is unit-tested without a UI host.
 *
 * @property thumbValue the value clamped into the (ordered) range, fed to the Material 3 track.
 * @property valueRange the ordered `[min, max]` span the track covers.
 * @property steps the number of discrete intermediate stops between the endpoints (0 ⇒ continuous).
 * @property valueText the formatted display copy (web `formatValue(value)` or `String(value)`).
 */
data class SliderDisplay(
    val thumbValue: Float,
    val valueRange: ClosedFloatingPointRange<Float>,
    val steps: Int,
    val valueText: String,
)

/**
 * Pure projection logic for the Slider surface — the native port of the derivations the web component performs
 * (`display = formatValue ? formatValue(value) : String(value)`, the `min`/`max`/`step` wiring of the native
 * range input). Every function is exhaustively unit-tested off-device, doubling as the surface's per-state
 * snapshot.
 */
object SliderProjection {
    /**
     * The number of discrete intermediate stops between the endpoints for a Material 3 track — the native
     * translation of the web `step` increment. The Material slider expresses discreteness as the count of stops
     * BETWEEN `min` and `max` (exclusive), so for an increment `step` over the span the selectable point count is
     * `span / step + 1` and the stop count is one less than the interval count. A non-positive [step] or a
     * non-positive span yields 0 (a continuous track, the native equivalent of an unstepped range input).
     */
    fun discreteStepCount(
        min: Float,
        max: Float,
        step: Float,
    ): Int {
        val span = max - min
        return if (step <= 0f || span <= 0f) {
            0
        } else {
            ((span / step).roundToInt() - 1).coerceAtLeast(0)
        }
    }

    /**
     * The default displayed/announced text when the caller supplies no `formatValue` — the native port of the web
     * `String(value)`. A whole number is rendered without a fractional tail (`32`, not `32.0`, matching JS
     * `String(32)`); a fractional value keeps its decimals (`12.5`). Non-finite input falls back to the raw string.
     */
    fun defaultValueText(value: Float): String =
        if (value.isFinite() && value % 1f == 0f) {
            value.toLong().toString()
        } else {
            value.toString()
        }

    /**
     * Folds the controlled [value], the `[min, max]` bounds, the [step] increment, and the optional [formatValue]
     * into the render-ready [SliderDisplay]. The bounds are ordered defensively (so a caller that passes `min`/
     * `max` reversed still yields a valid track), the value is coerced into that ordered span for the thumb, the
     * discrete-step count is derived, and the display text is formatted from the caller's RAW value to match the
     * web `display` (which formats the prop, not the clamped value).
     */
    fun project(
        value: Float,
        min: Float,
        max: Float,
        step: Float,
        formatValue: ((Float) -> String)?,
    ): SliderDisplay {
        val low = minOf(min, max)
        val high = maxOf(min, max)
        return SliderDisplay(
            thumbValue = value.coerceIn(low, high),
            valueRange = low..high,
            steps = discreteStepCount(low, high, step),
            valueText = formatValue?.invoke(value) ?: defaultValueText(value),
        )
    }
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never the slider value, the bounds, or the label — so a diagnostics line can never leak what is
 * being adjusted. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object SliderDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SLIDER_SLUG

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
