package io.teslasync.android.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests the pure content classifiers and the per-size content specs (P3/A8 "tests for each widget
 * size/state"): vehicle FSM state, alert severity, and which fields each widget shows at compact /
 * medium / large.
 */
class WidgetContentSpecTest {
    @Test
    fun vehicleFsmStateMapping() {
        assertEquals(VehicleFsmState.Driving, vehicleFsmStateOf("driving", isCharging = false))
        assertEquals(VehicleFsmState.Charging, vehicleFsmStateOf("online", isCharging = true))
        assertEquals(VehicleFsmState.Charging, vehicleFsmStateOf("charging", isCharging = false))
        assertEquals(VehicleFsmState.Parked, vehicleFsmStateOf("parked", isCharging = false))
        assertEquals(VehicleFsmState.Asleep, vehicleFsmStateOf("asleep", isCharging = false))
        assertEquals(VehicleFsmState.Online, vehicleFsmStateOf("online", isCharging = false))
        assertEquals(VehicleFsmState.Offline, vehicleFsmStateOf("offline", isCharging = false))
        assertEquals(VehicleFsmState.Unknown, vehicleFsmStateOf("something-else", isCharging = false))
        assertEquals(VehicleFsmState.Unknown, vehicleFsmStateOf(null, isCharging = false))
    }

    @Test
    fun alertSeverityMapping() {
        assertEquals(AlertSeverity.Critical, alertSeverityOf("critical"))
        assertEquals(AlertSeverity.Critical, alertSeverityOf("ERROR"))
        assertEquals(AlertSeverity.Warning, alertSeverityOf("warning"))
        assertEquals(AlertSeverity.Warning, alertSeverityOf("warn"))
        assertEquals(AlertSeverity.Info, alertSeverityOf("info"))
        assertEquals(AlertSeverity.Info, alertSeverityOf(null))
    }

    @Test
    fun vehicleStatusMetricsPerSize() {
        assertEquals(listOf(VehicleStatusMetric.Range), vehicleStatusMetrics(WidgetSizeClass.Compact))
        assertEquals(3, vehicleStatusMetrics(WidgetSizeClass.Medium).size)
        assertTrue(vehicleStatusMetrics(WidgetSizeClass.Large).contains(VehicleStatusMetric.Lock))
        assertTrue(vehicleStatusMetrics(WidgetSizeClass.Medium).contains(VehicleStatusMetric.Temperature))
    }

    @Test
    fun chargingDetailsPerSize() {
        assertFalse(chargingDetails(WidgetSizeClass.Compact).contains(ChargingDetail.Target))
        assertTrue(chargingDetails(WidgetSizeClass.Medium).contains(ChargingDetail.Target))
        assertTrue(chargingDetails(WidgetSizeClass.Compact).contains(ChargingDetail.Power))
    }

    @Test
    fun quickStatsMetricsPerSize() {
        assertEquals(2, quickStatsMetrics(WidgetSizeClass.Compact).size)
        assertEquals(4, quickStatsMetrics(WidgetSizeClass.Medium).size)
        assertEquals(6, quickStatsMetrics(WidgetSizeClass.Large).size)
    }

    @Test
    fun alertsLatestShownOnlyOnLargerSizes() {
        assertFalse(alertsShowsLatest(WidgetSizeClass.Compact))
        assertTrue(alertsShowsLatest(WidgetSizeClass.Medium))
        assertTrue(alertsShowsLatest(WidgetSizeClass.Large))
    }

    @Test
    fun sizeClassThresholds() {
        assertEquals(WidgetSizeClass.Compact, widgetSizeClassOf(150, 150))
        assertEquals(WidgetSizeClass.Medium, widgetSizeClassOf(260, 150))
        assertEquals(WidgetSizeClass.Large, widgetSizeClassOf(260, 220))
        assertEquals(WidgetSizeClass.Medium, widgetSizeClassOf(239, 220))
        assertEquals(WidgetSizeClass.Compact, widgetSizeClassOf(210, 300))
    }
}
