// Pure, framework-free model + projections for the DrivingDynamicsPage driving surface — the native analogue of
// everything the web page derives before composing its panels
// (web/src/features/driving/pages/DrivingDynamicsPage.tsx). No Compose, no Android UI, no HTTP: every
// declaration here is plain Kotlin (it references only the shared-core DTOs/Resource and the sibling feature-view
// input shapes), so the composable stays a thin render layer and this is all exercised off-device.
//
// The web page owns four concerns this file ports: (1) the decode of the three raw SI JSON envelopes the page
// reads — the `/motor/latest` snapshot, the `/motor` history array and the `/drive-dynamics/latest` snapshot —
// into the typed feature-view inputs (MotorLive / MotorShift / DriveDynamicsLive); (2) the cross-section motor
// statistics the web `computeMotorStats(motorHistory)` derives once and threads into three panels
// (MotorEfficiencyInsights, SummaryStats, DrivingTips), reproduced verbatim by [computeMotorStats]; (3) the
// per-feature-view drive fan-out — the SAME `Drive` list is mapped into the SpeedGearPanel's speed samples
// (date-filtered to the web 30-day default) and the DriveAnalyticsSection's drives; and (4) the driving-coach
// payload decode for DrivingCoachSection.
//
// SI boundary (unit-conversion instructions): the page performs NO unit conversion here — distances stay in
// meters, speeds in m/s, power in kW and temperatures in SI °C exactly as the API serves them; every feature
// view converts at its own display boundary via the shared converters. The motor power/regen figures are the
// backend-derived kW the web reads verbatim (`power_kw` / `regen_kw`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.drivingdynamics

import io.teslasync.android.featureviews.driveanalyticssection.DriveAnalyticsDrive
import io.teslasync.android.featureviews.drivingcoachsection.DrivingCoachData
import io.teslasync.android.featureviews.drivingtips.MotorStats as TipsMotorStats
import io.teslasync.android.featureviews.drivingtips.ThrottleStyle as TipsThrottleStyle
import io.teslasync.android.featureviews.livemotorstatus.MotorLive
import io.teslasync.android.featureviews.motorefficiencyinsights.MotorStats as EfficiencyMotorStats
import io.teslasync.android.featureviews.motorefficiencyinsights.ThrottleStyle as EfficiencyThrottleStyle
import io.teslasync.android.featureviews.motorhistorycharts.MotorHistorySample
import io.teslasync.android.featureviews.pedalusage.DriveDynamicsLive
import io.teslasync.android.featureviews.speedgearpanel.DriveSpeedSample
import io.teslasync.android.featureviews.speedgearpanel.MotorShift
import io.teslasync.android.featureviews.summarystats.MotorSummaryStats
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `DrivingDynamicsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("drivingDynamics", "/driving-dynamics", …)`, so the host binds this surface to that destination (and its
 * `/driving-dynamics` deep link) without the nav module depending on it.
 */
object DrivingDynamicsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("drivingDynamics", "/driving-dynamics", …)`). */
    const val ROUTE_ID: String = "drivingDynamics"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/driving-dynamics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "DrivingDynamicsPage"

    /** The web `useMotorHistory(vehicleId, 200)` window the page reads. */
    const val MOTOR_HISTORY_LIMIT: Int = 200

    /** The trailing-day window the SpeedGearPanel's drive aggregate uses (web page's default `startDate` = today-30). */
    const val DRIVE_WINDOW_DAYS: Long = 30
}

// ── Raw /motor sample (the web `MotorSnapshot` slice computeMotorStats + the charts read) ──────────────────────

/**
 * One decoded `/motor` history sample — the union of the fields the web page reads from each `MotorSnapshot`
 * (web/src/api/types.ts): the timestamp, drive/regen power (kW, backend-derived), the two axle torques (Nm),
 * the two axle speeds (rpm) and the two motor temperatures (SI °C). Every field is nullable because the backend
 * omits a reading whenever the underlying telemetry has not reported, exactly as the web reads each with `??`.
 */
data class MotorSnapshotRow(
    val ts: String?,
    val powerKw: Double?,
    val regenKw: Double?,
    val torqueFront: Double?,
    val torqueRear: Double?,
    val rpmFront: Double?,
    val rpmRear: Double?,
    val motorTempCFront: Double?,
    val motorTempCRear: Double?,
)

// ── Canonical motor statistics (web `computeMotorStats`) ───────────────────────────────────────────────────────

/** Average drive power (kW) below which the web `getThrottleStyle` classifies the style as conservative. */
private const val THROTTLE_CONSERVATIVE_MAX_KW: Double = 20.0

/** Average drive power (kW) at or above which the web `getThrottleStyle` classifies the style as aggressive. */
private const val THROTTLE_AGGRESSIVE_MIN_KW: Double = 80.0

/**
 * The cross-section motor statistics the web `computeMotorStats(motorHistory)` derives once and threads into the
 * MotorEfficiencyInsights, SummaryStats and DrivingTips panels — a 1:1 port of the web `MotorStats` interface
 * (driving-dynamics/helpers.ts). Each consuming feature view declares its own narrower slice, so this canonical
 * holder adapts onto each via [toEfficiencyStats] / [toSummaryStats] / [toTipsStats].
 */
data class CanonicalMotorStats(
    val totalReadings: Int,
    val avgTorque: Double,
    val maxTorque: Double,
    val avgMotorTemp: Double,
    val maxMotorTemp: Double,
    val avgPower: Double,
    val peakPower: Double,
    val minPower: Double,
    val peakRegen: Double,
    val highTorquePct: Double,
) {
    /** The six-field slice the MotorEfficiencyInsights panel reads. */
    fun toEfficiencyStats(): EfficiencyMotorStats =
        EfficiencyMotorStats(
            avgTorque = avgTorque,
            maxTorque = maxTorque,
            highTorquePct = highTorquePct,
            avgPower = avgPower,
            avgMotorTemp = avgMotorTemp,
            maxMotorTemp = maxMotorTemp,
        )

    /** The six-tile slice the SummaryStats panel reads. */
    fun toSummaryStats(): MotorSummaryStats =
        MotorSummaryStats(
            totalReadings = totalReadings,
            avgTorque = avgTorque,
            peakPower = peakPower,
            peakRegen = peakRegen,
            avgPower = avgPower,
            avgMotorTemp = avgMotorTemp,
        )

    /** The two-field slice the DrivingTips coaching list reads. */
    fun toTipsStats(): TipsMotorStats = TipsMotorStats(avgPower = avgPower, maxMotorTemp = maxMotorTemp)

    /** The driving style the MotorEfficiencyInsights panel reads (web `getThrottleStyle(avgPower)`). */
    fun efficiencyThrottleStyle(): EfficiencyThrottleStyle =
        when {
            avgPower < THROTTLE_CONSERVATIVE_MAX_KW -> EfficiencyThrottleStyle.Conservative
            avgPower < THROTTLE_AGGRESSIVE_MIN_KW -> EfficiencyThrottleStyle.Moderate
            else -> EfficiencyThrottleStyle.Aggressive
        }

    /** The driving style the DrivingTips list reads (the same web `getThrottleStyle(avgPower)` derivation). */
    fun tipsThrottleStyle(): TipsThrottleStyle = TipsThrottleStyle.fromAvgPower(avgPower)
}

// ── Derived bundles the view-model exposes (so one upstream feed fans out to several panels) ──────────────────

/**
 * The render-ready slices the motor-history feed fans out into: the chart samples MotorHistoryCharts reads and
 * the cross-section [CanonicalMotorStats] (or `null` when no history exists, the web `computeMotorStats` empty
 * return) the three statistics panels read.
 */
data class MotorHistoryDerived(
    val samples: List<MotorHistorySample>,
    val stats: CanonicalMotorStats?,
) {
    companion object {
        /** The empty derivation rendered before any history loads / when no samples exist. */
        val EMPTY: MotorHistoryDerived = MotorHistoryDerived(emptyList(), null)
    }
}

/**
 * The render-ready slices the drives feed fans out into: the date-filtered speed samples SpeedGearPanel reduces
 * over (web `filteredDrives`), and the full drive list DriveAnalyticsSection reads (it owns its own date range).
 */
data class DrivesDerived(
    val speedSamples: List<DriveSpeedSample>,
    val analyticsDrives: List<DriveAnalyticsDrive>,
) {
    companion object {
        /** The empty derivation rendered before any drives load / when none exist. */
        val EMPTY: DrivesDerived = DrivesDerived(emptyList(), emptyList())
    }
}

// ── Decoders (raw SI JSON → feature-view inputs) ──────────────────────────────────────────────────────────────

/** Lenient JSON for the driving-coach decode — tolerates extra/absent fields rather than failing the whole panel. */
private val coachJson: Json =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
    }

private const val FIELD_TS = "ts"
private const val FIELD_POWER_KW = "power_kw"
private const val FIELD_REGEN_KW = "regen_kw"
private const val FIELD_TORQUE_FRONT = "torque_nm_front"
private const val FIELD_TORQUE_REAR = "torque_nm_rear"
private const val FIELD_RPM_FRONT = "motor_rpm_front"
private const val FIELD_RPM_REAR = "motor_rpm_rear"
private const val FIELD_TEMP_FRONT = "motor_temp_c_front"
private const val FIELD_TEMP_REAR = "motor_temp_c_rear"

/** The web `motorStats.highTorquePct` threshold — torque (Nm) above which a reading counts as "high torque". */
private const val HIGH_TORQUE_NM: Double = 200.0

/** Whole percent (web `* 100`). */
private const val PERCENT: Double = 100.0

/** Decode one `/motor/latest` body into the LiveMotorStatus snapshot, or `null` when absent (web `motorLatest`). */
fun motorLiveOf(element: JsonElement?): MotorLive? = MotorLive.fromJson(element)

/** The SpeedGearPanel's shift slice, read from the same `/motor/latest` snapshot (shift state + motor power). */
fun motorShiftOf(motor: MotorLive?): MotorShift? =
    motor?.let { MotorShift(shiftState = it.shiftState, powerKw = it.powerKw) }

/** Decode one `/drive-dynamics/latest` body into the PedalUsage snapshot, or `null` when absent (web `data`). */
fun driveDynamicsOf(element: JsonElement?): DriveDynamicsLive? = DriveDynamicsLive.fromJson(element)

/**
 * Decode the `/analytics/driving-coach` body into the [DrivingCoachData] the section reads, or `null` when the
 * payload is absent / not decodable — the web threads `coachData` (which may be `undefined`) down as-is, and the
 * section renders its internal empty states for a `null`/empty payload, never a blank box.
 */
fun drivingCoachOf(element: JsonElement?): DrivingCoachData? {
    if (element == null || element !is JsonObject) return null
    return runCatching { coachJson.decodeFromJsonElement(DrivingCoachData.serializer(), element) }.getOrNull()
}

// ── Motor-history derivation (web `computeMotorStats` + the three `motorHistory.map` chart builds) ─────────────

/**
 * Decode + fan out the `/motor` history body into the [MotorHistoryDerived] the panels read: the chart samples
 * (web `powerChartData`/`torqueChartData`/`rpmChartData`, sharing one time axis) and the cross-section
 * [CanonicalMotorStats]. A null / non-array / empty body yields [MotorHistoryDerived.EMPTY], so the charts show
 * their "awaiting data" empty state and the statistics panels show theirs.
 */
fun deriveMotorHistory(
    element: JsonElement?,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
): MotorHistoryDerived {
    val rows = parseMotorRows(element)
    if (rows.isEmpty()) return MotorHistoryDerived.EMPTY
    val timeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.MEDIUM).withLocale(locale).withZone(zone)
    val samples =
        rows.map { row ->
            MotorHistorySample(
                time = formatTime(row.ts, timeFormatter),
                powerKw = row.powerKw,
                regenKw = row.regenKw,
                torqueFront = row.torqueFront,
                torqueRear = row.torqueRear,
                rpmFront = row.rpmFront,
                rpmRear = row.rpmRear,
            )
        }
    return MotorHistoryDerived(samples = samples, stats = computeMotorStats(rows))
}

/**
 * Decode the `/motor` history body into the typed rows the page reads. Accepts the bare JSON array the handler
 * serves, or an object wrapping it under `data`/`items`/`results` (the web `safeArray` shapes); anything else
 * yields an empty list. Each element that is not a JSON object is skipped.
 */
fun parseMotorRows(element: JsonElement?): List<MotorSnapshotRow> {
    val array = element.asRowArray() ?: return emptyList()
    return array.mapNotNull { item ->
        (item as? JsonObject)?.let { obj ->
            MotorSnapshotRow(
                ts = obj.stringField(FIELD_TS),
                powerKw = obj.doubleField(FIELD_POWER_KW),
                regenKw = obj.doubleField(FIELD_REGEN_KW),
                torqueFront = obj.doubleField(FIELD_TORQUE_FRONT),
                torqueRear = obj.doubleField(FIELD_TORQUE_REAR),
                rpmFront = obj.doubleField(FIELD_RPM_FRONT),
                rpmRear = obj.doubleField(FIELD_RPM_REAR),
                motorTempCFront = obj.doubleField(FIELD_TEMP_FRONT),
                motorTempCRear = obj.doubleField(FIELD_TEMP_REAR),
            )
        }
    }
}

/**
 * The cross-section motor statistics — a verbatim port of the web `computeMotorStats(motorHistory)`
 * (driving-dynamics/helpers.ts): the combined-axle torque is summed only when at least one axle reports; the
 * motor temperature is the per-sample axle maximum; power/regen read their derived-kW fields; and the high-torque
 * share counts readings above the 200 Nm threshold. Returns `null` for an empty history, exactly like the web
 * `if (h.length === 0) return null`.
 */
fun computeMotorStats(rows: List<MotorSnapshotRow>): CanonicalMotorStats? {
    if (rows.isEmpty()) return null
    val torques =
        rows.mapNotNull { row ->
            if (row.torqueFront == null && row.torqueRear == null) {
                null
            } else {
                (row.torqueFront ?: 0.0) + (row.torqueRear ?: 0.0)
            }
        }
    val motorTemps =
        rows.mapNotNull { row ->
            if (row.motorTempCFront == null && row.motorTempCRear == null) {
                null
            } else {
                maxOf(
                    row.motorTempCFront ?: Double.NEGATIVE_INFINITY,
                    row.motorTempCRear ?: Double.NEGATIVE_INFINITY,
                )
            }
        }
    val powers = rows.mapNotNull { it.powerKw }
    val regens = rows.mapNotNull { it.regenKw }
    return CanonicalMotorStats(
        totalReadings = rows.size,
        avgTorque = avg(torques),
        maxTorque = max(torques),
        avgMotorTemp = avg(motorTemps),
        maxMotorTemp = max(motorTemps),
        avgPower = avg(powers),
        peakPower = max(powers),
        minPower = min(powers),
        peakRegen = max(regens),
        highTorquePct = if (torques.isEmpty()) 0.0 else torques.count { it > HIGH_TORQUE_NM } * PERCENT / torques.size,
    )
}

// ── Drives derivation (web `filteredDrives` + the per-component fan-out) ──────────────────────────────────────

/**
 * Fan the loaded `/drives` list out into the [DrivesDerived] the panels read: the SpeedGearPanel speed samples
 * (filtered to the web page's default trailing-[windowDays] window so its average/top speed match the web
 * initial render) and the full DriveAnalyticsSection list (which owns its own date range internally). A null /
 * empty list yields [DrivesDerived.EMPTY].
 */
fun deriveDrives(
    drives: List<Drive>?,
    today: LocalDate = LocalDate.now(),
    windowDays: Long = DrivingDynamicsPageRegistration.DRIVE_WINDOW_DAYS,
): DrivesDerived {
    val source = drives ?: emptyList()
    if (source.isEmpty()) return DrivesDerived.EMPTY
    val startYmd = today.minusDays(windowDays).toString()
    val endYmd = today.toString()
    val speedSamples =
        source
            .filter { drive -> driveDayKey(drive) in startYmd..endYmd }
            .map { DriveSpeedSample(avgSpeedMps = it.avgSpeedMps, maxSpeedMps = it.maxSpeedMps) }
    val analyticsDrives =
        source.map { drive ->
            DriveAnalyticsDrive(
                startTs = drive.startTs.toString(),
                distanceM = drive.distanceM,
                avgSpeedMps = drive.avgSpeedMps,
                avgPowerW = drive.avgPowerW,
            )
        }
    return DrivesDerived(speedSamples = speedSamples, analyticsDrives = analyticsDrives)
}

/** The `YYYY-MM-DD` calendar key the web filters on (`startTs?.slice(0, 10)`), from the SI start instant. */
private fun driveDayKey(drive: Drive): String = drive.startTs.toString().take(DATE_KEY_LENGTH)

// ── Small pure helpers ────────────────────────────────────────────────────────────────────────────────────────

/** Length of an ISO `YYYY-MM-DD` calendar key. */
private const val DATE_KEY_LENGTH: Int = 10

/** Arithmetic mean, 0 for an empty list — the web `avg`. */
private fun avg(values: List<Double>): Double = if (values.isEmpty()) 0.0 else values.sum() / values.size

/** Maximum, 0 for an empty list — the web `max`. */
private fun max(values: List<Double>): Double = values.maxOrNull() ?: 0.0

/** Minimum, 0 for an empty list — the web `min`. */
private fun min(values: List<Double>): Double = values.minOrNull() ?: 0.0

/** Format a sample timestamp into the chart's x-axis label (web `formatTime(s.ts)`); the raw value on a parse miss. */
private fun formatTime(
    ts: String?,
    formatter: DateTimeFormatter,
): String {
    val raw = ts ?: return ""
    return runCatching { formatter.format(Instant.parse(raw)) }.getOrDefault(raw)
}

/** Read a JSON object's numeric field, or `null` when absent / not a number. */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON object's string field, or `null` when absent / not a string. */
private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** The array a `/motor` body carries — the bare array, or the one wrapped under a common data key (web `safeArray`). */
private fun JsonElement?.asRowArray(): JsonArray? =
    when (this) {
        is JsonArray -> this
        is JsonObject ->
            ROW_ARRAY_KEYS.firstNotNullOfOrNull { key -> this[key] as? JsonArray }
        else -> null
    }

/** The keys a paginated/wrapped list body may nest its array under (web `safeArray` accepted shapes). */
private val ROW_ARRAY_KEYS: List<String> = listOf("data", "items", "results")

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The
 * cached value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both
 * transformed; the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the
 * view-model's `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DrivingDynamicsPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its
 * first composition. Carries no vehicle id, motor reading, or coach figure.
 */
fun recordDrivingDynamicsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DrivingDynamicsPageRegistration.SLUG))
}
