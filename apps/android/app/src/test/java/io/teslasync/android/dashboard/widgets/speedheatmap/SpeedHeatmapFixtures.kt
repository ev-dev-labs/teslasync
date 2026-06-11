package io.teslasync.android.dashboard.widgets.speedheatmap

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import java.util.Locale
import kotlin.time.Instant

/** SI epoch used for the non-rendered Drive timestamps in tests. */
private val EPOCH: Instant = Instant.fromEpochMilliseconds(0)

/**
 * Builds a generated SI [Drive] for the SpeedHeatmap off-device tests. Only the fields the widget reads —
 * the [startTsMillis] bucket key and the [avgSpeedMps]/[maxSpeedMps] speed source — carry meaningful
 * values; the rest are the generated DTO's required scaffolding. A higher [id] sorts newer (the projection
 * keeps the most-recent 200), independent of the start timestamp.
 */
internal fun drive(
    id: Long,
    startTsMillis: Long = 0L,
    avgSpeedMps: Double? = 20.0,
    maxSpeedMps: Double? = null,
): Drive =
    Drive(
        createdAt = EPOCH,
        distanceM = 12_000.0,
        durationS = 1_200,
        id = id,
        startTs = Instant.fromEpochMilliseconds(startTsMillis),
        updatedAt = EPOCH,
        vehicleId = 1,
        avgSpeedMps = avgSpeedMps,
        maxSpeedMps = maxSpeedMps,
    )

/** The localized strings the projection reads, deterministic for tests (US grouping, plain interpolation). */
internal fun speedHeatmapStrings(): SpeedHeatmapStrings =
    SpeedHeatmapStrings(
        title = "Speed Heatmap",
        peakLabel = "Peak",
        slow = "Slow",
        fast = "Fast",
        empty = "No drive data yet",
        drivesSummary = { count -> "$count drives" },
        peakSpeedSummary = { speed, unit -> "Peak avg $speed $unit" },
        formatSpeed = { value -> ChartFormat.number(value, 0, Locale.US) },
    )

/** A display [UnitPref] for tests; only [speed] varies between cases. */
internal fun unitPref(speed: SpeedUnitPref = SpeedUnitPref.KMH): UnitPref =
    UnitPref(
        distance = DistanceUnitPref.KM,
        speed = speed,
        temperature = TemperatureUnitPref.CELSIUS,
        pressure = PressureUnitPref.BAR,
        energy = EnergyUnitPref.KWH,
        duration = DurationUnitPref.HOURS,
        power = PowerUnitPref.KW,
        locale = "en-US",
        precision = null,
    )
