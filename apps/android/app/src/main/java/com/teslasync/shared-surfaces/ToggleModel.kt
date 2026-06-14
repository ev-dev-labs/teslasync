// Pure, framework-free model + size taxonomy + geometry projection for the Toggle shared surface — the native
// analogue of every decision the web component makes (web/src/components/ui/Toggle.tsx) before it paints its
// switch. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): an accessible switch
// primitive. A real `<button role="switch" aria-checked>` carries the keyboard / screen-reader semantics; a
// styled track + sliding thumb follow the design tokens and draw one of two visual outcomes:
//   • `checked` true  → an accent (web cyan) track with the thumb slid to the right (web `translate-x-N`);
//   • else            → a neutral (web gray) track with the thumb resting on the left.
// The track + thumb scale with the `size` prop (sm / md), an optional `label` sits to the switch's right, and
// `onChange` reports the toggled boolean. Clicking the label OR the switch toggles (the web wrapper delegates the
// label click to the button). Every one of those is reproduced by the composable in Toggle.kt over this model.
//
// The web source has NO `useTranslation` and NO `t()` call — the `label` is a caller-supplied string and the
// accessible name comes from that label (web `aria-labelledby`) or a spread `aria-label`, never a literal owned
// by the component. So this surface adds NO i18n keys and NO English literal (honesty covenant: no silent
// drift); the on / off state announcement is supplied — already localized — by the platform's `Role.Switch`
// toggle semantics, not by a hand-rolled string. There is likewise NO data hook, NO fetch, and NO data port to
// bind (no P1/S8 Source/ViewModel): the web component fetches nothing, so modelling an async dependency would
// invent one the spec does not have. The presentational precedent is the sibling Checkbox surface (composable +
// model), whose `useId` is the only "data source" the prompt extracts here too — a pure id helper, reproduced
// natively by the framework's semantics merge, never a query.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it renders one boolean switch and only ever shows one of two tracks (off / on),
// scaled to one of two sizes and optionally labelled. There is no query to be loading, to be empty, to go stale,
// or to be offline, so inventing those states would be dishonest. The owning screen that DOES fetch renders its
// own data surface (with those states) and drops this toggle into it. The surface's REAL, fully-reproduced
// states are therefore the two track branches below (off / on) × the two sizes (sm / md) × labelled / unlabelled,
// each reduced here in [metricsFor] + [thumbOffsetFor] and asserted off-device, doubling as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Toggle — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling Checkbox / VehicleMultiSelect surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toggle

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no checked value and no
 * label — only this constant identifier — so a diagnostics line can never leak what the user is toggling.
 */
const val TOGGLE_SLUG: String = "Toggle"

/**
 * Canonical registry metadata for the Toggle surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Toggle`).
 */
object ToggleRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its row. */
    const val ID: String = "toggle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = TOGGLE_SLUG
}

/**
 * Visual size of the switch — the native mirror of the web `size` prop (`sm` / `md`), which scales the track and
 * the thumb together. Defaults to [Md] in the composable, matching the web default. Pure (no Compose) so the
 * dp geometry in Toggle.kt stays a thin, testable lookup over these two cases.
 */
enum class ToggleSize {
    Sm,
    Md,
}

/**
 * The dp geometry of the switch at a given [ToggleSize] — the native mirror of the web `trackSize` / `thumbSize`
 * / `thumbTranslate` lookups, kept as plain dp magnitudes (no Compose `Dp`) so the whole projection is covered
 * off-device. All values are 1:1 with the web pixel sizes:
 *
 * | size | track (w × h) | thumb | inset | checked Δx |
 * |------|---------------|-------|-------|-----------|
 * | sm   | 36 × 20       | 14    | 3     | 16        |
 * | md   | 44 × 24       | 20    | 3     | 20        |
 *
 * @param trackWidthDp width of the pill track (web `w-9` / `w-11`).
 * @param trackHeightDp height of the pill track (web `h-5` / `h-6`).
 * @param thumbDiameterDp diameter of the round thumb (web `h-3.5 w-3.5` / `h-5 w-5`).
 * @param thumbInsetDp resting inset of the thumb from the track's leading edge (web base `translate-x-[3px]`).
 * @param checkedOffsetDp extra distance the thumb slides when checked (web `translate-x-4` / `translate-x-5`).
 */
data class ToggleMetrics(
    val trackWidthDp: Int,
    val trackHeightDp: Int,
    val thumbDiameterDp: Int,
    val thumbInsetDp: Int,
    val checkedOffsetDp: Int,
)

/**
 * Resolve the dp [ToggleMetrics] for a [ToggleSize] — the native mirror of the web per-size class lookups.
 * Pure, so both sizes are exhaustively unit-tested off-device, doubling as the per-size snapshot.
 */
fun metricsFor(size: ToggleSize): ToggleMetrics =
    when (size) {
        ToggleSize.Sm ->
            ToggleMetrics(
                trackWidthDp = 36,
                trackHeightDp = 20,
                thumbDiameterDp = 14,
                thumbInsetDp = 3,
                checkedOffsetDp = 16,
            )

        ToggleSize.Md ->
            ToggleMetrics(
                trackWidthDp = 44,
                trackHeightDp = 24,
                thumbDiameterDp = 20,
                thumbInsetDp = 3,
                checkedOffsetDp = 20,
            )
    }

/**
 * The thumb's horizontal offset (dp) from the track's leading edge for the given state — the native mirror of
 * the web base `translate-x-[3px]` plus, when checked, `translate-x-N`. Off rests at [ToggleMetrics.thumbInsetDp];
 * on slides to `inset + checkedOffset`. Pure, so the two positions per size are the per-state projection asserted
 * off-device.
 */
fun thumbOffsetFor(
    metrics: ToggleMetrics,
    checked: Boolean,
): Int = metrics.thumbInsetDp + if (checked) metrics.checkedOffsetDp else 0

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never the checked value, the label, or any user data — so a diagnostics line can never leak
 * what is being toggled. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object ToggleDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = TOGGLE_SLUG

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
