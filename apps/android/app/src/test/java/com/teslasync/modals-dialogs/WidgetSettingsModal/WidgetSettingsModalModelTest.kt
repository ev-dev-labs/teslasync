// Off-device unit coverage for the WidgetSettingsModal surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the section predicates (web `isVehicleWidget` / `isChartWidget`), the dropdown
// select-value reads + mutations (web `config.x?.toString() ?? sentinel` and `setConfig`'s `=== sentinel ? undefined :
// Number(val)` spreads), the show-title default (web `!== false`), the vehicle label fallback (web `display_name ||
// `Vehicle ${id}``), the vehicle-option assembly (web `[all, ...vehicles]`), the untouched-key preservation (web
// `...prev` spread), the category wire vocabulary, the registry identifiers, and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.widgetsettingsmodal

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class WidgetSettingsModalModelTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ---- Section predicates (web isVehicleWidget / isChartWidget) -----------------

    @Test
    fun isVehicleWidget_isFalseOnlyForSystemAndAnalytics() {
        assertFalse(WidgetSettingsProjection.isVehicleWidget(WidgetCategory.System))
        assertFalse(WidgetSettingsProjection.isVehicleWidget(WidgetCategory.Analytics))
        assertTrue(WidgetSettingsProjection.isVehicleWidget(WidgetCategory.Vehicle))
        assertTrue(WidgetSettingsProjection.isVehicleWidget(WidgetCategory.Battery))
        assertTrue(WidgetSettingsProjection.isVehicleWidget(WidgetCategory.Charging))
        assertTrue(WidgetSettingsProjection.isVehicleWidget(WidgetCategory.Maps))
    }

    @Test
    fun isChartWidget_isTrueForDrivingChargingAnalyticsBattery() {
        listOf(WidgetCategory.Driving, WidgetCategory.Charging, WidgetCategory.Analytics, WidgetCategory.Battery)
            .forEach { assertTrue(it.name, WidgetSettingsProjection.isChartWidget(it)) }
        listOf(WidgetCategory.Vehicle, WidgetCategory.Energy, WidgetCategory.System, WidgetCategory.Maps)
            .forEach { assertFalse(it.name, WidgetSettingsProjection.isChartWidget(it)) }
    }

    // ---- Vehicle select value + mutation (web 'all' <-> Number) -------------------

    @Test
    fun vehicleSelectValue_isAllSentinelWhenUnset() {
        assertEquals("all", WidgetSettingsProjection.vehicleSelectValue(WidgetConfig()))
        assertEquals("7", WidgetSettingsProjection.vehicleSelectValue(WidgetConfig(vehicleId = 7)))
    }

    @Test
    fun withVehicleId_mapsAllToNullAndNumberToLong() {
        val cleared = WidgetSettingsProjection.withVehicleId(WidgetConfig(vehicleId = 7), "all")
        assertNull(cleared.vehicleId)
        val set = WidgetSettingsProjection.withVehicleId(WidgetConfig(), "42")
        assertEquals(42L, set.vehicleId)
    }

    // ---- Refresh-rate select value + mutation (web 'default' <-> Number) ----------

    @Test
    fun refreshSelectValue_isDefaultSentinelWhenUnset() {
        assertEquals("default", WidgetSettingsProjection.refreshSelectValue(WidgetConfig()))
        assertEquals("30", WidgetSettingsProjection.refreshSelectValue(WidgetConfig(refreshRate = 30)))
    }

    @Test
    fun withRefreshRate_mapsDefaultToNullAndNumberToInt() {
        assertNull(WidgetSettingsProjection.withRefreshRate(WidgetConfig(refreshRate = 30), "default").refreshRate)
        assertEquals(15, WidgetSettingsProjection.withRefreshRate(WidgetConfig(), "15").refreshRate)
    }

    @Test
    fun refreshRateValues_areTheWebCadenceLadder() {
        assertEquals(listOf(5, 15, 30, 60), WidgetSettingsProjection.REFRESH_RATE_VALUES)
    }

    // ---- Time-range select value + mutation (web ?? '7d') -------------------------

    @Test
    fun timeRangeSelectValue_fallsBackToSevenDays() {
        assertEquals("7d", WidgetSettingsProjection.timeRangeSelectValue(WidgetConfig()))
        assertEquals("30d", WidgetSettingsProjection.timeRangeSelectValue(WidgetConfig(timeRange = "30d")))
    }

    @Test
    fun withTimeRange_setsTheToken() {
        assertEquals("90d", WidgetSettingsProjection.withTimeRange(WidgetConfig(), "90d").timeRange)
        assertEquals(listOf("24h", "7d", "30d", "90d"), WidgetSettingsProjection.TIME_RANGE_VALUES)
    }

    // ---- Show-title default + mutation (web showTitle !== false) ------------------

    @Test
    fun showTitleChecked_isOnUnlessExplicitlyFalse() {
        assertTrue(WidgetSettingsProjection.showTitleChecked(WidgetConfig()))
        assertTrue(WidgetSettingsProjection.showTitleChecked(WidgetConfig(showTitle = true)))
        assertFalse(WidgetSettingsProjection.showTitleChecked(WidgetConfig(showTitle = false)))
    }

    @Test
    fun withShowTitle_setsTheFlag() {
        assertEquals(false, WidgetSettingsProjection.withShowTitle(WidgetConfig(), false).showTitle)
        assertEquals(true, WidgetSettingsProjection.withShowTitle(WidgetConfig(showTitle = false), true).showTitle)
    }

    // ---- Vehicle label + option assembly (web display_name || `Vehicle ${id}`) ----

    @Test
    fun vehicleLabel_usesDisplayNameOrFallsBackToVehicleId() {
        assertEquals("Garage Car", WidgetSettingsProjection.vehicleLabel(vehicle(5, "Garage Car"), "Vehicle"))
        assertEquals("Vehicle 9", WidgetSettingsProjection.vehicleLabel(vehicle(9, "  "), "Vehicle"))
    }

    @Test
    fun vehicleOptions_putAllFirstThenOneOptionPerVehicle() {
        val options =
            WidgetSettingsProjection.vehicleOptions(
                vehicles = listOf(vehicle(5, "Garage Car"), vehicle(9, "")),
                allLabel = "All Vehicles (first)",
                vehicleWord = "Vehicle",
            )
        assertEquals(3, options.size)
        assertEquals(WidgetSettingsOption("all", "All Vehicles (first)"), options[0])
        assertEquals(WidgetSettingsOption("5", "Garage Car"), options[1])
        assertEquals(WidgetSettingsOption("9", "Vehicle 9"), options[2])
    }

    @Test
    fun vehicleOptions_isJustAllWhenNoVehicles() {
        val options = WidgetSettingsProjection.vehicleOptions(emptyList(), "All", "Vehicle")
        assertEquals(listOf(WidgetSettingsOption("all", "All")), options)
    }

    // ---- Untouched keys are preserved across edits (web ...prev spread) -----------

    @Test
    fun mutations_preserveChartTypeAndExtras() {
        val seed =
            WidgetConfig(
                refreshRate = 15,
                chartType = "line",
                extras = mapOf("foo" to JsonPrimitive("bar")),
            )
        val afterVehicle = WidgetSettingsProjection.withVehicleId(seed, "3")
        assertEquals("line", afterVehicle.chartType)
        assertEquals(JsonPrimitive("bar"), afterVehicle.extras["foo"])
        assertEquals(15, afterVehicle.refreshRate)
        val afterTitle = WidgetSettingsProjection.withShowTitle(afterVehicle, false)
        assertEquals("line", afterTitle.chartType)
        assertEquals(3L, afterTitle.vehicleId)
    }

    // ---- Category vocabulary + registry ------------------------------------------

    @Test
    fun widgetCategory_roundTripsWireTokensAndFallsBack() {
        WidgetCategory.entries.forEach { assertEquals(it, WidgetCategory.fromWire(it.wire)) }
        assertEquals(WidgetCategory.Vehicle, WidgetCategory.fromWire("does-not-exist"))
    }

    @Test
    fun registration_carriesStableIdAndSlug() {
        assertEquals("widget-settings-modal", WidgetSettingsModalRegistration.ID)
        assertEquals("WidgetSettingsModal", WidgetSettingsModalRegistration.SLUG)
    }

    // ---- Diagnostics (PII-safe view.opened) --------------------------------------

    @Test
    fun recordWidgetSettingsModalOpened_emitsSlugAndNoPayload() {
        val logger = RecordingLogger()
        recordWidgetSettingsModalOpened(logger)
        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "WidgetSettingsModal"), opened.second)
    }

    private companion object {
        fun vehicle(
            id: Long,
            name: String,
        ): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochSeconds(0),
                displayName = name,
                enrolledAt = Instant.fromEpochSeconds(0),
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = Instant.fromEpochSeconds(0),
                vin = "VIN$id",
            )
    }
}
