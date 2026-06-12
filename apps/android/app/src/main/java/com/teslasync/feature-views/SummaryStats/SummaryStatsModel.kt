// Pure, framework-free model + projection for the SummaryStats feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/driving-dynamics/SummaryStats.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// SummaryStats is a presentational surface — the web component takes `motorStats: MotorStats | null` plus a
// `toTemperatureDisplay` converter and a `tempUnit` suffix as props from the owning DrivingDynamicsPage
// (which owns the motor-history query and computes the cross-section stats via `computeMotorStats`), and
// reads one context hook for labels: `useTranslation` (P1/S10). It renders six StatCards in a responsive
// 2 / 3 / 6-column grid: Total Readings, Avg Torque, Peak Power, Peak Regen, Avg Power, Avg Motor Temp.
//
// Following the sibling CostSummaryCards / DriveStatCards card-grid ports, the owning page threads the
// computed stats in through the shared cache-then-network state-holder layer (P1/S8) as a [UiState]; the
// [projectUiState] adapter lets the composable render every lifecycle state that layer can carry — a loading
// skeleton grid, a hard error with retry, a friendly empty state (the web `motorStats === null` no-readings
// case), content, and stale/offline "last known" — without ever fetching. The web component's defensive
// `?? 0` / `: '—'` defaults exist precisely because its parent may pass `null` while the motor history loads;
// the native architecture expresses that same "no data yet / no readings" condition as the explicit
// Loading / Empty lifecycle phases at the state-holder boundary, so the resolved content branch always
// renders real figures.
//
// Number formatting goes through the golden-pinned shared [ChartFormat.number], the native mirror of the web
// `fmtNumber` (including the web `safeNumber` non-finite → 0 guard). The "Nm" / "kW" unit suffixes carry NO
// i18n key on any platform — the web hard-codes them as inline literals — so, exactly as the sibling
// CostSummaryCards port composes its "kWh" / "gal equiv" suffixes from documented web-parity constants, they
// are reproduced verbatim here, never an ad-hoc English string in the view. Power/torque arrive already in
// kW / Nm (the web `MotorStats` is computed from the `power_kw` / `regen_kw` / `torque_nm_*` snapshot fields);
// only the motor temperature is SI Celsius and is converted at the display boundary via the shared
// `convertTempFromSI`, mirroring the web `toTemperatureDisplay`. The Total Readings tile renders its count
// the way the web renders a numeric React child — a bare, locale-independent string with no grouping —
// deliberately asymmetric with the grouped `fmtNumber` figures, faithfully reproducing the web source.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SummaryStats — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.summarystats

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonElement
import java.util.Locale

// ── Web-parity constants ────────────────────────────────────────────────────────────────────────────

/** Web `fmtNumber(value, 1)` precision for the torque / power / regen / temperature tiles (one decimal). */
private const val STAT_DECIMALS = 1

/** Torque unit suffix the web source hard-codes (`${fmtNumber(avgTorque, 1)} Nm`), not converted. */
private const val TORQUE_UNIT = "Nm"

/** Power unit suffix the web source hard-codes (`${fmtNumber(peakPower, 1)} kW`), not converted. */
private const val POWER_UNIT = "kW"

/** BCP-47 fallback driving number grouping/separators (web `fmtNumber` global locale cold-start default). */
private const val DEFAULT_LOCALE_TAG = "en-US"

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The six `MotorStats` fields the web SummaryStats reads off its `motorStats` prop — the subset of the larger
 * web `MotorStats` type (web/src/features/driving/components/driving-dynamics/helpers.ts) that THIS surface
 * renders. The owning page computes them with `computeMotorStats`; all are doubles mirroring the web `number`
 * shape, except [totalReadings] which is the integer reading count (web `motorStats.totalReadings`).
 *
 * Units mirror the web computation exactly: [avgTorque] is in newton-metres and [peakPower] / [peakRegen] /
 * [avgPower] are in kilowatts (the web `MotorStats` is built from the `torque_nm_*` / `power_kw` / `regen_kw`
 * snapshot fields, so they are already display-domain figures the surface labels with " Nm" / " kW"), while
 * [avgMotorTemp] is SI degrees Celsius (the `motor_temp_c_*` average) converted at the display boundary.
 *
 * @property totalReadings number of motor-history readings summarized (web `motorStats.totalReadings`).
 * @property avgTorque mean combined axle torque, Nm (web `motorStats.avgTorque`).
 * @property peakPower maximum drive power, kW (web `motorStats.peakPower`).
 * @property peakRegen maximum regen power, kW (web `motorStats.peakRegen`).
 * @property avgPower mean drive power, kW (web `motorStats.avgPower`).
 * @property avgMotorTemp mean motor temperature, SI °C (web `motorStats.avgMotorTemp`, converted at render).
 */
data class MotorSummaryStats(
    val totalReadings: Int,
    val avgTorque: Double,
    val peakPower: Double,
    val peakRegen: Double,
    val avgPower: Double,
    val avgMotorTemp: Double,
)

// ── Render-ready projection types ────────────────────────────────────────────────────────────────────

/**
 * Which authored lucide glyph a tile carries (web `icon` prop), resolved to an `ImageVector` in the
 * composable. Mirrors the web source's six `lucide-react` icons in tile order.
 */
enum class SummaryStatIcon { BarChart3, Zap, CornerDownRight, TrendingDown, Gauge, Thermometer }

/**
 * One fully resolved StatCard tile — the native analogue of a single web `<StatCard>` invocation. Pure data
 * (no Compose types) so the whole projection is asserted off-device. The [label] is already localized
 * (resolved from the i18n catalog at the Compose boundary and handed in via [SummaryStatsStrings]); the
 * [value] is the fully formatted primary value with its unit/suffix included (web `value`).
 *
 * @property label the localized tile label (web `t('dynamics.*')`).
 * @property value the formatted primary value, unit suffix included (web `value`).
 * @property icon the glyph slot (web `icon`).
 */
data class SummaryStatCard(
    val label: String,
    val value: String,
    val icon: SummaryStatIcon,
)

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready cards carry no English literal. Keys map 1:1 to the web `t('dynamics.*')` calls.
 */
data class SummaryStatsStrings(
    val totalReadings: String,
    val avgTorque: String,
    val peakPower: String,
    val peakRegen: String,
    val avgPower: String,
    val avgMotorTemp: String,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the
 * web `tempUnit` (the user's temperature unit suffix) and the `fmtNumber` global locale. Both derive from the
 * single settings document, mirroring the web page's `useUnits()` hook which feeds `toTemperatureDisplay`
 * (`convertTempFromSI(value, unitPrefs.temperature)`) and `tempUnit` (`unitPrefs.temperature`).
 *
 * @property temperature the user's temperature unit — selects both the [convertTempFromSI] target and the
 *   `°C` / `°F` suffix the web `tempUnit` prop already carries (web `unitPrefs.temperature`).
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 */
data class SummaryStatsDisplayPrefs(
    val temperature: TemperatureUnitPref,
    val locale: Locale,
) {
    companion object {
        /** The Celsius + en-US defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: SummaryStatsDisplayPrefs = from(null)

        /** Resolves the temperature unit + locale from one `/settings` document (web `useUnits` derivation). */
        fun from(settings: JsonElement?): SummaryStatsDisplayPrefs {
            val unitPref = UnitPreferences.fromSettings(settings)
            return SummaryStatsDisplayPrefs(
                temperature = unitPref.temperature,
                locale = Locale.forLanguageTag(unitPref.locale?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG),
            )
        }
    }
}

// ── Projection ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from the surface's prop + display preferences to its render-ready cards — a 1:1 port of the
 * derivations the web component performs. The composable resolves [SummaryStatsStrings] and
 * [SummaryStatsDisplayPrefs] from the i18n catalog and the live settings, then hands them here.
 */
object SummaryStatsProjection {
    /**
     * Maps the host's `(stats, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading wins
     * outright (skeleton chrome), present stats render [UiPhase.Content], and absent stats render
     * [UiPhase.Empty] — the native expression of the web `motorStats === null` case (`computeMotorStats`
     * returns `null` when there is no motor history). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error, which the composable renders too.
     */
    fun projectUiState(
        stats: MotorSummaryStats?,
        isLoading: Boolean,
    ): UiState<MotorSummaryStats> =
        when {
            isLoading -> UiState.loading()
            stats != null -> UiState(phase = UiPhase.Content, data = stats)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The six StatCard tiles in web source order. Each value reproduces the matching web expression — the
     * bare [formatReadings] count, the `${fmtNumber(v, 1)} Nm` torque, the three `${fmtNumber(v, 1)} kW`
     * power/regen tiles, and the `${fmtNumber(toTemperatureDisplay(avgMotorTemp), 1)}${tempUnit}` temperature
     * — formatted for [prefs] (locale grouping + the user's temperature unit), with the verbatim icon the web
     * hard-codes per tile.
     */
    fun cards(
        stats: MotorSummaryStats,
        prefs: SummaryStatsDisplayPrefs,
        strings: SummaryStatsStrings,
    ): List<SummaryStatCard> {
        val locale = prefs.locale
        return listOf(
            SummaryStatCard(
                label = strings.totalReadings,
                value = formatReadings(stats.totalReadings),
                icon = SummaryStatIcon.BarChart3,
            ),
            SummaryStatCard(
                label = strings.avgTorque,
                value = withUnit(stats.avgTorque, TORQUE_UNIT, locale),
                icon = SummaryStatIcon.Zap,
            ),
            SummaryStatCard(
                label = strings.peakPower,
                value = withUnit(stats.peakPower, POWER_UNIT, locale),
                icon = SummaryStatIcon.CornerDownRight,
            ),
            SummaryStatCard(
                label = strings.peakRegen,
                value = withUnit(stats.peakRegen, POWER_UNIT, locale),
                icon = SummaryStatIcon.TrendingDown,
            ),
            SummaryStatCard(
                label = strings.avgPower,
                value = withUnit(stats.avgPower, POWER_UNIT, locale),
                icon = SummaryStatIcon.Gauge,
            ),
            SummaryStatCard(
                label = strings.avgMotorTemp,
                value = formatTemperature(stats.avgMotorTemp, prefs),
                icon = SummaryStatIcon.Thermometer,
            ),
        )
    }

    /**
     * The Total Readings value — the web `value={motorStats?.totalReadings ?? 0}`, which React renders as a
     * bare numeric child (e.g. `3451`, never grouped, locale-independent). Note the deliberate asymmetry with
     * the other tiles, which go through `fmtNumber` and so gain locale grouping; this faithfully reproduces
     * the web source rather than silently "fixing" it.
     */
    fun formatReadings(value: Int): String = value.toString()

    /**
     * The Avg Motor Temp value — the web `${fmtNumber(toTemperatureDisplay(avgMotorTemp), 1)}${tempUnit}`:
     * the SI Celsius average is converted to the user's unit via the shared [convertTempFromSI] (the native
     * `toTemperatureDisplay`), formatted at one decimal with locale grouping and the web `safeNumber`
     * non-finite → 0 guard, then suffixed with the unit's `°C` / `°F` label (the web `tempUnit`, which already
     * carries the degree sign — no extra `°` is prefixed, the regression the web unit test pins). There is no
     * space between the number and the degree unit, matching the web template.
     */
    fun formatTemperature(
        celsius: Double,
        prefs: SummaryStatsDisplayPrefs,
    ): String = fmt(convertTempFromSI(celsius, prefs.temperature), STAT_DECIMALS, prefs.locale) + prefs.temperature.label

    /** A grouped number with a trailing [unit] (web `${fmtNumber(value, 1)} ${unit}`). */
    private fun withUnit(
        value: Double,
        unit: String,
        locale: Locale,
    ): String = fmt(value, STAT_DECIMALS, locale) + " " + unit

    /**
     * A grouped number at [decimals] fraction digits — the web `fmtNumber`, including its `safeNumber` guard
     * (a non-finite value renders as 0 rather than the [ChartFormat] em-dash, matching the web output).
     */
    private fun fmt(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(if (value.isFinite()) value else 0.0, decimals.coerceAtLeast(0), locale)
}

// ── Diagnostics (P1/S11) ───────────────────────────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a reading
 * count, torque, power, regen, or temperature figure — so a diagnostics line can never leak the vehicle's
 * motor telemetry.
 */
object SummaryStatsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SummaryStats"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
