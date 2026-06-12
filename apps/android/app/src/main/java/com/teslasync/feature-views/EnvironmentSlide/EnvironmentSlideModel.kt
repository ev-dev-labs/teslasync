// Pure, framework-free model + projection for the EnvironmentSlide feature view — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/analytics/components/review/EnvironmentSlide.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// EnvironmentSlide is a purely presentational slide of the Year-in-Review deck — the web component takes its
// `data` (a `YearReview`) as a prop from the deck that owns the TanStack query, so this surface binds NO data
// hook of its own (its only `t()` calls are the `yearReview.co2Offset` / `yearReview.treesEquiv` /
// `yearReview.more` labels). As in the sibling AchievementBadge / StatusHeader ports, the cache-then-network
// lifecycle (loading / error / stale / offline) lives on the owning page, not here; modelling those states
// would invent behaviour the spec does not have (drift). The branches the web source actually defines — the
// equivalent-tree count, its 30-glyph cap, and the "+N more" overflow chip — are the complete state set this
// surface renders, and each is projected here (including the zero-offset case, which renders the friendly
// no-impact surface: a "0 kg" hero and an empty grid, never a blank box).
//
// SI note (Phase-48): `co2_offset_kg` is already SI on the wire — the kilogram is the SI unit of mass and the
// web type comments it "CO2 offset in kilograms (kg, SI)" — so, exactly like the sibling YearReviewWidget's
// CO₂ tile, there is no display-boundary conversion: the value is rendered as-is with the literal "kg" unit
// the web hard-codes (`suffix=" kg"`), never through a unit converter and never via i18n.
//
// [EnvironmentSlideData] mirrors the slice of the web `YearReview` interface this slide reads (`co2_offset_kg`
// via @SerialName, defaulted) so the projection runs straight off the cached `/analytics/year-review` JSON; a
// lenient decoder ignores the many other year-review columns this surface does not use.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EnvironmentSlide — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AchievementBadge surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.environmentslide

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

/**
 * The slice of the web `YearReview` payload this slide reads — just `co2_offset_kg`. Kept snake_case via
 * @SerialName and defaulted so a partial or still-loading payload decodes without error (the year-review
 * endpoint carries many more columns; the decoder ignores unknown keys).
 */
@Serializable
data class EnvironmentSlideData(
    @SerialName("co2_offset_kg") val co2OffsetKg: Double = 0.0,
)

/**
 * The fully projected, render-ready view — the native analogue of the two `useMemo` derivations the web
 * component performs before returning JSX. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host.
 *
 * @property co2OffsetKg the SI CO₂ offset in kilograms, fed to the count-up hero number (web `data.co2_offset_kg`).
 * @property treesPlanted the equivalent tree count, web `Math.round(co2_offset_kg / 21)`; also the `{{count}}`
 *   interpolated into the "Like planting N trees" caption.
 * @property treeIconCount how many 🌳 glyphs the grid draws — web `Math.min(treesPlanted, 30)`, floored at 0.
 * @property hasOverflow whether the "+N more" chip is shown — web `treesPlanted > 30`.
 * @property overflowCount the surplus beyond the [MAX_TREE_ICONS] cap shown by that chip — web `treesPlanted - 30`.
 */
data class EnvironmentSlideDisplay(
    val co2OffsetKg: Double,
    val treesPlanted: Int,
    val treeIconCount: Int,
    val hasOverflow: Boolean,
    val overflowCount: Int,
)

/**
 * Pure projection from an [EnvironmentSlideData] to its render-ready [EnvironmentSlideDisplay] — a 1:1 port of
 * the two derivations the web component performs (`treesPlanted` and the capped `treeIcons` array) before
 * returning JSX.
 */
object EnvironmentSlideProjection {
    /** kg of CO₂ a mature tree absorbs in a year — the web divisor in `Math.round(co2_offset_kg / 21)`. */
    const val KG_CO2_PER_TREE_PER_YEAR: Double = 21.0

    /** The 🌳 grid is capped at this many glyphs; the surplus is summarised by the "+N more" chip (web `Math.min(…, 30)`). */
    const val MAX_TREE_ICONS: Int = 30

    /**
     * The equivalent number of trees planted, web `Math.round(co2_offset_kg / 21)`. Kotlin's [roundToInt]
     * rounds halves towards positive infinity, matching JavaScript's `Math.round` (e.g. 0.5 → 1, 1.5 → 2).
     */
    fun treesPlanted(co2OffsetKg: Double): Int = (co2OffsetKg / KG_CO2_PER_TREE_PER_YEAR).roundToInt()

    /** Select the render-ready view for [data]. */
    fun project(data: EnvironmentSlideData): EnvironmentSlideDisplay {
        val trees = treesPlanted(data.co2OffsetKg)
        // Web `Array.from({ length: Math.min(treesPlanted, 30) })`: a non-positive length yields an empty grid
        // (JS ToLength clamps a negative length to 0), so the rendered glyph count is floored at 0 and capped at 30.
        val iconCount = trees.coerceIn(0, MAX_TREE_ICONS)
        val hasOverflow = trees > MAX_TREE_ICONS
        return EnvironmentSlideDisplay(
            co2OffsetKg = data.co2OffsetKg,
            treesPlanted = trees,
            treeIconCount = iconCount,
            hasOverflow = hasOverflow,
            overflowCount = if (hasOverflow) trees - MAX_TREE_ICONS else 0,
        )
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the CO₂
 * figure or the derived tree count — so a diagnostics line can never leak a user's driving footprint.
 */
object EnvironmentSlideDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "EnvironmentSlide"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
