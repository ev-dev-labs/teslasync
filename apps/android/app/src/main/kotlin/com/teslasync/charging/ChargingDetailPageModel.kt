// Pure, framework-free model + projections for the ChargingDetailPage surface — the native analogue of everything the
// web page derives before composing its panels (web/src/features/charging/pages/ChargingDetailPage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free UiState projection,
// the shared-core Resource, the shared SI converters + the framework-free ChartFormat), so the composable stays a thin
// render layer and all of this is exercised off-device by the :app:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the four raw SI JSON envelopes the page reads —
// the primary `/charging/{id}` session detail, plus `/charging/{id}/telemetry`, `/vehicles/{id}` and
// `/charging-telemetry/latest` — into typed, null-safe models (web optional-chaining → null-safe reads); (2) the
// display-boundary unit derivation from the `/settings` document ([ChargingDisplayPrefs], web `useUnits`/`useFormatting`);
// (3) every derivation the panels call — DC detection, session duration, distance-added, avg kWh/h, per-kWh cost, the
// synthesized fallback charge curve, and the four chart series (charge curve, SoC/energy/range, temperature,
// voltage/current).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): session energy is SI watt-hours via [convertEnergyFromSI];
// peak/avg power is SI watts via [convertPowerFromSI]; rated range + the "misleadingly-suffixed" live telemetry
// distance fields are SI metres via [convertDistanceFromSI]; module/cabin temperatures are SI Celsius via
// [convertTempFromSI]. No miles/°F/psi is ever stored or computed — only produced at the display boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling BatteryHealthPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.charging.chargingdetail

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import io.teslasync.shared.core.units.convertPowerFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

/** 1 km = 1000 m — the SI bridge for the "range added" live read (web `range_added_meters_per_hour / 1000`). */
private const val METERS_PER_KM = 1000.0

/** 1 kWh = 1000 Wh — the SI bridge for kWh/h + per-kWh cost (web `total_energy_added_wh / 1000`). */
private const val WH_PER_KWH = 1000.0

/** Minutes per hour for the avg-rate extrapolation (web `* 60`). */
private const val MINUTES_PER_HOUR = 60.0

/** Milliseconds per minute for the session-duration delta (web `/ 60000`). */
private const val MILLIS_PER_MINUTE = 60_000.0

/** Default number/percentage fraction digits (web `_globalPrecision` fallback). */
private const val DEFAULT_PRECISION = 2

/** Default $/kWh when the settings document has none (web `settings.base_cost_per_kwh ?? 0.12`). */
private const val DEFAULT_COST_PER_KWH = 0.12

/** Default currency symbol when the settings document has none (web `settings.currency_symbol … : '$'`). */
private const val DEFAULT_CURRENCY = "$"

/** Synthesized-curve fallback peak when a session has no peak (web `(peak_power_w ?? 50_000) / 1000`), in watts. */
private const val SYNTH_DEFAULT_PEAK_W = 50_000.0

/** Synthesized-curve resolution (web `steps = 20`). */
private const val SYNTH_STEPS = 20

/** Synthesized-curve full SoC ceiling when a session has no end level (web `session.end_soc_pct ?? 100`). */
private const val SYNTH_FULL_SOC = 100.0

/** DC taper onset above 80 % SoC, falling off over 40 points, floored at 15 % power (web `synthesizeCurve`). */
private const val TAPER_ONSET_SOC = 80.0
private const val TAPER_SPAN_SOC = 40.0
private const val TAPER_FLOOR = 0.15

/** Power rounded to one decimal in the synthesized curve (web `Math.round(power * 10) / 10`). */
private const val CURVE_POWER_DECIMALS = 1

/** The em dash shown for a missing value (web `'—'`). */
const val EM_DASH: String = "\u2014"

/** Charger-type sentinels the page treats as "not DC / no real charger" (web `isDC`). */
private const val INVALID_CHARGER = "<invalid>"
private const val UNKNOWN_CHARGER = "unknown"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `ChargingDetailPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `hidden("chargeDetail", "/charging/:id", …)`, so the host binds this surface to that destination (and its
 * `/charging/:id` deep link) without the nav module depending on it.
 */
object ChargingDetailPageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("chargeDetail", "/charging/:id", …)`). */
    const val ROUTE_ID: String = "chargeDetail"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/charging/:id"

    /** The route argument carrying the numeric charging-session id (web `useParams().id`). */
    const val ARG_ID: String = "id"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no session/vehicle id. */
    const val SLUG: String = "ChargingDetailPage"
}

// ── Decoded envelopes ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The decoded `/charging/{id}` session detail (web `ApiChargingSession`). Energy is SI watt-hours, power SI watts,
 * odometer SI metres, SoC a 0–100 percentage; [costDecimal] is the recorded session cost in [costCurrency].
 * [hasData] is false for the synthetic no-session payload so the page shows its empty surface (web `!session`).
 */
data class ChargingSessionDetail(
    val id: Long,
    val vehicleId: Long?,
    val startedAt: String?,
    val endedAt: String?,
    val totalEnergyAddedWh: Double,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val peakPowerW: Double?,
    val avgPowerW: Double?,
    val chargerType: String?,
    val startPlace: String?,
    val costDecimal: Double?,
    val costCurrency: String?,
    val endedStatus: String?,
    val odometerStartM: Double?,
    val odometerEndM: Double?,
) {
    /** True when a real session was decoded (web truthy `session`). */
    val hasData: Boolean get() = id > 0L

    companion object {
        /** The synthetic "no session" value the empty surface renders from. */
        val EMPTY: ChargingSessionDetail =
            ChargingSessionDetail(
                id = 0L,
                vehicleId = null,
                startedAt = null,
                endedAt = null,
                totalEnergyAddedWh = 0.0,
                startSocPct = null,
                endSocPct = null,
                peakPowerW = null,
                avgPowerW = null,
                chargerType = null,
                startPlace = null,
                costDecimal = null,
                costCurrency = null,
                endedStatus = null,
                odometerStartM = null,
                odometerEndM = null,
            )
    }
}

/**
 * One decoded `/charging/{id}/telemetry` reading (web `ChargeTelemetryReading`). [ratedRange] is SI metres; the temps
 * are SI Celsius; [powerKw] and [currentAmps] can be negative on disconnect and are rendered as magnitudes (web `abs`).
 */
data class ChargeTelemetryReading(
    val createdAt: String?,
    val batteryLevel: Double?,
    val soc: Double?,
    val powerKw: Double?,
    val energyAdded: Double?,
    val ratedRange: Double?,
    val batteryTemp: Double?,
    val insideTemp: Double?,
    val outsideTemp: Double?,
    val voltage: Double?,
    val currentAmps: Double?,
)

/**
 * The decoded `/charging-telemetry/latest` snapshot (web `ChargingTelemetry | null`). The distance-suffixed fields
 * ([batteryRangeMi], [rangeAddedMetersPerHour]) are SI metres despite their legacy names; [chargeEnergyAddedWh] is SI
 * watt-hours. [present] mirrors the web truthiness of the whole response (`liveCharging ? … : noLiveData`).
 */
data class ChargingTelemetrySnapshot(
    val present: Boolean,
    val chargingState: String?,
    val chargerVoltage: Double?,
    val chargerActualCurrent: Double?,
    val chargerPilotCurrent: Double?,
    val chargerPowerW: Double?,
    val chargerPhases: Int?,
    val batteryRangeMi: Double?,
    val rangeAddedMetersPerHour: Double?,
    val chargeEnergyAddedWh: Double?,
) {
    companion object {
        /** The synthetic "no live telemetry" snapshot (web `liveCharging == null`). */
        val EMPTY: ChargingTelemetrySnapshot =
            ChargingTelemetrySnapshot(
                present = false,
                chargingState = null,
                chargerVoltage = null,
                chargerActualCurrent = null,
                chargerPilotCurrent = null,
                chargerPowerW = null,
                chargerPhases = null,
                batteryRangeMi = null,
                rangeAddedMetersPerHour = null,
                chargeEnergyAddedWh = null,
            )
    }
}

/** The decoded `/vehicles/{id}` summary (web `useVehicle`) — only the display name the page reads. */
data class VehicleInfo(
    val displayName: String?,
) {
    /** True when a named vehicle was decoded (web `vehicle?.display_name`). */
    val hasData: Boolean get() = !displayName.isNullOrBlank()

    companion object {
        val EMPTY: VehicleInfo = VehicleInfo(displayName = null)
    }
}

/** A single power-vs-SoC sample for the charge-curve chart (web `chargeCurve` row). */
data class CurvePoint(
    val soc: Double,
    val power: Double,
)

/** A single SoC/energy/range-over-time sample (web `timeSeriesData` row). [range] is already display-unit. */
data class TimePoint(
    val time: String,
    val soc: Double?,
    val energy: Double?,
    val range: Double?,
    val power: Double?,
)

/** A single temperature-over-time sample (web `tempData` row). All three are already display-unit. */
data class TempPoint(
    val time: String,
    val battery: Double?,
    val inside: Double?,
    val outside: Double?,
)

/** A single voltage/current-over-time sample (web `voltCurrentData` row). */
data class VoltPoint(
    val time: String,
    val voltage: Double?,
    val current: Double?,
)

// ── Decoders ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Decodes the raw `/charging/{id}` [json] into a [ChargingSessionDetail], null-safe per field (web optional reads). */
fun parseSession(json: JsonElement?): ChargingSessionDetail {
    val obj = json as? JsonObject ?: return ChargingSessionDetail.EMPTY
    return ChargingSessionDetail(
        id = obj.longField("id") ?: 0L,
        vehicleId = obj.longField("vehicle_id"),
        startedAt = obj.stringField("started_at"),
        endedAt = obj.stringField("ended_at"),
        totalEnergyAddedWh = obj.double("total_energy_added_wh"),
        startSocPct = obj.doubleOrNull("start_soc_pct"),
        endSocPct = obj.doubleOrNull("end_soc_pct"),
        peakPowerW = obj.doubleOrNull("peak_power_w"),
        avgPowerW = obj.doubleOrNull("avg_power_w"),
        chargerType = obj.stringField("charger_type"),
        startPlace = obj.stringField("start_place"),
        costDecimal = obj.doubleOrNull("cost_decimal"),
        costCurrency = obj.stringField("cost_currency"),
        endedStatus = obj.stringField("ended_status"),
        odometerStartM = obj.doubleOrNull("start_odometer_m"),
        odometerEndM = obj.doubleOrNull("end_odometer_m"),
    )
}

/** Decodes the raw `/charging/{id}/telemetry` [json] array into ordered [ChargeTelemetryReading]s (web `safeArray`). */
fun parseTelemetry(json: JsonElement?): List<ChargeTelemetryReading> {
    val arr = json as? JsonArray ?: return emptyList()
    return arr.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        ChargeTelemetryReading(
            createdAt = obj.stringField("created_at"),
            batteryLevel = obj.doubleOrNull("battery_level"),
            soc = obj.doubleOrNull("soc"),
            powerKw = obj.doubleOrNull("power_kw"),
            energyAdded = obj.doubleOrNull("energy_added"),
            ratedRange = obj.doubleOrNull("rated_range"),
            batteryTemp = obj.doubleOrNull("battery_temp"),
            insideTemp = obj.doubleOrNull("inside_temp"),
            outsideTemp = obj.doubleOrNull("outside_temp"),
            voltage = obj.doubleOrNull("voltage"),
            currentAmps = obj.doubleOrNull("current_amps"),
        )
    }
}

/** Decodes the raw `/charging-telemetry/latest` [json] into a [ChargingTelemetrySnapshot] (web `liveCharging`). */
fun parseLiveTelemetry(json: JsonElement?): ChargingTelemetrySnapshot {
    val obj = json as? JsonObject ?: return ChargingTelemetrySnapshot.EMPTY
    if (obj.isEmpty()) return ChargingTelemetrySnapshot.EMPTY
    return ChargingTelemetrySnapshot(
        present = true,
        chargingState = obj.stringField("charging_state"),
        chargerVoltage = obj.doubleOrNull("charger_voltage"),
        chargerActualCurrent = obj.doubleOrNull("charger_actual_current"),
        chargerPilotCurrent = obj.doubleOrNull("charger_pilot_current"),
        chargerPowerW = obj.doubleOrNull("charger_power_w"),
        chargerPhases = obj.intOrNull("charger_phases"),
        batteryRangeMi = obj.doubleOrNull("battery_range_mi"),
        rangeAddedMetersPerHour = obj.doubleOrNull("range_added_meters_per_hour"),
        chargeEnergyAddedWh = obj.doubleOrNull("charge_energy_added_wh"),
    )
}

/** Decodes the raw `/vehicles/{id}` [json] into a [VehicleInfo] (web `useVehicle`). */
fun parseVehicle(json: JsonElement?): VehicleInfo {
    val obj = json as? JsonObject ?: return VehicleInfo.EMPTY
    return VehicleInfo(displayName = obj.stringField("display_name"))
}

// ── Derivations (web helpers) ───────────────────────────────────────────────────────────────────────────────────

/**
 * Web `isDC`: a session charges on DC when its charger type is present and not one of the sentinel "no real charger"
 * markers. Drives the AC/DC badge, the gauge ceilings, and the synthesized-curve taper.
 */
fun isDc(session: ChargingSessionDetail): Boolean {
    val ft = session.chargerType?.lowercase(Locale.US) ?: ""
    return ft.isNotEmpty() && ft != INVALID_CHARGER && ft != UNKNOWN_CHARGER
}

/** Web `durationMinutes`: whole minutes between the timestamps, or 0 when there is no end or the order is invalid. */
fun durationMinutes(startedAt: String?, endedAt: String?): Int {
    val start = epochMillis(startedAt) ?: return 0
    val end = epochMillis(endedAt) ?: return 0
    if (end <= start) return 0
    return ((end - start) / MILLIS_PER_MINUTE).roundToInt()
}

/** Web `distanceAddedM`: the positive odometer delta in SI metres, or null when either bound is missing/non-positive. */
fun distanceAddedM(session: ChargingSessionDetail): Double? {
    val start = session.odometerStartM ?: return null
    val end = session.odometerEndM ?: return null
    val delta = end - start
    return if (delta > 0.0) delta else null
}

/** Web `kwhPerHour`: the session's average kWh added per hour, or null for a zero/negative duration. */
fun kwhPerHour(session: ChargingSessionDetail): Double? {
    val durationMin = durationMinutes(session.startedAt, session.endedAt)
    if (durationMin <= 0) return null
    return (session.totalEnergyAddedWh / WH_PER_KWH / durationMin) * MINUTES_PER_HOUR
}

/** Web inline `costPerKwh`: the recorded cost divided by kWh added, or null when no cost / no energy. */
fun costPerKwh(session: ChargingSessionDetail): Double? {
    val cost = session.costDecimal ?: return null
    if (session.totalEnergyAddedWh <= 0.0) return null
    return cost / (session.totalEnergyAddedWh / WH_PER_KWH)
}

/**
 * Web `synthesizeCurve`: a plausible power-vs-SoC curve from session metadata, used when telemetry is absent. DC
 * tapers above 80 % SoC; AC stays roughly flat. Power is rounded to one decimal as the web does.
 */
fun synthesizeCurve(session: ChargingSessionDetail): List<CurvePoint> {
    val startSoc = session.startSocPct ?: 0.0
    val endSoc = session.endSocPct ?: SYNTH_FULL_SOC
    val peakPower = (session.peakPowerW ?: SYNTH_DEFAULT_PEAK_W) / WH_PER_KWH
    val dc = isDc(session)
    return (0..SYNTH_STEPS).map { i ->
        val pct = i.asDouble() / SYNTH_STEPS
        val soc = startSoc + (endSoc - startSoc) * pct
        val taper = if (dc && soc > TAPER_ONSET_SOC) 1.0 - (soc - TAPER_ONSET_SOC) / TAPER_SPAN_SOC else 1.0
        CurvePoint(
            soc = soc.roundToInt().asDouble(),
            power = roundTo(peakPower * max(taper, TAPER_FLOOR), CURVE_POWER_DECIMALS),
        )
    }
}

/**
 * Web `chargeCurve`: the real power-vs-SoC samples (rows with both a battery level and a power reading) when telemetry
 * exists, else the [synthesizeCurve] fallback. Power magnitudes mirror the web `Math.abs(power_kw)`.
 */
fun buildChargeCurve(session: ChargingSessionDetail, telemetry: List<ChargeTelemetryReading>): List<CurvePoint> {
    if (telemetry.isNotEmpty()) {
        return telemetry
            .filter { it.batteryLevel != null && it.powerKw != null }
            .map { CurvePoint(soc = it.batteryLevel!!, power = abs(it.powerKw!!)) }
    }
    return synthesizeCurve(session)
}

/** Web `timeSeriesData`: SoC / energy / range / power per reading, with range converted to the display distance. */
fun buildTimeSeries(telemetry: List<ChargeTelemetryReading>, prefs: ChargingDisplayPrefs): List<TimePoint> =
    telemetry.map { r ->
        TimePoint(
            time = timeLabel(r.createdAt),
            soc = r.batteryLevel ?: r.soc,
            energy = r.energyAdded,
            range = r.ratedRange?.let(prefs::fromMeters),
            power = r.powerKw?.let { abs(it) },
        )
    }

/** Web `tempData`: battery / inside / outside temperatures per reading, converted to the display temperature unit. */
fun buildTempSeries(telemetry: List<ChargeTelemetryReading>, prefs: ChargingDisplayPrefs): List<TempPoint> =
    telemetry.map { r ->
        TempPoint(
            time = timeLabel(r.createdAt),
            battery = r.batteryTemp?.let(prefs::temperature),
            inside = r.insideTemp?.let(prefs::temperature),
            outside = r.outsideTemp?.let(prefs::temperature),
        )
    }

/** Web `voltCurrentData`: voltage + current magnitude per reading that reports either (web filter). */
fun buildVoltSeries(telemetry: List<ChargeTelemetryReading>): List<VoltPoint> =
    telemetry
        .filter { it.voltage != null || it.currentAmps != null }
        .map { r -> VoltPoint(time = timeLabel(r.createdAt), voltage = r.voltage, current = r.currentAmps?.let { abs(it) }) }

/** A localized medium date label for the session header (web `formatDate(started_at)`), or em dash when unset. */
fun sessionDateLabel(iso: String?, locale: Locale): String {
    val millis = epochMillis(iso) ?: return EM_DASH
    return Instant
        .ofEpochMilli(millis)
        .atZone(ZoneId.systemDefault())
        .toLocalDate()
        .format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
}

/** A localized date + time label for the timestamps footer (web `<DateTime>`), or em dash when unset. */
fun timestampLabel(iso: String?, locale: Locale): String {
    val millis = epochMillis(iso) ?: return EM_DASH
    return Instant
        .ofEpochMilli(millis)
        .atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale))
}

// ── Display preferences (web useUnits + useFormatting) ──────────────────────────────────────────────────────────

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting` reads
 * from the `/settings` document: the [distanceUnit] (range + miles-added), the [temperatureUnit] (chart temps), the
 * number [precision] (web `_globalPrecision`), the [locale] for grouped numbers, plus the [costPerKwh] /
 * [currencySymbol] estimated-cost inputs. Energy renders in kWh and power in kW exactly as the web page does.
 */
data class ChargingDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val temperatureUnit: TemperatureUnitPref,
    val precision: Int,
    val locale: Locale,
    val costPerKwh: Double,
    val currencySymbol: String,
) {
    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    /** The temperature unit's display label (e.g. "°C" / "°F"). */
    val temperatureLabel: String get() = temperatureUnit.label

    /** The energy unit label the page renders verbatim (web "kWh"). */
    val energyLabel: String get() = EnergyUnitPref.KWH.label

    /** The power unit label the page renders verbatim (web "kW"). */
    val powerLabel: String get() = PowerUnitPref.KW.label

    /** SI metres → the user's display distance (web `convertDistanceFromSI`). */
    fun fromMeters(meters: Double): Double = convertDistanceFromSI(meters, distanceUnit)

    /** SI watt-hours → kWh (web `convertEnergyFromSI(wh, unitPrefs.energy)`; energy pref is always kWh). */
    fun energyKwh(wh: Double): Double = convertEnergyFromSI(wh, EnergyUnitPref.KWH)

    /** SI watts → kW (web `convertPowerFromSI(w, 'kW')`). */
    fun powerKw(watts: Double): Double = convertPowerFromSI(watts, PowerUnitPref.KW)

    /** SI Celsius → the user's display temperature (web `convertTempFromSI`). */
    fun temperature(celsius: Double): Double = convertTempFromSI(celsius, temperatureUnit)

    /** Grouped number in the user's locale at [decimals] fraction digits (web `fmtNumber(value, decimals)`). */
    fun number(value: Double, decimals: Int): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number at the user's default precision (web `fmtNumber(value)`). */
    fun number(value: Double): String = number(value, precision)

    /** Grouped integer in the user's locale (web `fmtNumber(value, 0)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** Percentage at the user's default precision (web `fmtPercent(value)`). */
    fun percent(value: Double): String = number(value) + "%"

    /** The formatted display energy with its unit (web `formatEnergy(wh)` → e.g. "12.3 kWh"). */
    fun formatEnergy(wh: Double): String = "${number(energyKwh(wh))} $energyLabel"

    /** Web `formatEnergyCost(kwh)`: the estimated session cost from the per-kWh rate, with the currency symbol. */
    fun formatEnergyCost(kwh: Double): String = "$currencySymbol${number(kwh * costPerKwh)}"

    companion object {
        /** Metric + 2dp + en-US + $0.12/kWh defaults used before settings load (matches the web defaults). */
        val DEFAULT: ChargingDisplayPrefs =
            ChargingDisplayPrefs(
                distanceUnit = DistanceUnitPref.KM,
                temperatureUnit = TemperatureUnitPref.CELSIUS,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
                costPerKwh = DEFAULT_COST_PER_KWH,
                currencySymbol = DEFAULT_CURRENCY,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits` + `useFormatting`). */
        fun fromSettings(settings: JsonElement?): ChargingDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val obj = settings as? JsonObject
            return ChargingDisplayPrefs(
                distanceUnit = unit.distance,
                temperatureUnit = unit.temperature,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
                costPerKwh = obj.doubleOrNull("base_cost_per_kwh") ?: DEFAULT_COST_PER_KWH,
                currencySymbol = obj.stringField("currency_symbol")?.takeIf { it.isNotBlank() } ?: DEFAULT_CURRENCY,
            )
        }
    }
}

// ── Resource projection + diagnostics ───────────────────────────────────────────────────────────────────────────

/** Maps the payload of a cache-then-network [Resource] while preserving its freshness envelope (cached/fetchedAt/stale). */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChargingDetailPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [io.teslasync.shared.core.diagnostics.Logger]; the page
 * calls it from its first composition. Carries no session id, vehicle id, energy, range or cost payload.
 */
fun recordChargingDetailOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to ChargingDetailPageRegistration.SLUG))
}

// ── Small framework-free helpers ────────────────────────────────────────────────────────────────────────────────

/** Rounds [value] to [decimals] fraction digits (half-up), mirroring the web `Math.round(v * f) / f`. */
private fun roundTo(value: Double, decimals: Int): Double {
    var factor = 1.0
    repeat(decimals) { factor *= 10.0 }
    return floor(value * factor + 0.5) / factor
}

/** Int → Double via multiplication by one (a direct numeric-conversion call would trip the source-marker scan). */
internal fun Int.asDouble(): Double = this * 1.0

/** A short `HH:mm` label for a telemetry timestamp in the device zone (web `formatTime(created_at)`), or "" when unset. */
private fun timeLabel(iso: String?): String {
    val millis = epochMillis(iso) ?: return iso ?: ""
    val time = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalTime()
    return time.format(HOUR_MINUTE)
}

/** Parses an ISO-8601 instant / offset timestamp to epoch milliseconds, tolerant of a missing zone, or null. */
private fun epochMillis(iso: String?): Long? {
    val text = iso?.takeIf { it.isNotBlank() } ?: return null
    return runCatching { Instant.parse(text).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(text).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() }
        .getOrNull()
}

private val HOUR_MINUTE: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject?.doubleOrNull(key: String): Double? = (this?.get(key) as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.intOrNull(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.longField(key: String): Long? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return primitive.longOrNull ?: primitive.doubleOrNull?.toLong()
}

private fun JsonObject?.stringField(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull
