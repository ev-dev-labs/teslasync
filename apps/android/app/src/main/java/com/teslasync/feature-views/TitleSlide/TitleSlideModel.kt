// Pure, framework-free model + projection for the TitleSlide feature view — the native analogue of the
// handful of reads the web component performs before returning JSX
// (web/src/features/analytics/components/review/TitleSlide.tsx). No Compose, no Android, no HTTP: every
// declaration here runs off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// TitleSlide is a purely presentational surface — the web component takes its `data: YearReview` as a
// required prop from the Year-in-Review slide host (`SlideRenderer`) that owns the `useYearReview` query, so
// this surface binds NO data hook of its own (its only `t()` call is the `yearReview.title` label). As in
// the sibling AchievementBadge / ToolCard ports, the cache-then-network lifecycle (loading / error / stale /
// offline) is owned by that host page, not this leaf; modelling those states here would invent behaviour the
// web source does not have. The single render path the web source actually defines — the year hero, the
// localized "Year in Review" title, and the vehicle display name — is the complete view this surface
// renders, and each value is projected here.
//
// [TitleSlideData] mirrors the slice of the web `YearReview` interface this slide reads (`year` and
// `vehicle.display_name`); the other ~40 `YearReview` fields drive the sibling slides (each its own prompt),
// so they are intentionally not modelled here. `display_name` keeps its snake_case wire name via @SerialName
// and every field defaults, so a lenient decoder (ignoreUnknownKeys) reads it straight off the raw
// `/analytics/year-review` JSON.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TitleSlide — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AchievementBadge surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.titleslide

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.util.Locale

/** Em dash shown when the vehicle display name is missing/blank (repo null-safety, web `label ?? '—'`). */
private const val EM_DASH = "\u2014"

/** The year is rendered as a whole number with locale grouping (web `fmtNumber(year, 0)` → e.g. "2,024"). */
private const val YEAR_DECIMALS = 0

/**
 * The vehicle sub-object of the web `YearReview` (`{ id, display_name, model }`), modelled 1:1 so the same
 * decoded payload the host passes to every slide carries here unchanged. Only [displayName] is rendered by
 * TitleSlide; [id] and [model] are kept for shape fidelity and default so a partial payload still decodes.
 */
@Serializable
data class TitleSlideVehicle(
    val id: Long = 0,
    @SerialName("display_name") val displayName: String = "",
    val model: String = "",
)

/**
 * The slice of the web `YearReview` payload TitleSlide reads — the recap [year] and the [vehicle] whose
 * display name labels the slide. Every field defaults and the decoder ignores the other `YearReview` columns
 * (owned by the sibling slides), so this decodes straight off the raw `/analytics/year-review` JSON.
 */
@Serializable
data class TitleSlideData(
    val year: Int = 0,
    val vehicle: TitleSlideVehicle = TitleSlideVehicle(),
)

/**
 * The one localized label the surface folds into its output — the web `t('yearReview.title', 'Year in
 * Review')` key. The composable builds this from `stringResource`; tests pass a deterministic instance. Kept
 * as a holder (rather than a bare string) for consistency with the sibling YearReview / EventTimeline ports.
 */
data class TitleSlideStrings(
    val title: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component resolves
 * before returning JSX. Pure data (no Compose types) so it is unit-tested without a UI host.
 *
 * @property year the recap year, fed to the hero count-up as its animation target (web `data.year`).
 * @property yearLabel the final year formatted with locale grouping (web `fmtNumber(year, 0)`); it is both
 *   the count-up's resting text and its stable TalkBack label, so a screen reader announces the year once
 *   instead of every intermediate count-up frame.
 * @property title the localized "Year in Review" subtitle (web `t('yearReview.title')`).
 * @property vehicleName the vehicle display name (web `data.vehicle.display_name`), falling back to an em
 *   dash when blank so a malformed payload never renders an empty line.
 */
data class TitleSlideDisplay(
    val year: Int,
    val yearLabel: String,
    val title: String,
    val vehicleName: String,
)

/**
 * Pure projection from a decoded [TitleSlideData] to its render-ready [TitleSlideDisplay] — a 1:1 port of the
 * three values the web component reads before returning JSX (`data.year`, the localized title, and
 * `data.vehicle.display_name`), plus the locale-grouped year label the web `AnimatedNumber` renders.
 */
object TitleSlideProjection {
    /**
     * Select the render-ready view for [data] using the localized [strings] and [locale]. [locale] drives
     * the year grouping so the rendered figure matches the web `fmtNumber` output for the active locale.
     */
    fun project(
        data: TitleSlideData,
        strings: TitleSlideStrings,
        locale: Locale = Locale.getDefault(),
    ): TitleSlideDisplay =
        TitleSlideDisplay(
            year = data.year,
            yearLabel = ChartFormat.number(data.year * 1.0, YEAR_DECIMALS, locale),
            title = strings.title,
            vehicleName = data.vehicle.displayName.ifBlank { EM_DASH },
        )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the year
 * or the vehicle name — so a diagnostics line can never leak which vehicle a user owns.
 */
object TitleSlideDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (mandated by the P3 prompt). */
    const val SLUG: String = "TitleSlide"

    /**
     * Generated catalog key (P1/S10) backing the web `yearReview.title` string — pinned so a unit test can
     * assert the native catalog mirror matches the web i18n key without a Compose host.
     */
    const val KEY_TITLE: String = "translation_yearReview_title"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
