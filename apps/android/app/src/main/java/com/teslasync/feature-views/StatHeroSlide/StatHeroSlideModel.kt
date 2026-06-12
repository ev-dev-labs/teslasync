// Pure, framework-free model + projection for the StatHeroSlide feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/review/StatHeroSlide.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer over these pure functions.
//
// StatHeroSlide is one slide of the Year-in-Review carousel. The web component takes its `data: YearReview`
// and `field: string` as props from `SlideRenderer` (which itself receives the fetched document from the
// review page that owns the TanStack query), so the surface binds NO data hook of its own — its web hooks
// are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useUnits` (mapped to the live
// [io.teslasync.android.data.UnitFormatter], P1/S8). From `data` it reads exactly two SI fields
// (`total_distance_km`, `total_energy_kwh`) and, switching on `field`, builds the hero config: an emoji, a
// big animated number, a unit line, and a comparison line. The complete set of render branches the web
// `getStatConfig` switch defines is reproduced here — `distance` (with its earth-laps vs "every kilometer"
// sub-branches), `energy`, and the `default` fallback for an unrecognised field — each projected purely.
//
// The cache-then-network lifecycle (loading / error / empty / stale / offline) is owned by the carousel
// page in the web, not by this slide; the native surface still renders every state the shared P1/S8 state
// layer can carry via [StatHeroSlideProjection.projectUiState] + a web-parity `data` overload, exactly as
// the sibling DrivingPerformanceCards / YearReviewWidget surfaces do, so no host can drive it into a hidden
// surface.
//
// [StatHeroData] mirrors the slice of the web `YearReview` interface this surface reads (snake_case wire
// names via @SerialName, every field defaulted) so the projection runs straight off the cached API JSON.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/StatHeroSlide — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statheroslide

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlin.math.roundToInt

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
private const val SURFACE_SLUG = "StatHeroSlide"

/** 1 km = 1000 m — the backend `total_distance_km` is SI km; the shared converter expects metres. */
private const val METERS_PER_KM = 1000.0

/** Web `🛣️` (distance), `⚡` (energy), `📊` (the unrecognised-field fallback). */
private const val DISTANCE_EMOJI = "\uD83D\uDEE3\uFE0F"
private const val ENERGY_EMOJI = "\u26A1"
private const val FALLBACK_EMOJI = "\uD83D\uDCCA"

/** Lenient decoder: the cached `/analytics/year-review` row carries more columns than this slide reads. */
private val lenientJson = Json { ignoreUnknownKeys = true }

/**
 * The slice of the web `YearReview` interface (web/src/api/types.ts) this slide reads: the SI total
 * distance (kilometres) and the total energy charged (kWh). Both keep their snake_case wire names via
 * @SerialName and default to zero so a partial / still-loading payload decodes without error, reproducing
 * the web optional reads.
 */
@Serializable
data class StatHeroData(
    @SerialName("total_distance_km") val totalDistanceKm: Double = 0.0,
    @SerialName("total_energy_kwh") val totalEnergyKwh: Double = 0.0,
)

/**
 * Which stat the slide renders — the native analogue of the web `field` string the `getStatConfig` switch
 * branches on. An absent / unrecognised value folds to [Unknown], reproducing the switch's `default` case
 * (the `📊` fallback), so the typed enum can never miss a branch.
 */
enum class StatHeroField {
    Distance,
    Energy,
    Unknown,
    ;

    companion object {
        /** Maps a raw `field` prop to its [StatHeroField]; anything but `distance`/`energy` folds to [Unknown]. */
        fun fromRaw(field: String?): StatHeroField =
            when (field) {
                "distance" -> Distance
                "energy" -> Energy
                else -> Unknown
            }
    }
}

/**
 * How the unit line is resolved at the Compose boundary — kept abstract here so the projection stays free
 * of any i18n / Android dependency. [Label] carries a literal unit string (the distance unit `km`/`mi`,
 * web `config.unit = distanceUnit`); [EnergyCharged] resolves the localized `yearReview.energyUnit` ("kWh
 * charged"); [None] renders nothing (web `default` branch `unit: ''`).
 */
sealed interface StatHeroUnit {
    data class Label(
        val text: String,
    ) : StatHeroUnit

    data object EnergyCharged : StatHeroUnit

    data object None : StatHeroUnit
}

/**
 * How the comparison line is resolved at the Compose boundary. [EarthLaps] carries the raw percentage
 * (web `earthLaps * 100`, formatted to one decimal then fed to `yearReview.distanceComparison`);
 * [EveryKilometerCounts] resolves `yearReview.distanceSmall`; [EnergyDays] carries the whole-day count
 * (web `Math.round(kwh / 30)`, fed to `yearReview.energyComparison`); [None] renders nothing (web `default`
 * branch `comparison: ''`).
 */
sealed interface StatHeroComparison {
    data class EarthLaps(
        val percent: Double,
    ) : StatHeroComparison

    data object EveryKilometerCounts : StatHeroComparison

    data class EnergyDays(
        val days: Int,
    ) : StatHeroComparison

    data object None : StatHeroComparison
}

/**
 * The fully projected, render-ready hero — the native analogue of the web `config` object `getStatConfig`
 * returns. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property field the resolved stat the slide shows.
 * @property emoji the large glyph (web `config.emoji`).
 * @property value the headline figure, already converted to the user's display unit where applicable
 *   (web `config.value`); fed to the animated count-up.
 * @property decimals the fraction digits the headline figure renders with (web `config.decimals`).
 * @property unit how the unit line is resolved (web `config.unit`).
 * @property comparison how the comparison line is resolved (web `config.comparison`).
 */
data class StatHeroConfig(
    val field: StatHeroField,
    val emoji: String,
    val value: Double,
    val decimals: Int,
    val unit: StatHeroUnit,
    val comparison: StatHeroComparison,
)

/**
 * Pure projection from the slide's inputs to its render-ready [StatHeroConfig] — a 1:1 port of the web
 * `getStatConfig(data, field, t, distanceUnit)` switch and its derivations. Stateless and side-effect-free
 * so it is fully covered by the off-device unit gate; the composable only resolves localized strings,
 * formats numbers, and draws what this returns.
 */
object StatHeroSlideProjection {
    /** Earth's equatorial circumference in km — the web `earthLaps = total_distance_km / 40075` divisor. */
    const val EARTH_CIRCUMFERENCE_KM: Double = 40_075.0

    /** Web `earthLaps >= 0.01`: below this the slide shows the "every kilometer counts" encouragement. */
    const val EARTH_LAPS_MIN: Double = 0.01

    /** Web `data.total_energy_kwh / 30`: 30 kWh ≈ one day of home energy use. */
    const val ENERGY_DAYS_DIVISOR: Double = 30.0

    /** Web `fmtNumber(earthLaps * 100, 1)` scale + precision for the around-the-Earth percentage. */
    const val PERCENT_SCALE: Double = 100.0
    const val EARTH_PERCENT_DECIMALS: Int = 1

    /** Web `decimals: 0` for both the distance and the energy headline figures. */
    const val DISTANCE_DECIMALS: Int = 0
    const val ENERGY_DECIMALS: Int = 0
    const val FALLBACK_DECIMALS: Int = 0

    /**
     * Selects the render-ready [StatHeroConfig] for [data] + [field], converting the distance figure to the
     * user's [distanceUnit] at this display boundary (web `useUnits`). The energy figure is already in the
     * slide's display unit (kWh) on the wire, so it passes through unconverted (web parity).
     */
    fun project(
        data: StatHeroData,
        field: StatHeroField,
        distanceUnit: DistanceUnitPref,
    ): StatHeroConfig =
        when (field) {
            StatHeroField.Distance -> distanceConfig(data, distanceUnit)
            StatHeroField.Energy -> energyConfig(data)
            StatHeroField.Unknown -> fallbackConfig()
        }

    private fun distanceConfig(
        data: StatHeroData,
        distanceUnit: DistanceUnitPref,
    ): StatHeroConfig {
        // Backend `total_distance_km` is SI km; convert via the metre floor the shared converter expects.
        val displayDistance = convertDistanceFromSI(data.totalDistanceKm * METERS_PER_KM, distanceUnit)
        val earthLaps = data.totalDistanceKm / EARTH_CIRCUMFERENCE_KM
        val comparison =
            if (earthLaps >= EARTH_LAPS_MIN) {
                StatHeroComparison.EarthLaps(earthLaps * PERCENT_SCALE)
            } else {
                StatHeroComparison.EveryKilometerCounts
            }
        return StatHeroConfig(
            field = StatHeroField.Distance,
            emoji = DISTANCE_EMOJI,
            value = displayDistance,
            decimals = DISTANCE_DECIMALS,
            unit = StatHeroUnit.Label(distanceUnit.label),
            comparison = comparison,
        )
    }

    private fun energyConfig(data: StatHeroData): StatHeroConfig =
        StatHeroConfig(
            field = StatHeroField.Energy,
            emoji = ENERGY_EMOJI,
            value = data.totalEnergyKwh,
            decimals = ENERGY_DECIMALS,
            unit = StatHeroUnit.EnergyCharged,
            comparison = StatHeroComparison.EnergyDays(daysToPowerHome(data.totalEnergyKwh)),
        )

    private fun fallbackConfig(): StatHeroConfig =
        StatHeroConfig(
            field = StatHeroField.Unknown,
            emoji = FALLBACK_EMOJI,
            value = 0.0,
            decimals = FALLBACK_DECIMALS,
            unit = StatHeroUnit.None,
            comparison = StatHeroComparison.None,
        )

    /**
     * The web `Math.round(data.total_energy_kwh / 30)` home-days estimate. Kotlin's [roundToInt] rounds
     * halves towards positive infinity, matching JavaScript's `Math.round` for these non-negative values.
     */
    fun daysToPowerHome(energyKwh: Double): Int = (energyKwh / ENERGY_DAYS_DIVISOR).roundToInt()

    /**
     * Maps the slide's `(data, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present [data] renders [UiPhase.Content], and an absent payload
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        data: StatHeroData?,
        isLoading: Boolean,
    ): UiState<StatHeroData> =
        when {
            isLoading -> UiState.loading()
            data != null -> UiState(phase = UiPhase.Content, data = data)
            else -> UiState(phase = UiPhase.Empty)
        }
}

/**
 * Decodes the raw `/analytics/year-review` [json] (SI, snake_case on the wire) into the slice this slide
 * reads, or `null` when the payload is absent — a non-object input or an empty object resolves to `null`,
 * reproducing the web truthiness gate where a disabled query / null response shows the empty surface while
 * any populated payload (even all-zero totals) renders the hero. Unknown columns are ignored.
 */
fun parseStatHero(json: JsonElement?): StatHeroData? {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return null
    return lenientJson.decodeFromJsonElement<StatHeroData>(obj)
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * distance, energy figure, or vehicle identity — so a diagnostics line can never leak a user's annual
 * totals.
 */
object StatHeroSlideDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SURFACE_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
