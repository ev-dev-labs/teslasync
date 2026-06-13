// Pure, framework-free model + projection for the ElevationProfile shared surface — the native analogue of
// everything the web component reads from its props before returning JSX
// (web/src/components/charts/ElevationProfile.tsx). No Compose, no Android, no HTTP: every declaration here
// is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a thin render
// layer over these pure functions.
//
// The web component is purely presentational. It receives an `ElevationDataPoint[]` (each `{ index, distance,
// elevation, speed? }`) plus an optional replay `currentIndex`, derives the cumulative elevation gain / loss
// (the `↑ {gain}m  ↓ {loss}m` subtitle), resolves the synced-cursor distance, and renders a single
// gradient-filled elevation Area over the distance axis inside the shared `<ChartContainer>` — with a friendly
// "No elevation data available" surface when `data.length === 0`. This file owns that contract's pure half:
// the prop slice the surface reads, the render-ready projection (the distance x labels, the index-aligned
// elevation value list, the web-faithful rounded gain / loss totals and `↑ …m  ↓ …m` subtitle, the clamped
// cursor index, and the `length === 0` empty guard), the prop-driven lifecycle-state builder, the locale
// resolver, and the PII-safe `view.opened` diagnostic.
//
// SI boundary (unit-conversion instructions, ADR / Phase-48): `elevation` and the gain / loss totals are SI
// metres exactly as the API serves them — the web shows them with a literal `m`, so no preference conversion
// happens here. `distance` arrives ALREADY in the user's display unit (the web `distanceUnit` prop, mirrored
// on Android by resolving the live distance-unit label at the Compose boundary); this projection only labels
// it, so — like the web component — it performs no distance math, only formatting.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ElevationProfile — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.elevationprofile

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/** The SI metre symbol — the web's literal `m` suffix on the gain / loss subtitle and the elevation series. */
internal const val METERS_UNIT: String = "m"

/** The web `distanceUnit` prop default (`'km'`) — used when no live unit preference is supplied. */
internal const val DEFAULT_DISTANCE_UNIT: String = "km"

/** Fraction digits for the distance x-axis labels — the web `<XAxis tickFormatter={(v) => fmt(v, 1)} />`. */
internal const val DISTANCE_DECIMALS: Int = 1

/** Fraction digits for the elevation y-axis labels — the web `<YAxis tickFormatter={(v) => fmt(v, 0)} />`. */
internal const val ELEVATION_DECIMALS: Int = 0

/** The web `<Area dataKey="elevation" />` series key. */
internal const val ELEVATION_SERIES_KEY: String = "elevation"

/** Climbed-total arrow — the web `↑` glyph in the subtitle (language-neutral). */
internal const val GAIN_ARROW: String = "\u2191"

/** Descended-total arrow — the web `↓` glyph in the subtitle (language-neutral). */
internal const val LOSS_ARROW: String = "\u2193"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ElevationProfileRegistration {
    /** Stable surface id. */
    const val ID: String = "elevation-profile"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ElevationProfile"
}

/**
 * One sample along the route — the native mirror of the web `ElevationDataPoint`.
 *
 * @property index the host's original-sample id (the web `data[i].index`; the payload the web `onClickIndex`
 *   would emit). Carried verbatim so a replay host can map a selected point back to its source sample.
 * @property distance cumulative distance ALREADY in the user's display unit (the web `distance`, labelled by
 *   the `distanceUnit` prop); the x-axis position of the sample.
 * @property elevation elevation above sea level in SI metres (the web `elevation`, never converted).
 * @property speed the sample's speed, carried for data-shape parity with the web type but — like the web
 *   component, whose Area plots `elevation` only — not plotted by this surface.
 */
data class ElevationProfilePoint(
    val index: Int,
    val distance: Double,
    val elevation: Double,
    val speed: Double? = null,
)

/**
 * The full prop bundle this surface renders — the native pairing of the web component's `data` prop. The host
 * (the trip-replay state holder, P1/S8) supplies it; the surface performs no fetch and no unit conversion of
 * its own.
 *
 * @property points the per-sample elevation series, in route order.
 */
data class ElevationProfileData(
    val points: List<ElevationProfilePoint>,
)

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the `replay.elevation.*`
 * keys the web component resolves via `t(...)`. The lifecycle-chrome strings (empty / error / retry / offline /
 * freshness) are resolved inline at the Compose boundary, not here, so this holder stays a thin content carrier.
 *
 * @property title the panel title (web `replay.elevation.title`).
 * @property ariaLabel the chart's screen-reader description (web `replay.elevation.aria`).
 * @property seriesLabel the elevation series / tooltip name (web `replay.elevation.label`).
 */
data class ElevationProfileStrings(
    val title: String,
    val ariaLabel: String,
    val seriesLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web component derives from
 * its props inline. Pure data (no Compose types) so the projection is unit-tested without a UI host: the
 * composable feeds [xLabels] to the bottom axis, wraps [elevationValues] into the single elevation `ChartSeries`,
 * renders [subtitle] in the container header, anchors the cursor marker at [cursorIndex], and shows the friendly
 * empty state when [isEmpty] (the web `data.length === 0` branch).
 *
 * @property xLabels the per-sample distance labels (web `<XAxis dataKey="distance" />`).
 * @property elevationValues the elevation Area values, index-aligned with [xLabels].
 * @property gainMeters total metres climbed over the route (web `Math.round(gain)`).
 * @property lossMeters total metres descended over the route (web `Math.round(loss)`).
 * @property subtitle the `↑ {gain}m  ↓ {loss}m` header line (web `subtitle`).
 * @property cursorIndex the clamped replay-cursor index, or `null` when no valid cursor (web `cursorDistance`).
 * @property isEmpty whether the no-data empty state should render (web `data.length === 0`).
 */
data class ElevationProfileProjectionResult(
    val xLabels: List<String>,
    val elevationValues: List<Double?>,
    val gainMeters: Long,
    val lossMeters: Long,
    val subtitle: String,
    val cursorIndex: Int?,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the inline derivations in the web
 * `ElevationProfile`. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the
 * composable only resolves localized strings, the palette color, the synced cursor, and freshness chrome.
 */
object ElevationProfileProjection {
    /**
     * Projects [data] into render-ready inputs. [currentIndex] is the already-resolved replay cursor (the
     * explicit prop or the synced cross-chart position) and is clamped to the sample range, reproducing the web
     * `data[currentIndex]` guard. Injecting [formatDistance] (the x-axis label formatter) keeps the projection
     * locale-deterministic under test; the gain / loss totals are rendered with the web's grouping-free
     * `${Math.round(n)}` integer formatting, so the [subtitle] is locale-independent.
     */
    fun project(
        data: ElevationProfileData,
        currentIndex: Int?,
        formatDistance: (Double) -> String,
    ): ElevationProfileProjectionResult {
        val points = data.points
        val (gain, loss) = gainLoss(points.map { it.elevation })
        return ElevationProfileProjectionResult(
            xLabels = points.map { formatDistance(it.distance) },
            elevationValues = points.map { it.elevation },
            gainMeters = gain,
            lossMeters = loss,
            subtitle = "$GAIN_ARROW $gain$METERS_UNIT  $LOSS_ARROW $loss$METERS_UNIT",
            cursorIndex = currentIndex?.takeIf { it in points.indices },
            isEmpty = points.isEmpty(),
        )
    }

    /**
     * Cumulative elevation gain / loss over [elevations] — the web reducer:
     * each consecutive positive delta adds to the gain, each negative delta's magnitude to the loss. The totals
     * are rounded with the web `Math.round` semantics (half up, `floor(x + 0.5)`) so the rendered figures match
     * the web exactly; a non-finite running total collapses to `0` so a corrupt sample never shows `NaN`.
     */
    fun gainLoss(elevations: List<Double>): Pair<Long, Long> {
        var gain = 0.0
        var loss = 0.0
        for (i in 1 until elevations.size) {
            val diff = elevations[i] - elevations[i - 1]
            if (diff > 0) gain += diff else loss += abs(diff)
        }
        return roundHalfUp(gain) to roundHalfUp(loss)
    }

    /** `floor(value + 0.5)` — the web `Math.round` for the non-negative gain / loss totals; NaN/∞ → `0`. */
    private fun roundHalfUp(value: Double): Long {
        val safe = if (value.isFinite()) value else 0.0
        return floor(safe + 0.5).toLong()
    }
}

/**
 * Builds the prop-driven [UiState] the web-parity overload renders — the native mirror of the web component
 * receiving `data` directly from its parent. A `null` / empty list maps to [UiPhase.Empty] (the web
 * `data.length === 0` branch); one or more samples map to [UiPhase.Content]. There is no fetch behind this, so
 * it carries no freshness / error fields — those live on the host feed when the stateful entry is used.
 */
fun elevationProfileState(points: List<ElevationProfilePoint>?): UiState<ElevationProfileData> {
    val resolved = points ?: emptyList()
    val phase = if (resolved.isEmpty()) UiPhase.Empty else UiPhase.Content
    return UiState(phase = phase, data = ElevationProfileData(resolved))
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to US for a blank / absent preference. */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ElevationProfileRegistration.SLUG]
 * (P1/S11). Carries only the slug — never an elevation, distance, or sample index — so a diagnostics line can
 * never leak the fleet's routes. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordElevationProfileOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ElevationProfileRegistration.SLUG))
}
