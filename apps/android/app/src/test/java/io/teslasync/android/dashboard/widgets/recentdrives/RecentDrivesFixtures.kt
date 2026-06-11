package io.teslasync.android.dashboard.widgets.recentdrives

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlin.time.Instant

/** SI epoch used for the non-rendered Drive timestamps in tests. */
private val EPOCH: Instant = Instant.fromEpochMilliseconds(0)

/** `start_ts` is derived as `id × this` so a larger [drive] id is always the newer drive (sort key). */
private const val MILLIS_PER_ID = 1_000L

/**
 * Builds a generated SI [Drive] for the RecentDrives off-device tests. Only the fields the widget renders
 * carry meaningful defaults (SI metres, seconds, start/end battery %); the rest are the generated DTO's
 * required scaffolding. `start_ts` is derived from [id] (`id × 1000` ms) so a higher id sorts newer and the
 * rendered date is deterministically `d<id×1000>` under the test's stubbed formatter.
 */
internal fun drive(
    id: Long,
    distanceM: Double = 12_000.0,
    durationS: Long = 1_200,
    startBatteryPct: Long? = 80,
    endBatteryPct: Long? = 65,
): Drive =
    Drive(
        createdAt = EPOCH,
        distanceM = distanceM,
        durationS = durationS,
        id = id,
        startTs = Instant.fromEpochMilliseconds(id * MILLIS_PER_ID),
        updatedAt = EPOCH,
        vehicleId = 1,
        startBatteryPct = startBatteryPct,
        endBatteryPct = endBatteryPct,
    )

/** The localized strings the projection reads, with a deterministic date stub (`d<millis>`) for tests. */
internal fun recentDrivesStrings(): RecentDrivesStrings =
    RecentDrivesStrings(
        title = "Recent Drives",
        viewAll = "View all",
        noDrives = "No recent drives",
        refreshLabel = "Refresh",
        minutesLabel = "min",
        formatStartDate = { millis -> "d$millis" },
    )

/** A display [UnitPref] for tests; only [distance] varies between cases. */
internal fun unitPref(distance: DistanceUnitPref = DistanceUnitPref.KM): UnitPref =
    UnitPref(
        distance = distance,
        speed = SpeedUnitPref.KMH,
        temperature = TemperatureUnitPref.CELSIUS,
        pressure = PressureUnitPref.BAR,
        energy = EnergyUnitPref.KWH,
        duration = DurationUnitPref.HOURS,
        power = PowerUnitPref.KW,
        locale = "en-US",
        precision = null,
    )
