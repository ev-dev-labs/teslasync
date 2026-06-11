package io.teslasync.android.widgets

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.DashboardStats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exhaustive tests for [WidgetSnapshotMapper] — every widget across the loading / content / empty /
 * stale / offline / error states, asserting the [WidgetRenderState] plus the display-ready content
 * (compared against direct shared-formatter calls so the assertions are locale-independent).
 */
class WidgetSnapshotMapperTest {
    private fun ctx(
        fetchedAt: Long?,
        sync: WidgetSyncStatus,
    ): WidgetReadContext = WidgetReadContext(fetchedAt, sync, WIDGET_TEST_NOW)

    // ── Vehicle status ──────────────────────────────────────────────────────────────────────────

    @Test
    fun vehicleStatusFreshContent() {
        val state = vehicleStateFixture(batteryLevel = 80, ratedRange = 300_000.0, insideTemp = 21.0, state = "online")
        val snapshot =
            WidgetSnapshotMapper.vehicleStatus(
                vehicleName = "Model 3",
                state = state,
                context = ctx(FRESH_FETCHED_AT, WidgetSyncStatus.Ok),
                formatter = metricFormatter,
            )
        assertEquals(WidgetRenderState.Content, snapshot.renderState)
        val content = requireNotNull(snapshot.content)
        assertEquals("Model 3", content.vehicleName)
        assertEquals(80, content.socPercent)
        assertEquals("80%", content.socText)
        assertEquals(metricFormatter.distance(300_000.0), content.rangeText)
        assertEquals(metricFormatter.temperature(21.0), content.insideTempText)
        assertEquals(VehicleFsmState.Online, content.fsmState)
        assertFalse(snapshot.freshness.isStale)
    }

    @Test
    fun vehicleStatusChargingFlagOverridesState() {
        val snapshot = vehicleStatusOf(vehicleStateFixture(isCharging = true, state = "online"), FRESH_FETCHED_AT, WidgetSyncStatus.Ok)
        assertEquals(VehicleFsmState.Charging, requireNotNull(snapshot.content).fsmState)
    }

    @Test
    fun vehicleStatusStaleAgeRendersStale() {
        val snapshot = vehicleStatusOf(vehicleStateFixture(), STALE_FETCHED_AT, WidgetSyncStatus.Ok)
        assertEquals(WidgetRenderState.Stale, snapshot.renderState)
        assertTrue(snapshot.freshness.isStale)
        assertEquals(STALE_FETCHED_AT, snapshot.freshness.fetchedAtMillis)
    }

    @Test
    fun vehicleStatusFailedWithCacheRendersOffline() {
        val snapshot = vehicleStatusOf(vehicleStateFixture(), FRESH_FETCHED_AT, WidgetSyncStatus.FailedWithCache)
        assertEquals(WidgetRenderState.Offline, snapshot.renderState)
    }

    @Test
    fun vehicleStatusNoStateAfterSyncIsEmpty() {
        val snapshot =
            WidgetSnapshotMapper.vehicleStatus(
                vehicleName = null,
                state = null,
                context = ctx(null, WidgetSyncStatus.Ok),
                formatter = metricFormatter,
            )
        assertEquals(WidgetRenderState.Empty, snapshot.renderState)
        assertNull(snapshot.content)
    }

    @Test
    fun vehicleStatusNoStateNoSyncIsLoading() {
        val snapshot =
            WidgetSnapshotMapper.vehicleStatus(
                vehicleName = null,
                state = null,
                context = ctx(null, WidgetSyncStatus.Unknown),
                formatter = metricFormatter,
            )
        assertEquals(WidgetRenderState.Loading, snapshot.renderState)
    }

    @Test
    fun vehicleStatusNoCacheFailedIsError() {
        val snapshot =
            WidgetSnapshotMapper.vehicleStatus(
                vehicleName = null,
                state = null,
                context = ctx(null, WidgetSyncStatus.FailedNoCache),
                formatter = metricFormatter,
            )
        assertEquals(WidgetRenderState.Error, snapshot.renderState)
    }

    @Test
    fun vehicleStatusBlankNameUsesFallback() {
        val snapshot =
            WidgetSnapshotMapper.vehicleStatus(
                vehicleName = "  ",
                state = vehicleStateFixture(),
                context = ctx(FRESH_FETCHED_AT, WidgetSyncStatus.Ok),
                formatter = metricFormatter,
                fallbackVehicleName = "Tesla",
            )
        assertEquals("Tesla", requireNotNull(snapshot.content).vehicleName)
    }

    // ── Charging ────────────────────────────────────────────────────────────────────────────────

    @Test
    fun chargingActiveShowsPowerAndEta() {
        val state = vehicleStateFixture(batteryLevel = 60, isCharging = true, chargerPower = 11_000.0, timeToFullCharge = 1.5)
        val snapshot =
            WidgetSnapshotMapper.charging(
                state = state,
                latestSession = null,
                context = ctx(FRESH_FETCHED_AT, WidgetSyncStatus.Ok),
                formatter = metricFormatter,
            )
        assertEquals(WidgetRenderState.Content, snapshot.renderState)
        val content = requireNotNull(snapshot.content)
        assertEquals(ChargingPhase.Charging, content.phase)
        assertEquals("60%", content.socText)
        assertEquals(metricFormatter.power(11_000.0), content.powerText)
        assertEquals(metricFormatter.duration(1.5 * 3600.0), content.etaText)
    }

    @Test
    fun chargingIdleShowsSessionSummaryNoPower() {
        val state = vehicleStateFixture(isCharging = false)
        val session = chargingSessionFixture(totalEnergyAddedWh = 12_300.0, costDecimal = 4.5, endSocPct = 80.0)
        val snapshot =
            WidgetSnapshotMapper.charging(
                state = state,
                latestSession = session,
                context = ctx(FRESH_FETCHED_AT, WidgetSyncStatus.Ok),
                formatter = metricFormatter,
            )
        val content = requireNotNull(snapshot.content)
        assertEquals(ChargingPhase.Idle, content.phase)
        assertNull(content.powerText)
        assertNull(content.etaText)
        assertEquals("80%", content.targetSocText)
        assertTrue(requireNotNull(content.sessionSummaryText).contains(metricFormatter.energy(12_300.0)))
    }

    @Test
    fun chargingNoDataIsEmpty() {
        val snapshot =
            WidgetSnapshotMapper.charging(
                state = null,
                latestSession = null,
                context = ctx(null, WidgetSyncStatus.Ok),
                formatter = metricFormatter,
            )
        assertEquals(WidgetRenderState.Empty, snapshot.renderState)
    }

    @Test
    fun chargingFailedWithCacheIsOffline() {
        val snapshot =
            WidgetSnapshotMapper.charging(
                state = vehicleStateFixture(isCharging = true, chargerPower = 7000.0),
                latestSession = null,
                context = ctx(STALE_FETCHED_AT, WidgetSyncStatus.FailedWithCache),
                formatter = metricFormatter,
            )
        assertEquals(WidgetRenderState.Offline, snapshot.renderState)
    }

    // ── Quick stats ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun quickStatsContentFormatsTotals() {
        val stats =
            DashboardStats(
                totalVehicles = 1,
                totalM = 300_000.0,
                totalEnergyWh = 50_000.0,
                totalChargingSessions = 5,
                totalTrips = 10,
                totalCostCents = 1234,
            )
        val snapshot = quickStatsOf(stats, FRESH_FETCHED_AT, WidgetSyncStatus.Ok)
        assertEquals(WidgetRenderState.Content, snapshot.renderState)
        val content = requireNotNull(snapshot.content)
        assertEquals(metricFormatter.distance(300_000.0), content.distanceText)
        assertEquals(metricFormatter.energy(50_000.0), content.energyText)
        assertEquals(formatCostFromCents(1234), content.costText)
        assertEquals(formatEfficiency(50_000.0, 300_000.0, metricFormatter), content.efficiencyText)
        assertEquals(10, content.drivesCount)
        assertEquals(5, content.chargesCount)
    }

    @Test
    fun quickStatsAllZeroIsEmpty() {
        val snapshot = quickStatsOf(DashboardStats(), FRESH_FETCHED_AT, WidgetSyncStatus.Ok)
        assertEquals(WidgetRenderState.Empty, snapshot.renderState)
    }

    @Test
    fun quickStatsNullAfterSyncIsEmpty() {
        val snapshot =
            WidgetSnapshotMapper.quickStats(
                stats = null,
                context = ctx(null, WidgetSyncStatus.Ok),
                formatter = metricFormatter,
            )
        assertEquals(WidgetRenderState.Empty, snapshot.renderState)
    }

    @Test
    fun quickStatsStaleRendersStale() {
        val snapshot = quickStatsOf(DashboardStats(totalM = 1000.0), STALE_FETCHED_AT, WidgetSyncStatus.Ok)
        assertEquals(WidgetRenderState.Stale, snapshot.renderState)
    }

    // ── Alerts ──────────────────────────────────────────────────────────────────────────────────

    @Test
    fun alertsCriticalCountMatchesWeb() {
        val alerts =
            listOf(
                alertFixture(1, severity = "critical", isRead = false, createdAt = "2026-01-03T00:00:00Z"),
                alertFixture(2, severity = "critical", isRead = true, createdAt = "2026-01-02T00:00:00Z"),
                alertFixture(3, severity = "warning", isRead = false, createdAt = "2026-01-01T00:00:00Z"),
                alertFixture(4, severity = "info", isRead = false, createdAt = "2026-01-04T00:00:00Z"),
            )
        val snapshot = WidgetSnapshotMapper.alerts(alerts, quietHoursActive = false, context = ctx(FRESH_FETCHED_AT, WidgetSyncStatus.Ok))
        assertEquals(WidgetRenderState.Content, snapshot.renderState)
        val content = requireNotNull(snapshot.content)
        assertEquals(1, content.criticalCount)
        assertEquals(3, content.unreadCount)
        assertEquals(4, content.totalCount)
        assertEquals(AlertSeverity.Critical, content.latestSeverity)
        assertEquals("Alert 1", content.latestTitle)
    }

    @Test
    fun alertsEmptyListIsEmptyState() {
        val snapshot =
            WidgetSnapshotMapper.alerts(emptyList(), quietHoursActive = true, context = ctx(FRESH_FETCHED_AT, WidgetSyncStatus.Ok))
        assertEquals(WidgetRenderState.Empty, snapshot.renderState)
        assertEquals(0, requireNotNull(snapshot.content).criticalCount)
    }

    @Test
    fun alertsQuietHoursReflected() {
        val alerts = listOf(alertFixture(1, severity = "warning"))
        val snapshot = WidgetSnapshotMapper.alerts(alerts, quietHoursActive = true, context = ctx(FRESH_FETCHED_AT, WidgetSyncStatus.Ok))
        assertTrue(requireNotNull(snapshot.content).quietHoursActive)
    }

    @Test
    fun alertsNullNoSyncIsLoading() {
        val snapshot = WidgetSnapshotMapper.alerts(null, quietHoursActive = false, context = ctx(null, WidgetSyncStatus.Unknown))
        assertEquals(WidgetRenderState.Loading, snapshot.renderState)
    }

    @Test
    fun alertsFailedWithCacheIsOffline() {
        val alerts = listOf(alertFixture(1, severity = "critical"))
        val snapshot =
            WidgetSnapshotMapper.alerts(alerts, quietHoursActive = false, context = ctx(STALE_FETCHED_AT, WidgetSyncStatus.FailedWithCache))
        assertEquals(WidgetRenderState.Offline, snapshot.renderState)
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────

    private fun vehicleStatusOf(
        state: VehicleState,
        fetchedAt: Long,
        syncStatus: WidgetSyncStatus,
    ): VehicleStatusSnapshot =
        WidgetSnapshotMapper.vehicleStatus(
            vehicleName = "Car",
            state = state,
            context = ctx(fetchedAt, syncStatus),
            formatter = metricFormatter,
        )

    private fun quickStatsOf(
        stats: DashboardStats,
        fetchedAt: Long,
        syncStatus: WidgetSyncStatus,
    ): QuickStatsSnapshot =
        WidgetSnapshotMapper.quickStats(
            stats = stats,
            context = ctx(fetchedAt, syncStatus),
            formatter = metricFormatter,
        )
}
