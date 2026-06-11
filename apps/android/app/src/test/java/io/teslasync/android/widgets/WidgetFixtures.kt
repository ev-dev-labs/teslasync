package io.teslasync.android.widgets

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.notifications.Alert
import kotlin.time.Instant

/** Fixed "now" used across the widget tests so freshness transitions are deterministic. */
const val WIDGET_TEST_NOW: Long = 1_700_000_000_000L

/** A fetched-at stamp inside the freshness window (10s old → Fresh). */
const val FRESH_FETCHED_AT: Long = WIDGET_TEST_NOW - 10_000L

/** A fetched-at stamp past the 2-minute stale window (300s old → Stale). */
const val STALE_FETCHED_AT: Long = WIDGET_TEST_NOW - 300_000L

/** The default (metric) display formatter used to compute expected widget strings. */
val metricFormatter: UnitFormatter = UnitFormatter.default()

/** Builds a [VehicleState] with sensible SI defaults; override only the fields a test cares about. */
@Suppress("LongParameterList")
fun vehicleStateFixture(
    batteryLevel: Long = 80,
    ratedRange: Double = 300_000.0,
    insideTemp: Double = 21.0,
    isCharging: Boolean = false,
    isLocked: Boolean = true,
    chargerPower: Double = 0.0,
    timeToFullCharge: Double = 0.0,
    state: String = "online",
): VehicleState =
    VehicleState(
        batteryLevel = batteryLevel,
        chargeRate = 0.0,
        chargerPower = chargerPower,
        idealRange = ratedRange,
        insideTemp = insideTemp,
        isCharging = isCharging,
        isClimateOn = false,
        isLocked = isLocked,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 0.0,
        outsideTemp = 10.0,
        power = 0.0,
        ratedRange = ratedRange,
        sentryMode = false,
        softwareVersion = "2026.4",
        speed = 0.0,
        state = state,
        timeToFullCharge = timeToFullCharge,
        vehicleId = 1L,
    )

/** Builds a [ChargingSession] with everything optional null unless overridden. */
fun chargingSessionFixture(
    id: Long = 1L,
    startedAtMs: Long = 0L,
    endSocPct: Double? = null,
    totalEnergyAddedWh: Double? = null,
    costDecimal: Double? = null,
): ChargingSession =
    ChargingSession(
        id = id,
        startedAt = Instant.fromEpochMilliseconds(startedAtMs),
        vehicleId = 1L,
        endSocPct = endSocPct,
        totalEnergyAddedWh = totalEnergyAddedWh,
        costDecimal = costDecimal,
    )

/** Builds an [Alert] with the fields the widgets read. */
fun alertFixture(
    id: Long,
    severity: String = "info",
    isRead: Boolean = false,
    title: String = "Alert $id",
    createdAt: String = "2026-01-01T00:00:00Z",
): Alert =
    Alert(
        id = id,
        severity = severity,
        title = title,
        isRead = isRead,
        createdAt = createdAt,
    )
