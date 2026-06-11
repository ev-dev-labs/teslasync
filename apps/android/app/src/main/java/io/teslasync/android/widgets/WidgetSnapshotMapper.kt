package io.teslasync.android.widgets

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.DashboardStats
import io.teslasync.shared.core.presentation.notifications.Alert
import kotlin.math.roundToInt

/**
 * The freshness + sync inputs shared by every widget snapshot, grouped so the mapper functions stay
 * small: the cached value's [fetchedAtMillis] stamp, the last background [syncStatus], and the
 * wall-clock [nowMillis] the freshness is measured against.
 */
data class WidgetReadContext(
    val fetchedAtMillis: Long?,
    val syncStatus: WidgetSyncStatus,
    val nowMillis: Long,
)

/**
 * Turns cached shared-core data + the last background-sync outcome into render-ready
 * [WidgetSnapshot]s — the widget display boundary (P3/A8). It is the only place SI values become
 * user-facing strings (through the shared [UnitFormatter], the single SI→display seam), and the only
 * place the [WidgetRenderState] is decided (via [deriveRenderState]). Pure and clock-injected so the
 * whole loading / content / empty / stale / offline / error matrix is unit-tested off-device.
 */
object WidgetSnapshotMapper {
    private const val SECONDS_PER_HOUR: Double = 3600.0
    private const val CENTS_PER_UNIT: Double = 100.0

    /** Default vehicle label used only by tests; the reader passes the localized resource string. */
    private const val DEFAULT_VEHICLE_NAME: String = "Tesla"

    /**
     * Vehicle-status snapshot from the cached [state] (and the resolved [vehicleName]). A `null`
     * [state] is an honest empty/loading/error (no fabricated battery). SOC stays the integer for the
     * ring; range and interior temperature are formatted in the user's units.
     */
    fun vehicleStatus(
        vehicleName: String?,
        state: VehicleState?,
        context: WidgetReadContext,
        formatter: UnitFormatter,
        fallbackVehicleName: String = DEFAULT_VEHICLE_NAME,
    ): VehicleStatusSnapshot {
        val freshness = WidgetFreshness.of(context.fetchedAtMillis, context.nowMillis)
        val content =
            state?.let { s ->
                val soc = socPercentOf(s.batteryLevel)
                VehicleStatusContent(
                    vehicleName = vehicleName?.takeIf { it.isNotBlank() } ?: fallbackVehicleName,
                    fsmState = vehicleFsmStateOf(s.state, s.isCharging),
                    socPercent = soc,
                    socText = formatPercent(soc),
                    rangeText = formatter.distance(s.ratedRange),
                    insideTempText = formatter.temperature(s.insideTemp),
                    isLocked = s.isLocked,
                )
            }
        val renderState = deriveRenderState(state != null, isContentEmpty = false, freshness.isStale, context.syncStatus)
        return WidgetSnapshot(renderState, content, freshness)
    }

    /**
     * Charging snapshot from the cached vehicle [state] (live charging fields) and the [latestSession]
     * (summary). Power/ETA show only while charging; the last session's final SOC stands in for the
     * charge-limit target, and its energy+cost form the idle-state summary.
     */
    fun charging(
        state: VehicleState?,
        latestSession: ChargingSession?,
        context: WidgetReadContext,
        formatter: UnitFormatter,
    ): ChargingSnapshot {
        val freshness = WidgetFreshness.of(context.fetchedAtMillis, context.nowMillis)
        val hasCache = state != null || latestSession != null
        val content = if (hasCache) chargingContentOf(state, latestSession, formatter) else null
        val renderState = deriveRenderState(hasCache, isContentEmpty = false, freshness.isStale, context.syncStatus)
        return WidgetSnapshot(renderState, content, freshness)
    }

    /**
     * Quick-stats snapshot from the cached fleet [stats]. An all-zero summary (fresh install) renders
     * the empty state; otherwise energy/cost/distance are formatted and efficiency is derived from the
     * SI totals so it is unit-correct regardless of any backend efficiency field.
     */
    fun quickStats(
        stats: DashboardStats?,
        context: WidgetReadContext,
        formatter: UnitFormatter,
    ): QuickStatsSnapshot {
        val freshness = WidgetFreshness.of(context.fetchedAtMillis, context.nowMillis)
        val content =
            stats?.let { s ->
                QuickStatsContent(
                    energyText = formatter.energy(s.totalEnergyWh),
                    costText = formatCostFromCents(s.totalCostCents),
                    distanceText = formatter.distance(s.totalM),
                    efficiencyText = formatEfficiency(s.totalEnergyWh, s.totalM, formatter),
                    drivesCount = s.totalTrips,
                    chargesCount = s.totalChargingSessions,
                )
            }
        val isEmpty = stats == null || stats == DashboardStats()
        val renderState = deriveRenderState(stats != null, isEmpty, freshness.isStale, context.syncStatus)
        return WidgetSnapshot(renderState, content, freshness)
    }

    /**
     * Alerts snapshot from the cached [alerts] inbox and the device [quietHoursActive] flag. Critical
     * count matches the web (`severity == critical && !is_read`); the latest critical (else newest)
     * alert is surfaced. An empty inbox renders the empty state, still showing the quiet-hours chip.
     */
    fun alerts(
        alerts: List<Alert>?,
        quietHoursActive: Boolean,
        context: WidgetReadContext,
    ): AlertsSnapshot {
        val freshness = WidgetFreshness.of(context.fetchedAtMillis, context.nowMillis)
        val content = alerts?.let { alertsContentOf(it, quietHoursActive) }
        val isEmpty = alerts != null && alerts.isEmpty()
        val renderState = deriveRenderState(alerts != null, isEmpty, freshness.isStale, context.syncStatus)
        return WidgetSnapshot(renderState, content, freshness)
    }

    // ── Helpers ────────────────────────────────────────────────────────────────────────────────────

    private fun chargingContentOf(
        state: VehicleState?,
        session: ChargingSession?,
        formatter: UnitFormatter,
    ): ChargingContent {
        val charging = state?.isCharging == true
        val phase = if (charging) ChargingPhase.Charging else state?.let { ChargingPhase.Idle } ?: ChargingPhase.Unknown
        val soc = socPercentOf(state?.batteryLevel)
        return ChargingContent(
            phase = phase,
            socPercent = soc,
            socText = formatPercent(soc),
            targetSocText = session?.endSocPct?.let { formatPercent(it.roundToInt()) },
            powerText = if (charging) formatter.power(state.chargerPower) else null,
            etaText = if (charging) chargingEtaText(state.timeToFullCharge, formatter) else null,
            sessionSummaryText = chargingSessionSummary(session, formatter),
        )
    }

    /** The time-to-full hours converted to SI seconds and formatted, or `null` when not charging soon. */
    private fun chargingEtaText(
        hoursToFull: Double?,
        formatter: UnitFormatter,
    ): String? {
        if (hoursToFull == null || hoursToFull <= 0.0) return null
        return formatter.duration(hoursToFull * SECONDS_PER_HOUR)
    }

    /** "12.3 kWh · 4.50" for the last session, or `null` when there is no session energy/cost. */
    private fun chargingSessionSummary(
        session: ChargingSession?,
        formatter: UnitFormatter,
    ): String? {
        if (session == null) return null
        val energyPart = session.totalEnergyAddedWh?.let { formatter.energy(it) }
        val costPart = session.costDecimal?.let { formatCostFromCents((it * CENTS_PER_UNIT).roundToInt()) }
        val parts = listOfNotNull(energyPart, costPart)
        return parts.takeIf { it.isNotEmpty() }?.joinToString(" \u00B7 ")
    }

    private fun alertsContentOf(
        alerts: List<Alert>,
        quietHoursActive: Boolean,
    ): AlertsContent {
        val unread = alerts.filter { !it.isRead }
        val critical = unread.filter { alertSeverityOf(it.severity) == AlertSeverity.Critical }
        val latest = critical.maxByOrNull { it.createdAt } ?: alerts.maxByOrNull { it.createdAt }
        return AlertsContent(
            criticalCount = critical.size,
            unreadCount = unread.size,
            totalCount = alerts.size,
            latestTitle = latest?.title?.takeIf { it.isNotBlank() },
            latestSeverity = latest?.let { alertSeverityOf(it.severity) },
            quietHoursActive = quietHoursActive,
        )
    }
}
