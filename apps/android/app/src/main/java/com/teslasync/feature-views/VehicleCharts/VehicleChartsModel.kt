// Pure, framework-free model + projection for the VehicleCharts feature view — the native analogue of every
// derivation the web component performs before it returns JSX
// (web/src/features/vehicles/components/VehicleCharts.tsx, plus the @/lib helpers it threads in: `cleanNil`,
// `parseSettingEnum`, `convertSpeedFromSI`, `formatTime`, `fmtNumber`). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// VehicleCharts is purely presentational. Its parent (the Vehicle-detail page) owns the state / positions /
// vehicle-config / user-preference queries and threads them in as props; this surface therefore binds NO data
// hook of its own. Its web hooks map natively as: `useTranslation` -> the generated i18n catalog (P1/S10,
// resolved into [VehicleChartsStrings] at the Compose boundary), and `useUnits` -> the live shared
// [io.teslasync.android.data.UnitFormatter] (the SI speed unit + decimal precision + locale applied at this
// projection boundary). As in the sibling RouteMapSection / TripReplayCharts ports, the cache-then-network
// lifecycle (loading / content / empty / stale / offline / error) is projected onto the shared
// [io.teslasync.android.data.UiState] so the owning page can thread every state through and the surface renders
// them all without ever fetching.
//
// Values stay SI on the wire (ADR-004 / Phase-48): [VehicleChartsPosition.speedMps] is the raw VehicleSpeed in
// metres-per-second (the web `position.speed_mph` field, whose stored content is SI despite the legacy column
// name), so the speed chart converts it to the user's display unit through `convertSpeedFromSI` at this
// boundary — never pre-converted into the snapshot. Coordinates are WGS-84 degrees and are never converted; the
// web `&&` truthiness that hides the map / a trail point for a `0` or absent coordinate is reproduced by
// [VehicleChartsProjection.isTruthyCoord] (so a `0` latitude never drags the map to the Gulf of Guinea).
//
// Two web-`lib` data utilities are ported here verbatim because they are data normalization, not UI copy, and
// are not i18n in the web either: [VehicleChartsProjection.cleanNil] (strips Go's `<nil>`/`nil`/`null` string
// sentinels) and [VehicleChartsProjection.parseSettingEnum] (maps Tesla's Fleet-Telemetry setting enums to
// their canonical display term). Their outputs are car-reported data, so they flow through unchanged exactly as
// the web `MetricCard value` does; every label and every boolean value word, by contrast, is resolved from the
// P1/S10 catalog into [VehicleChartsStrings] so the render layer carries no hardcoded English.
//
// Faithful-parity notes (documented so nothing drifts silently — the allowed-files scope forbids adding catalog
// keys, so a handful of web literals with no existing P1/S10 key are adapted to the nearest keyed term):
//   * the web `sunroof_installed || 'Not Installed'` null fallback becomes the universal em-dash (the same
//     fallback every other absent config cell already uses via the web `value || '—'`);
//   * the web `offroad_lightbar_present ? 'Present' : 'No'` renders as the keyed Yes / No pair;
//   * the web software-update labels ('SW Update'/'SW Download'/'SW Install') resolve to the keyed
//     "Software Update" / "Download" / "Install"; the preference labels resolve to the nearest keyed terms.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/VehicleCharts — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecharts

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.contracts.ExperimentalContracts
import kotlin.contracts.contract
import kotlin.math.roundToInt

/** Em dash rendered wherever a value is absent — the web `value || '—'` / `formatTime` fallback. */
internal const val VEHICLE_CHARTS_EM_DASH: String = "\u2014"

/** Web `<MapContainer zoom={14}>` for the live-location map. */
internal const val VEHICLE_CHARTS_MAP_ZOOM: Float = 14f

/**
 * One position sample threaded in from the parent (web `Position`). [latitude]/[longitude] are WGS-84 degrees;
 * [speedMps] is the raw SI VehicleSpeed (metres-per-second) the web reads as `speed_mph` and converts via
 * `convertSpeedFromSI`; [ts] is the ISO-8601 instant the web feeds to `formatTime` for the chart x-axis.
 */
data class VehicleChartsPosition(
    val ts: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val speedMps: Double? = null,
)

/**
 * The vehicle-configuration snapshot (web `VehicleConfigSnapshot`) the configuration grid renders. Every field
 * is car-reported data fed through [VehicleChartsProjection.cleanNil] / a boolean word at the projection
 * boundary, never pre-formatted into the snapshot.
 */
@Suppress("LongParameterList") // One field per web VehicleConfigSnapshot column the configuration grid renders.
data class VehicleChartsConfig(
    val carType: String? = null,
    val trim: String? = null,
    val exteriorColor: String? = null,
    val roofColor: String? = null,
    val wheelType: String? = null,
    val version: String? = null,
    val vehicleName: String? = null,
    val chargePort: String? = null,
    val rearSeatHeaters: String? = null,
    val efficiencyPackage: String? = null,
    val sunroofInstalled: String? = null,
    val europeVehicle: Boolean? = null,
    val rightHandDrive: Boolean? = null,
    val remoteStartEnabled: Boolean? = null,
    val offroadLightbarPresent: Boolean? = null,
    val softwareUpdateVersion: String? = null,
    val softwareUpdateDownloadPct: Double? = null,
    val softwareUpdateInstallPct: Double? = null,
)

/**
 * The user-preference snapshot (web `UserPreferenceSnapshot`) the "Car Display Preferences" grid renders — the
 * car's own display settings, each a Fleet-Telemetry setting enum [VehicleChartsProjection.parseSettingEnum]
 * normalizes (or a boolean word) at the projection boundary.
 */
data class VehicleChartsPreferences(
    val setting24hrTime: Boolean? = null,
    val settingChargeUnit: String? = null,
    val settingDistanceUnit: String? = null,
    val settingTemperatureUnit: String? = null,
    val settingTirePressureUnit: String? = null,
)

/**
 * The SI-canonical slice of vehicle state + telemetry this surface renders — the native union of the web
 * `VehicleCharts` props (`state`, `positions`, `vehicleConfigData`, `userPrefData`). The parent threads these in
 * once; nothing is pre-converted, so the speed chart applies the display unit at the projection boundary.
 *
 * @property latitude the live-state latitude (web `state.latitude`) — the map centre.
 * @property longitude the live-state longitude (web `state.longitude`) — the map centre.
 * @property positions the ordered (newest-first, web array order) position samples for the trail + speed chart.
 * @property config the vehicle-configuration snapshot, or null when the parent has none (web `vehicleConfigData`).
 * @property preferences the user-preference snapshot, or null when the parent has none (web `userPrefData`).
 */
data class VehicleChartsSnapshot(
    val latitude: Double? = null,
    val longitude: Double? = null,
    val positions: List<VehicleChartsPosition> = emptyList(),
    val config: VehicleChartsConfig? = null,
    val preferences: VehicleChartsPreferences? = null,
)

/**
 * The user's speed display preference this surface needs — the native port of the web `useUnits` read. Only the
 * [speed] unit (plus the [precision]/[locale] feeding the coordinate + axis number formatting) is relevant here;
 * the chart converts each sample through `convertSpeedFromSI(sample, speed)`.
 */
data class VehicleChartsDisplayPrefs(
    val speed: SpeedUnitPref,
    val precision: Int,
    val locale: Locale,
) {
    companion object {
        /** Web `useFormatting` `userPrecision` fallback before settings load. */
        const val DEFAULT_PRECISION: Int = 2

        /** The metric / 2-dp / en-US defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: VehicleChartsDisplayPrefs =
            VehicleChartsDisplayPrefs(SpeedUnitPref.KMH, DEFAULT_PRECISION, Locale.US)
    }
}

/** One label/value cell of a configuration or preference grid (web `<MetricCard label value />`). */
data class VehicleChartMetric(
    val label: String,
    val value: String,
)

/**
 * The localized strings this surface renders — resolved through the P1/S10 i18n facade at the Compose boundary
 * and passed in so the projection stays pure and JVM-testable. The four section titles + the empty/series copy
 * map 1:1 to the web `t('common.*')` calls; the grid labels + boolean value words resolve to the nearest
 * existing catalog keys (see the file header's faithful-parity notes).
 */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per localized label/word the view renders.
data class VehicleChartsStrings(
    val location: String,
    val vehicleConfig: String,
    val carPreferences: String,
    val speedHistory: String,
    val positionDataWillAppear: String,
    val speed: String,
    val model: String,
    val trim: String,
    val color: String,
    val roof: String,
    val wheels: String,
    val firmware: String,
    val name: String,
    val chargePort: String,
    val rearHeaters: String,
    val efficiency: String,
    val sunroof: String,
    val europeVehicle: String,
    val rhd: String,
    val remoteStart: String,
    val offroadLightbar: String,
    val swUpdate: String,
    val swDownload: String,
    val swInstall: String,
    val prefDistance: String,
    val prefTemperature: String,
    val prefChargeUnit: String,
    val prefTirePressure: String,
    val pref24hTime: String,
    val yes: String,
    val no: String,
    val active: String,
    val off: String,
    val none: String,
)

/**
 * The fully projected, render-ready view of the surface — the native analogue of everything the web component
 * derives before returning JSX (the live-map centre + trail + coordinate caption, the configuration + preference
 * grids, and the reversed speed series + its empty branch). Pure data (no Compose types) so it is unit-tested
 * without a UI host; the composable only resolves localized strings, maps colours to tokens, and draws this.
 *
 * @property hasLocation whether the live map renders (web `state.latitude && state.longitude`).
 * @property center the map centre coordinate, present only when [hasLocation].
 * @property trail the ordered map trail (web `positions.filter(lat && lng)`), drawn when it has 2+ points.
 * @property coordsText the monospace "lat, lng" caption under the map (web `fmtNumber` pair), or null.
 * @property hasConfig whether the configuration grid renders (web `vehicleConfigData != null`).
 * @property configItems the 18 configuration cells (web's `MetricCard` array), already localized.
 * @property hasPreferences whether the preferences grid renders (web `userPrefData != null`).
 * @property preferenceItems the 5 preference cells (web's `MetricCard` array), already localized.
 * @property hasSpeedData whether the speed chart renders vs its empty state (web `batteryData.length > 0`).
 * @property speedValues the reversed per-sample display speeds (web `batteryData[].speed`); null = a gap.
 * @property speedLabels the reversed per-sample time labels (web `batteryData[].time`).
 * @property speedSeriesName the chart series name (web `name={`Speed ${speedUnit}`}`).
 * @property speedUnitLabel the user's speed unit label (web `{speedUnit}`).
 * @property mapSummaryLines the screen-reader list alternative for the opaque map.
 */
@Suppress("LongParameterList") // A render-ready DTO: one field per region the web source renders.
data class VehicleChartsDisplay(
    val hasLocation: Boolean,
    val center: GeoPoint?,
    val trail: List<GeoPoint>,
    val coordsText: String?,
    val hasConfig: Boolean,
    val configItems: List<VehicleChartMetric>,
    val hasPreferences: Boolean,
    val preferenceItems: List<VehicleChartMetric>,
    val hasSpeedData: Boolean,
    val speedValues: List<Double?>,
    val speedLabels: List<String>,
    val speedSeriesName: String,
    val speedUnitLabel: String,
    val mapSummaryLines: List<String>,
)

/**
 * Pure projection from a [VehicleChartsSnapshot] (+ display prefs + localized strings) to its render-ready
 * [VehicleChartsDisplay] — a 1:1 port of the web component's derivations and the `@/lib` helpers it threads in.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object VehicleChartsProjection {
    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins (skeleton chrome), a present snapshot renders [UiPhase.Content] (the speed panel always draws, so a
     * snapshot is never structurally empty), and a null snapshot renders [UiPhase.Empty]. The host's stateful
     * binding can additionally carry refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: VehicleChartsSnapshot?,
        isLoading: Boolean,
    ): UiState<VehicleChartsSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * Project [snapshot] for [prefs] using [strings] — the native analogue of everything the web component
     * derives before returning JSX. [zone] anchors the chart's `formatTime` labels (the device zone by default,
     * pinned to UTC by the tests).
     */
    fun project(
        snapshot: VehicleChartsSnapshot,
        prefs: VehicleChartsDisplayPrefs,
        strings: VehicleChartsStrings,
        zone: ZoneId = ZoneId.systemDefault(),
    ): VehicleChartsDisplay {
        val center = centerOf(snapshot)
        val coordsText =
            center?.let { "${fmtNumber(it.lat, prefs.precision, prefs.locale)}, ${fmtNumber(it.lng, prefs.precision, prefs.locale)}" }

        val speedValues = snapshot.positions.map { p -> p.speedMps?.let { convertSpeedFromSI(it, prefs.speed) } }.reversed()
        val speedLabels = snapshot.positions.map { formatTime(it.ts, prefs.locale, zone) }.reversed()

        return VehicleChartsDisplay(
            hasLocation = center != null,
            center = center,
            trail = trailOf(snapshot),
            coordsText = coordsText,
            hasConfig = snapshot.config != null,
            configItems = snapshot.config?.let { configItems(it, strings) } ?: emptyList(),
            hasPreferences = snapshot.preferences != null,
            preferenceItems = snapshot.preferences?.let { preferenceItems(it, strings) } ?: emptyList(),
            hasSpeedData = snapshot.positions.isNotEmpty(),
            speedValues = speedValues,
            speedLabels = speedLabels,
            speedSeriesName = "${strings.speed} ${prefs.speed.label}",
            speedUnitLabel = prefs.speed.label,
            mapSummaryLines = coordsText?.let { listOf("${strings.location}: $it") } ?: emptyList(),
        )
    }

    /** The live-map centre — the web `state.latitude && state.longitude` gate (a `0`/absent coordinate hides it). */
    private fun centerOf(snapshot: VehicleChartsSnapshot): GeoPoint? {
        val lat = snapshot.latitude
        val lng = snapshot.longitude
        return if (isTruthyCoord(lat) && isTruthyCoord(lng)) GeoPoint(lat, lng) else null
    }

    /** The map trail — the web `positions.filter(p => p.latitude && p.longitude).map([lat, lng])`. */
    private fun trailOf(snapshot: VehicleChartsSnapshot): List<GeoPoint> =
        snapshot.positions.mapNotNull { p ->
            val plat = p.latitude
            val plng = p.longitude
            if (isTruthyCoord(plat) && isTruthyCoord(plng)) GeoPoint(plat, plng) else null
        }

    /** The 18 configuration cells, in the web `MetricCard` array order. */
    private fun configItems(
        config: VehicleChartsConfig,
        s: VehicleChartsStrings,
    ): List<VehicleChartMetric> =
        listOf(
            VehicleChartMetric(s.model, cleanNil(config.carType) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.trim, cleanNil(config.trim) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.color, cleanNil(config.exteriorColor) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.roof, cleanNil(config.roofColor) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.wheels, cleanNil(config.wheelType) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.firmware, cleanNil(config.version) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.name, cleanNil(config.vehicleName) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.chargePort, cleanNil(config.chargePort) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.rearHeaters, cleanNil(config.rearSeatHeaters) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.efficiency, cleanNil(config.efficiencyPackage) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.sunroof, cleanNil(config.sunroofInstalled) ?: VEHICLE_CHARTS_EM_DASH),
            VehicleChartMetric(s.europeVehicle, boolWord(config.europeVehicle, s.yes, s.no)),
            VehicleChartMetric(s.rhd, boolWord(config.rightHandDrive, s.yes, s.no)),
            VehicleChartMetric(s.remoteStart, boolWord(config.remoteStartEnabled, s.active, s.off)),
            VehicleChartMetric(s.offroadLightbar, boolWord(config.offroadLightbarPresent, s.yes, s.no)),
            VehicleChartMetric(s.swUpdate, cleanNil(config.softwareUpdateVersion) ?: s.none),
            VehicleChartMetric(s.swDownload, pctText(config.softwareUpdateDownloadPct)),
            VehicleChartMetric(s.swInstall, pctText(config.softwareUpdateInstallPct)),
        )

    /** The 5 preference cells, in the web `MetricCard` array order. */
    private fun preferenceItems(
        prefs: VehicleChartsPreferences,
        s: VehicleChartsStrings,
    ): List<VehicleChartMetric> =
        listOf(
            VehicleChartMetric(s.prefDistance, parseSettingEnum(prefs.settingDistanceUnit, SettingCategory.Distance)),
            VehicleChartMetric(s.prefTemperature, parseSettingEnum(prefs.settingTemperatureUnit, SettingCategory.Temperature)),
            VehicleChartMetric(s.prefChargeUnit, parseSettingEnum(prefs.settingChargeUnit, SettingCategory.Charge)),
            VehicleChartMetric(s.prefTirePressure, parseSettingEnum(prefs.settingTirePressureUnit, SettingCategory.Pressure)),
            VehicleChartMetric(s.pref24hTime, boolWord(prefs.setting24hrTime, s.yes, s.no)),
        )

    /**
     * True when [v] is a finite, non-zero coordinate — the web `&&` truthiness that hides a `0`/absent value. The
     * contract lets a `true` result smart-cast [v] to non-null at the call site so the projection stays branch-light.
     */
    @OptIn(ExperimentalContracts::class)
    fun isTruthyCoord(v: Double?): Boolean {
        contract { returns(true) implies (v != null) }
        return v != null && v.isFinite() && v != 0.0
    }

    /** The Go nil string sentinels the web `cleanNil` strips (web/src/lib/cleanNil.ts). */
    private val GO_NIL_SENTINELS: Set<String> = setOf("<nil>", "nil", "null")

    /**
     * Strips Go's nil string sentinels — the exact port of the web `cleanNil`
     * (web/src/lib/cleanNil.ts): a blank value or the literal `<nil>` / `nil` / `null` becomes null.
     */
    fun cleanNil(v: String?): String? = if (v.isNullOrBlank() || v in GO_NIL_SENTINELS) null else v

    /** The setting-enum categories the web `parseSettingEnum` keys on. */
    enum class SettingCategory { Distance, Temperature, Charge, Pressure }

    /**
     * Maps a Tesla Fleet-Telemetry setting enum to its canonical display term — the exact port of the web
     * `parseSettingEnum` (web/src/lib/parseSettingEnum.ts): lowercase + strip non-`a-z`, look the result up in
     * the [category] table, else return the original [value]; a blank value yields the em-dash. These are
     * car-reported data terms (not i18n in the web either), so they flow through unchanged like the web value.
     */
    fun parseSettingEnum(
        value: String?,
        category: SettingCategory,
    ): String {
        if (value.isNullOrBlank()) return VEHICLE_CHARTS_EM_DASH
        val key = value.lowercase(Locale.ROOT).filter { it in 'a'..'z' }
        return enumTable(category)[key] ?: value
    }

    private fun enumTable(category: SettingCategory): Map<String, String> =
        when (category) {
            SettingCategory.Distance ->
                mapOf(
                    "distanceunitmiles" to "Miles",
                    "distanceunitkilometers" to "Kilometers",
                    "distanceunitkm" to "Kilometers",
                    "miles" to "Miles",
                    "mi" to "Miles",
                    "km" to "Kilometers",
                    "kilometers" to "Kilometers",
                )
            SettingCategory.Temperature ->
                mapOf(
                    "temperatureunitcelsius" to "Celsius",
                    "temperatureunitfahrenheit" to "Fahrenheit",
                    "celsius" to "Celsius",
                    "fahrenheit" to "Fahrenheit",
                    "c" to "Celsius",
                    "f" to "Fahrenheit",
                )
            SettingCategory.Charge ->
                mapOf(
                    "chargeunitpercent" to "Percent",
                    "chargeunitmiles" to "Miles",
                    "chargeunitkilometers" to "Kilometers",
                    "percent" to "Percent",
                    "mi" to "Miles",
                    "km" to "Kilometers",
                )
            SettingCategory.Pressure ->
                mapOf(
                    "pressureunitpsi" to "PSI",
                    "pressureunitbar" to "Bar",
                    "pressureunitkpa" to "kPa",
                    "psi" to "PSI",
                    "bar" to "Bar",
                    "kpa" to "kPa",
                )
        }

    /** A nullable boolean as its [whenTrue]/[whenFalse] word, or the em-dash for null (web `!= null ? … : '—'`). */
    private fun boolWord(
        value: Boolean?,
        whenTrue: String,
        whenFalse: String,
    ): String =
        when (value) {
            true -> whenTrue
            false -> whenFalse
            null -> VEHICLE_CHARTS_EM_DASH
        }

    /** A nullable percentage as `"N%"` (web `${pct}%`), or the em-dash for null. */
    private fun pctText(pct: Double?): String = if (pct == null) VEHICLE_CHARTS_EM_DASH else "${pct.roundToInt()}%"

    /**
     * Localized short time-of-day for the chart x-axis — the port of the web `formatTime(position.ts)`. A blank
     * or unparseable timestamp yields the em-dash (web `formatTime` `'—'` fallback).
     */
    fun formatTime(
        ts: String?,
        locale: Locale,
        zone: ZoneId,
    ): String {
        val instant = ts?.takeIf { it.isNotBlank() }?.let { parseInstant(it) } ?: return VEHICLE_CHARTS_EM_DASH
        return runCatching {
            DateTimeFormatter
                .ofLocalizedTime(FormatStyle.SHORT)
                .withLocale(locale)
                .withZone(zone)
                .format(instant)
        }.getOrDefault(VEHICLE_CHARTS_EM_DASH)
    }

    private fun parseInstant(ts: String): Instant? =
        runCatching { OffsetDateTime.parse(ts).toInstant() }
            .recoverCatching { Instant.parse(ts) }
            .getOrNull()

    /**
     * Formats a coordinate component at [precision] decimals in [locale] — the port of the web `fmtNumber`
     * (grouping on, fixed min/max fraction digits, locale-aware separators).
     */
    fun fmtNumber(
        value: Double,
        precision: Int,
        locale: Locale,
    ): String {
        val digits = precision.coerceAtLeast(0)
        val format =
            DecimalFormat("#,##0", DecimalFormatSymbols(locale)).apply {
                minimumFractionDigits = digits
                maximumFractionDigits = digits
                roundingMode = RoundingMode.HALF_UP
            }
        return format.format(value)
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a coordinate,
 * vin, or timestamp — so a diagnostics line can never leak where a user is or what they drive.
 */
object VehicleChartsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "VehicleCharts"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
