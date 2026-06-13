package io.teslasync.android.featureviews.vehiclecharts

import io.teslasync.android.data.UiPhase
import io.teslasync.android.featureviews.vehiclecharts.VehicleChartsProjection.SettingCategory
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the VehicleCharts pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/vehicles/components/VehicleCharts.tsx + the @/lib helpers it threads in):
 * the `cleanNil` Go-nil stripping, the `parseSettingEnum` enum normalization, the `&&`-truthy coordinate gate
 * (which hides a `0`/absent latitude), the reversed + SI-converted speed series, the coordinate caption, and the
 * eighteen-cell config + five-cell preference grids. Every formatter is pinned to [Locale.US] + UTC so the
 * assertions are deterministic; because the surface is presentational, each projected value is exactly what the
 * thin composable renders.
 */
class VehicleChartsModelTest {
    private val zone = ZoneOffset.UTC
    private val mphPrefs = VehicleChartsDisplayPrefs(SpeedUnitPref.MPH, 0, Locale.US)
    private val defaultPrefs = VehicleChartsDisplayPrefs.DEFAULT

    private fun strings(): VehicleChartsStrings =
        VehicleChartsStrings(
            location = "Location",
            vehicleConfig = "Vehicle Configuration",
            carPreferences = "Car Display Preferences",
            speedHistory = "Speed History",
            positionDataWillAppear = "Position data will appear here",
            speed = "Speed",
            model = "Car Type",
            trim = "Trim",
            color = "Exterior Color",
            roof = "Roof Color",
            wheels = "Wheels",
            firmware = "Firmware",
            name = "Name",
            chargePort = "Charge Port",
            rearHeaters = "Rear Seat Heaters",
            efficiency = "Efficiency",
            sunroof = "Sunroof",
            europeVehicle = "Europe Vehicle",
            rhd = "Right-Hand Drive",
            remoteStart = "Remote Start",
            offroadLightbar = "Offroad Lightbar",
            swUpdate = "Software Update",
            swDownload = "Download",
            swInstall = "Install",
            prefDistance = "Distance",
            prefTemperature = "Temperature",
            prefChargeUnit = "Charge",
            prefTirePressure = "Tire Pressure",
            pref24hTime = "24-hour",
            yes = "Yes",
            no = "No",
            active = "Active",
            off = "Off",
            none = "None",
        )

    private fun fullSnapshot(): VehicleChartsSnapshot =
        VehicleChartsSnapshot(
            latitude = 47.6062,
            longitude = -122.3321,
            positions =
                listOf(
                    VehicleChartsPosition(ts = "2026-03-14T09:17:00Z", latitude = 47.615, longitude = -122.338, speedMps = 24.0),
                    VehicleChartsPosition(ts = "2026-03-14T09:16:00Z", latitude = 47.612, longitude = -122.333, speedMps = 12.0),
                    VehicleChartsPosition(ts = "2026-03-14T09:15:00Z", latitude = 47.610, longitude = -122.330, speedMps = 0.0),
                ),
            config =
                VehicleChartsConfig(
                    carType = "models2",
                    trim = "<nil>",
                    exteriorColor = "MidnightSilver",
                    europeVehicle = false,
                    rightHandDrive = true,
                    remoteStartEnabled = true,
                    offroadLightbarPresent = false,
                    sunroofInstalled = null,
                    softwareUpdateVersion = null,
                    softwareUpdateDownloadPct = 100.0,
                    softwareUpdateInstallPct = 40.0,
                ),
            preferences =
                VehicleChartsPreferences(
                    setting24hrTime = true,
                    settingChargeUnit = "ChargeUnitPercent",
                    settingDistanceUnit = "DistanceUnitMiles",
                    settingTemperatureUnit = "TemperatureUnitCelsius",
                    settingTirePressureUnit = "PressureUnitPsi",
                ),
        )

    private fun metric(
        items: List<VehicleChartMetric>,
        label: String,
    ): String = items.first { it.label == label }.value

    // ── cleanNil: the exact web Go-nil strip ─────────────────────────────────────

    @Test
    fun cleanNilStripsGoNilSentinelsAndBlanks() {
        assertNull(VehicleChartsProjection.cleanNil(null))
        assertNull(VehicleChartsProjection.cleanNil(""))
        assertNull(VehicleChartsProjection.cleanNil("   "))
        assertNull(VehicleChartsProjection.cleanNil("<nil>"))
        assertNull(VehicleChartsProjection.cleanNil("nil"))
        assertNull(VehicleChartsProjection.cleanNil("null"))
        assertEquals("Pearl White", VehicleChartsProjection.cleanNil("Pearl White"))
    }

    // ── parseSettingEnum: the exact web enum table + fallthrough ─────────────────

    @Test
    fun parseSettingEnumMapsEnumsAndFallsThroughUnknownValues() {
        assertEquals("Miles", VehicleChartsProjection.parseSettingEnum("DistanceUnitMiles", SettingCategory.Distance))
        assertEquals("Kilometers", VehicleChartsProjection.parseSettingEnum("km", SettingCategory.Distance))
        assertEquals("Fahrenheit", VehicleChartsProjection.parseSettingEnum("TemperatureUnitFahrenheit", SettingCategory.Temperature))
        assertEquals("Percent", VehicleChartsProjection.parseSettingEnum("ChargeUnitPercent", SettingCategory.Charge))
        assertEquals("PSI", VehicleChartsProjection.parseSettingEnum("PressureUnitPsi", SettingCategory.Pressure))
        // Unknown value falls through verbatim (web `?? value`); null yields the em-dash.
        assertEquals("Custom", VehicleChartsProjection.parseSettingEnum("Custom", SettingCategory.Distance))
        assertEquals(VEHICLE_CHARTS_EM_DASH, VehicleChartsProjection.parseSettingEnum(null, SettingCategory.Distance))
    }

    // ── isTruthyCoord: the web `&&` truthiness ───────────────────────────────────

    @Test
    fun isTruthyCoordRejectsZeroNullAndNonFinite() {
        assertTrue(VehicleChartsProjection.isTruthyCoord(47.6))
        assertTrue(VehicleChartsProjection.isTruthyCoord(-122.3))
        assertFalse(VehicleChartsProjection.isTruthyCoord(0.0))
        assertFalse(VehicleChartsProjection.isTruthyCoord(null))
        assertFalse(VehicleChartsProjection.isTruthyCoord(Double.NaN))
        assertFalse(VehicleChartsProjection.isTruthyCoord(Double.POSITIVE_INFINITY))
    }

    // ── projectUiState: the cache-then-network phase mapping ─────────────────────

    @Test
    fun projectUiStateMapsLoadingContentAndEmpty() {
        assertEquals(UiPhase.Loading, VehicleChartsProjection.projectUiState(null, isLoading = true).phase)
        assertEquals(UiPhase.Empty, VehicleChartsProjection.projectUiState(null, isLoading = false).phase)
        val content = VehicleChartsProjection.projectUiState(VehicleChartsSnapshot(), isLoading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertNotEquals(null, content.data)
    }

    // ── project: location, trail, coordinate caption ─────────────────────────────

    @Test
    fun projectResolvesLocationTrailAndCoordinateCaption() {
        val display = VehicleChartsProjection.project(fullSnapshot(), defaultPrefs, strings(), zone)
        assertTrue(display.hasLocation)
        assertEquals(47.6062, requireNotNull(display.center).lat, 1e-9)
        assertEquals("47.61, -122.33", display.coordsText)
        assertEquals(3, display.trail.size)
        assertEquals(1, display.mapSummaryLines.size)
        assertTrue(display.mapSummaryLines.first().contains("47.61, -122.33"))
    }

    @Test
    fun projectHidesMapForZeroOrAbsentCoordinatesAndFiltersZeroTrailPoints() {
        val snapshot =
            VehicleChartsSnapshot(
                latitude = 0.0,
                longitude = -122.3,
                positions =
                    listOf(
                        VehicleChartsPosition(latitude = 47.61, longitude = -122.33, speedMps = 1.0),
                        VehicleChartsPosition(latitude = 0.0, longitude = -122.33, speedMps = 2.0),
                    ),
            )
        val display = VehicleChartsProjection.project(snapshot, defaultPrefs, strings(), zone)
        assertFalse(display.hasLocation)
        assertNull(display.center)
        assertNull(display.coordsText)
        assertTrue(display.mapSummaryLines.isEmpty())
        // The (0, …) trail point is dropped exactly like the web `positions.filter(p => p.latitude && p.longitude)`.
        assertEquals(1, display.trail.size)
    }

    // ── project: the reversed, SI-converted speed series ─────────────────────────

    @Test
    fun projectReversesAndConvertsTheSpeedSeries() {
        val display = VehicleChartsProjection.project(fullSnapshot(), mphPrefs, strings(), zone)
        assertTrue(display.hasSpeedData)
        assertEquals(3, display.speedValues.size)
        // positions are newest-first; the series is reversed to chronological, so index 0 is the OLDEST sample (0 m/s).
        assertEquals(convertSpeedFromSI(0.0, SpeedUnitPref.MPH), requireNotNull(display.speedValues[0]), 1e-6)
        assertEquals(convertSpeedFromSI(24.0, SpeedUnitPref.MPH), requireNotNull(display.speedValues[2]), 1e-6)
        assertEquals("Speed mph", display.speedSeriesName)
        assertEquals("mph", display.speedUnitLabel)
        // Labels are reversed in lock-step and are real (non-em-dash) localized times.
        assertEquals(3, display.speedLabels.size)
        assertNotEquals(VEHICLE_CHARTS_EM_DASH, display.speedLabels[0])
    }

    @Test
    fun projectKeepsNullSpeedSamplesAsGapsAndEmptyPositionsAsNoData() {
        val withGap =
            VehicleChartsSnapshot(
                positions = listOf(VehicleChartsPosition(ts = "2026-03-14T09:15:00Z", speedMps = null)),
            )
        val display = VehicleChartsProjection.project(withGap, mphPrefs, strings(), zone)
        assertTrue(display.hasSpeedData)
        assertNull(display.speedValues.single())

        val empty = VehicleChartsProjection.project(VehicleChartsSnapshot(), mphPrefs, strings(), zone)
        assertFalse(empty.hasSpeedData)
        assertTrue(empty.speedValues.isEmpty())
    }

    // ── project: the configuration grid ──────────────────────────────────────────

    @Test
    fun projectBuildsTheEighteenConfigurationCells() {
        val display = VehicleChartsProjection.project(fullSnapshot(), defaultPrefs, strings(), zone)
        val s = strings()
        assertTrue(display.hasConfig)
        assertEquals(18, display.configItems.size)
        assertEquals("models2", metric(display.configItems, s.model))
        assertEquals("MidnightSilver", metric(display.configItems, s.color))
        // cleanNil('<nil>') -> em-dash; absent sunroof -> em-dash (the web 'Not Installed' fallback adaptation).
        assertEquals(VEHICLE_CHARTS_EM_DASH, metric(display.configItems, s.trim))
        assertEquals(VEHICLE_CHARTS_EM_DASH, metric(display.configItems, s.sunroof))
        // Boolean words: europe=false -> No, rhd=true -> Yes, remoteStart=true -> Active, lightbar=false -> No.
        assertEquals(s.no, metric(display.configItems, s.europeVehicle))
        assertEquals(s.yes, metric(display.configItems, s.rhd))
        assertEquals(s.active, metric(display.configItems, s.remoteStart))
        assertEquals(s.no, metric(display.configItems, s.offroadLightbar))
        // Absent software version -> the keyed "None"; percentages render "N%".
        assertEquals(s.none, metric(display.configItems, s.swUpdate))
        assertEquals("100%", metric(display.configItems, s.swDownload))
        assertEquals("40%", metric(display.configItems, s.swInstall))
    }

    @Test
    fun projectOmitsTheConfigurationGridWhenAbsent() {
        val display = VehicleChartsProjection.project(VehicleChartsSnapshot(), defaultPrefs, strings(), zone)
        assertFalse(display.hasConfig)
        assertTrue(display.configItems.isEmpty())
    }

    // ── project: the preference grid ─────────────────────────────────────────────

    @Test
    fun projectBuildsTheFivePreferenceCells() {
        val display = VehicleChartsProjection.project(fullSnapshot(), defaultPrefs, strings(), zone)
        val s = strings()
        assertTrue(display.hasPreferences)
        assertEquals(5, display.preferenceItems.size)
        assertEquals("Miles", metric(display.preferenceItems, s.prefDistance))
        assertEquals("Celsius", metric(display.preferenceItems, s.prefTemperature))
        assertEquals("Percent", metric(display.preferenceItems, s.prefChargeUnit))
        assertEquals("PSI", metric(display.preferenceItems, s.prefTirePressure))
        assertEquals(s.yes, metric(display.preferenceItems, s.pref24hTime))
    }

    @Test
    fun projectOmitsThePreferenceGridWhenAbsent() {
        val display = VehicleChartsProjection.project(VehicleChartsSnapshot(), defaultPrefs, strings(), zone)
        assertFalse(display.hasPreferences)
        assertTrue(display.preferenceItems.isEmpty())
    }

    // ── formatTime: localized short time / em-dash fallback ──────────────────────

    @Test
    fun formatTimeRendersAShortTimeAndFallsBackToEmDash() {
        assertEquals(VEHICLE_CHARTS_EM_DASH, VehicleChartsProjection.formatTime(null, Locale.US, zone))
        assertEquals(VEHICLE_CHARTS_EM_DASH, VehicleChartsProjection.formatTime("   ", Locale.US, zone))
        assertEquals(VEHICLE_CHARTS_EM_DASH, VehicleChartsProjection.formatTime("not-a-date", Locale.US, zone))
        val formatted = VehicleChartsProjection.formatTime("2026-03-14T09:15:00Z", Locale.US, zone)
        assertNotEquals(VEHICLE_CHARTS_EM_DASH, formatted)
        assertTrue(formatted.isNotBlank())
    }
}
