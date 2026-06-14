// Pure, framework-free model + bounds arithmetic + label resolver + diagnostics for the DataTableResizer shared
// surface — the native analogue of every decision the web component makes (web/src/components/ui/DataTableResizer.tsx)
// before Compose paints the handle. No Compose, no Android, no HTTP: every declaration here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer over it.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a drag handle that
// resizes a `<th>`. Its only logic is the clamp `Math.max(minWidth, Math.min(maxWidth, Math.round(n)))` applied
// to (a) a pointer drag (`startWidth + (clientX - startX)`, emitted continuously through `onResize`, the final
// value persisted on release through `onResizeEnd`) and (b) the WAI-ARIA "Window Splitter" keyboard map
// (ArrowLeft −8, ArrowRight +8, Home → 80, End → maxWidth, each emitting `onResize` AND `onResizeEnd`). It also
// exposes `aria-valuenow/min/max` and an `aria-label` that defaults to `Resize column ${columnKey}`. It fetches
// nothing and owns no data.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface performs no query — it is a controlled affordance whose width the parent table owns. There is nothing
// to be loading, to be empty, to fail, to go stale, or to be offline, so inventing those states would model an
// async dependency the web spec does not have (honesty covenant: no scope narrowing, no silent drift). The
// surface's REAL, fully-reproduced states are the handle's interaction states — idle, keyboard-focused, and
// actively dragging — crossed with the value reaching its min / max bound. Each is reduced here in [ResizeBounds]
// and asserted off-device, doubling as the per-state snapshot. The presentational precedents are the sibling
// Checkbox / StaggerContainer / Accordion / TimelineScrubber surfaces (composable + pure model, no Source/ViewModel).
//
// SI boundary (unit-conversion instructions): the web works in CSS pixels; the native analogue is the
// density-independent pixel (dp), so the canonical width is modelled as an Int dp count and the composable
// converts pointer deltas with the screen density. There is no physical-unit conversion (km/mi, °C/°F, …) here —
// a column width is a layout measurement, not a vehicle datum — so the surface touches no SI boundary.
//
// i18n (P1/S10): the web owns one string, the `aria-label` default `Resize column ${columnKey}`. It resolves
// here by-name through the i18n facade ([resolveOptional], the native mirror of i18next `t(key, default)`) with
// the English [DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE] fallback, exactly like the sibling Accordion
// surface's native-only affordances — so there is no hardcoded English literal in the render path and a catalog
// translation overrides it without a code change.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DataTableResizer — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatableresizer

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no column key and no width —
 * only this constant identifier — so a diagnostics line can never leak which column the user is resizing.
 */
const val DATA_TABLE_RESIZER_SLUG: String = "DataTableResizer"

/** Default minimum column width in dp — the native mirror of the web `minWidth = 60`. */
const val DEFAULT_MIN_WIDTH_DP: Int = 60

/** Default maximum column width in dp — the native mirror of the web `maxWidth = 800`. */
const val DEFAULT_MAX_WIDTH_DP: Int = 800

/** Keyboard nudge increment in dp — the web ArrowLeft/ArrowRight `± 8`. */
const val KEYBOARD_STEP_DP: Int = 8

/** The width Home snaps to in dp — the web `Home` key `clamp(80)`. */
const val HOME_WIDTH_DP: Int = 80

/** Resource name for the resize-handle accessible label (by-name; absent ⇒ the English template fallback). */
const val KEY_RESIZE_COLUMN: String = "translation_dataTableResizer_resizeColumn"

/**
 * Canonical registry metadata for the DataTableResizer surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`DataTableResizer`).
 */
object DataTableResizerRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its handle. */
    const val ID: String = "data-table-resizer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = DATA_TABLE_RESIZER_SLUG
}

/**
 * Surface defaults that are not themselves Compose values — the web prop defaults plus the English label
 * template. The Dp-typed `minWidth` / `maxWidth` defaults live in the composable (a Dp needs Compose); these are
 * the framework-free numbers the composable derives them from, so the bound arithmetic stays unit-testable.
 */
object DataTableResizerDefaults {
    /** Default minimum width in dp (web `minWidth = 60`). */
    const val MIN_WIDTH_DP: Int = DEFAULT_MIN_WIDTH_DP

    /** Default maximum width in dp (web `maxWidth = 800`). */
    const val MAX_WIDTH_DP: Int = DEFAULT_MAX_WIDTH_DP

    /** Keyboard step in dp (web `± 8`). */
    const val STEP_DP: Int = KEYBOARD_STEP_DP

    /** Home-key width in dp (web `clamp(80)`). */
    const val HOME_DP: Int = HOME_WIDTH_DP

    /**
     * English fallback for the accessible label — a positional format template (`%1$s` ⇒ the column key) that is
     * the native mirror of the web default `Resize column ${columnKey}`. Used only when the catalog key
     * [KEY_RESIZE_COLUMN] is absent (the i18next `t(key, default)` default argument), so it is never a hardcoded
     * literal in the render path.
     */
    const val RESIZE_COLUMN_TEMPLATE: String = "Resize column %1\$s"
}

/**
 * One of the WAI-ARIA "Window Splitter" keyboard commands the handle accepts — the native mirror of the web
 * `onKeyDown` switch. [Shrink] / [Grow] nudge by [KEYBOARD_STEP_DP]; [Home] snaps to [HOME_WIDTH_DP]; [End]
 * maxes out at the bound's maximum. Pure (no Compose [androidx.compose.ui.input.key.Key]) so the command → width
 * resolution is unit-tested off-device; the composable maps physical keys onto these cases.
 */
enum class ResizeCommand {
    /** ArrowLeft — shrink one keyboard step. */
    Shrink,

    /** ArrowRight — grow one keyboard step. */
    Grow,

    /** Home — snap to the home width. */
    Home,

    /** End — grow to the maximum width. */
    End,
}

/**
 * The inclusive width bounds for a column, in dp — the native mirror of the web `minWidth` / `maxWidth` props.
 * All resolution flows through [clamp] so the rounded, clamped result matches the web
 * `Math.max(minWidth, Math.min(maxWidth, Math.round(n)))` exactly. Degenerate bounds (a max below the min, which
 * the web never guards) are normalised through [effectiveMax] so the model never throws.
 *
 * @property minWidthDp the smallest allowed width in dp (web `minWidth`).
 * @property maxWidthDp the largest allowed width in dp (web `maxWidth`).
 */
data class ResizeBounds(
    val minWidthDp: Int = DEFAULT_MIN_WIDTH_DP,
    val maxWidthDp: Int = DEFAULT_MAX_WIDTH_DP,
) {
    /** The max raised to at least the min, so [clamp] never coerces into an empty range. */
    val effectiveMax: Int
        get() = if (maxWidthDp < minWidthDp) minWidthDp else maxWidthDp

    /**
     * Round [valueDp] to the nearest whole dp and clamp it into `[minWidthDp, effectiveMax]` — the faithful port
     * of the web `clamp = Math.max(minWidth, Math.min(maxWidth, Math.round(n)))`.
     */
    fun clamp(valueDp: Float): Int = valueDp.roundToInt().coerceIn(minWidthDp, effectiveMax)

    /** Clamp an already-integer dp width (the keyboard/drag commit path). */
    fun clamp(valueDp: Int): Int = valueDp.coerceIn(minWidthDp, effectiveMax)

    /** [currentDp] grown/shrunk by [deltaDp], clamped — backs the keyboard step (web `clamp(width ± 8)`). */
    fun nudge(
        currentDp: Int,
        deltaDp: Int,
    ): Int = clamp(currentDp + deltaDp)

    /** The Home-key width — the web `clamp(80)`. */
    fun homeWidth(): Int = clamp(HOME_WIDTH_DP)

    /** The End-key width — the web `clamp(maxWidth)`, i.e. the (normalised) maximum. */
    fun endWidth(): Int = effectiveMax

    /**
     * Resolve the new width for a keyboard [command] applied to [currentDp] — the native mirror of the web
     * `onKeyDown` switch (ArrowLeft/ArrowRight/Home/End), each already clamped.
     */
    fun applyCommand(
        currentDp: Int,
        command: ResizeCommand,
    ): Int =
        when (command) {
            ResizeCommand.Shrink -> nudge(currentDp, -KEYBOARD_STEP_DP)
            ResizeCommand.Grow -> nudge(currentDp, KEYBOARD_STEP_DP)
            ResizeCommand.Home -> homeWidth()
            ResizeCommand.End -> endWidth()
        }
}

/**
 * Substitute [columnKey] into a resolved label [template] — the native mirror of the web
 * `Resize column ${columnKey}` interpolation. The template is a positional format string (`%1$s`), so a catalog
 * translation can reorder the column name for its grammar. Pure so it is unit-tested off-device.
 */
fun resizeColumnLabel(
    template: String,
    columnKey: String,
): String = template.format(columnKey)

/**
 * The accessible label the handle announces — the native mirror of the web `label ?? \`Resize column
 * ${columnKey}\``. A non-blank caller [override] (web `label`) wins; otherwise [columnKey] is formatted into the
 * resolved [template]. Pure so the precedence is unit-tested off-device.
 */
fun resolvedResizeLabel(
    override: String?,
    template: String,
    columnKey: String,
): String = override?.takeIf { it.isNotBlank() } ?: resizeColumnLabel(template, columnKey)

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the English [fallback]. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests, so
 * the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the column
 * key, the width, or the bounds — so a diagnostics line can never leak which column the user is resizing or how
 * wide they made it. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object DataTableResizerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = DATA_TABLE_RESIZER_SLUG

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
