// Off-device verification of the LiveTelemetry feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the six-panel projection (the web component's per-panel data
// derivations), every value helper (web `fmtNumber` / `fmtInt` / `cleanNil` / `getPressureColor` / gear +
// status tones / door + window counts), the SI→display unit boundary (web `toXDisplay` props via the shared
// UnitFormatter), the per-panel loading branch (null input → null content → the skeleton), the within-panel
// empty branches (em dash / no-active-modes / no-saved-location), the i18n key mirrors (a11y/label coverage)
// and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livetelemetry

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveTelemetryModelTest {
    private val metric = UnitFormatter.default()
    private val imperial =
        UnitFormatter(
            UnitPref(
                distance = DistanceUnitPref.MI,
                speed = SpeedUnitPref.MPH,
                temperature = TemperatureUnitPref.FAHRENHEIT,
                pressure = PressureUnitPref.PSI,
                energy = EnergyUnitPref.KWH,
                duration = DurationUnitPref.HOURS,
                power = PowerUnitPref.KW,
                locale = "en-US",
            ),
        )

    private val fullData =
        LiveTelemetryData(
            motor = MotorLive(diTorque = 280.0, diStatorTempC = 41.0, gear = "D", lateralAccel = 0.12, longitudinalAccel = -0.41),
            climate =
                ClimateLive(
                    insideTempC = 21.0,
                    outsideTempC = 8.0,
                    hvacPowerKw = 3.4,
                    hvacFanSpeed = 4.0,
                    defrostMode = "Front",
                    batteryHeaterOn = true,
                ),
            security =
                SecurityLive(
                    locked = true,
                    sentryMode = true,
                    doorState = "Closed,Open,Closed,Closed",
                    fdWindow = "Closed",
                    rpWindow = "Open",
                ),
            tire = TirePressureLive(frontLeft = 2.4, frontRight = 2.5, rearLeft = 2.6, rearRight = 2.8),
            media =
                MediaLive(
                    nowPlayingTitle = "Starlight",
                    nowPlayingArtist = "Muse",
                    playbackStatus = "Playing",
                    audioVolume = 7.0,
                    audioVolumeMax = 11.0,
                ),
            location =
                LocationLive(
                    destinationName = "Supercharger",
                    metersToArrival = 12000.0,
                    minutesToArrival = 9.0,
                    locatedAtHome = true,
                ),
        )

    // ── Adapter: project() maps every panel; absent inputs select the loading skeleton ──

    @Test
    fun projectMapsEveryPanelWhenAllInputsPresent() {
        val display = LiveTelemetryProjection.project(fullData, metric)
        assertTrue(display.drivetrain != null)
        assertTrue(display.climate != null)
        assertTrue(display.security != null)
        assertTrue(display.tire != null)
        assertTrue(display.media != null)
        assertTrue(display.navigation != null)
    }

    @Test
    fun projectTreatsEveryAbsentInputAsTheLoadingSkeleton() {
        val display = LiveTelemetryProjection.project(LiveTelemetryData(), metric)
        assertNull(display.drivetrain)
        assertNull(display.climate)
        assertNull(display.security)
        assertNull(display.tire)
        assertNull(display.media)
        assertNull(display.navigation)
    }

    // ── Drivetrain ──

    @Test
    fun drivetrainFormatsTorqueTempGearAndGforce() {
        val content = LiveTelemetryProjection.drivetrain(fullData.motor, metric)!!
        assertEquals("280 Nm", content.torqueText)
        assertEquals("41\u00B0C", content.motorTempText)
        assertEquals("D", content.gearText)
        assertEquals(BadgeTone.Success, content.gearTone)
        assertEquals("0.41g", content.gforceText)
    }

    @Test
    fun drivetrainConvertsStatorTempToTheDisplayUnit() {
        val content = LiveTelemetryProjection.drivetrain(MotorLive(diStatorTempC = 41.0), imperial)!!
        assertEquals("106\u00B0F", content.motorTempText)
    }

    @Test
    fun drivetrainEmptyValuesFallToTheEmDashAndNullGear() {
        val content = LiveTelemetryProjection.drivetrain(MotorLive(), metric)!!
        assertEquals(EM_DASH, content.torqueText)
        assertEquals(EM_DASH, content.motorTempText)
        assertNull(content.gearText)
        assertEquals(BadgeTone.Neutral, content.gearTone)
        assertEquals(EM_DASH, content.gforceText)
    }

    @Test
    fun drivetrainGforceTakesTheLargerAxisAndShowsWhenEitherIsPresent() {
        assertEquals("0.41g", LiveTelemetryProjection.gforceText(0.12, -0.41))
        assertEquals("0.30g", LiveTelemetryProjection.gforceText(0.30, null))
        assertEquals("0.18g", LiveTelemetryProjection.gforceText(null, -0.18))
        assertEquals(EM_DASH, LiveTelemetryProjection.gforceText(null, null))
    }

    @Test
    fun drivetrainGearToneMirrorsTheWebTernary() {
        assertEquals(BadgeTone.Success, LiveTelemetryProjection.gearTone("D"))
        assertEquals(BadgeTone.Danger, LiveTelemetryProjection.gearTone("R"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryProjection.gearTone("P"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryProjection.gearTone(null))
    }

    @Test
    fun drivetrainTorqueIsTheRawNumberWithoutGroupingOrTrailingZero() {
        assertEquals("1280 Nm", LiveTelemetryProjection.drivetrain(MotorLive(diTorque = 1280.0), metric)!!.torqueText)
        assertEquals("280.5 Nm", LiveTelemetryProjection.drivetrain(MotorLive(diTorque = 280.5), metric)!!.torqueText)
    }

    // ── Climate ──

    @Test
    fun climateFormatsTempsHvacFanAndChips() {
        val content = LiveTelemetryProjection.climate(fullData.climate, metric)!!
        assertEquals("21\u00B0C", content.cabinText)
        assertEquals("8\u00B0C", content.outsideText)
        assertEquals("3.4 kW", content.hvacPowerText)
        assertEquals("4/6", content.fanLabel)
        assertEquals(4f / 6f, content.fanFraction, FLOAT_TOLERANCE)
        assertEquals(listOf(ClimateChip.Defrost, ClimateChip.BatHeater), content.chips)
    }

    @Test
    fun climateEmptyValuesFallToTheEmDashZeroFanAndNoChips() {
        val content = LiveTelemetryProjection.climate(ClimateLive(), metric)!!
        assertEquals(EM_DASH, content.cabinText)
        assertEquals(EM_DASH, content.outsideText)
        assertEquals(EM_DASH, content.hvacPowerText)
        assertEquals("0/6", content.fanLabel)
        assertEquals(0f, content.fanFraction, FLOAT_TOLERANCE)
        assertTrue(content.chips.isEmpty())
    }

    @Test
    fun climateChipsRespectTheDefrostOffSentinelAndHeaterFlag() {
        assertEquals(listOf(ClimateChip.Defrost), LiveTelemetryProjection.climateChips("Front", false))
        assertEquals(listOf(ClimateChip.BatHeater), LiveTelemetryProjection.climateChips("Off", true))
        assertEquals(emptyList<ClimateChip>(), LiveTelemetryProjection.climateChips("Off", false))
        assertEquals(emptyList<ClimateChip>(), LiveTelemetryProjection.climateChips(null, false))
        assertEquals(emptyList<ClimateChip>(), LiveTelemetryProjection.climateChips("   ", false))
    }

    // ── Security ──

    @Test
    fun securityCountsOpenDoorsAndWindowsAndCarriesTheLockSentryFlags() {
        val content = LiveTelemetryProjection.security(fullData.security)!!
        assertTrue(content.locked)
        assertTrue(content.sentryOn)
        assertEquals(1, content.openDoors)
        assertEquals(1, content.openWindows)
        assertEquals(BadgeTone.Warning, content.doorsTone)
        assertEquals(BadgeTone.Warning, content.windowsTone)
    }

    @Test
    fun securityAllClosedGivesSuccessTones() {
        val content =
            LiveTelemetryProjection.security(
                SecurityLive(doorState = "Closed,Closed", fdWindow = "Closed", fpWindow = "closed"),
            )!!
        assertEquals(0, content.openDoors)
        assertEquals(0, content.openWindows)
        assertEquals(BadgeTone.Success, content.doorsTone)
        assertEquals(BadgeTone.Success, content.windowsTone)
    }

    @Test
    fun securityDoorCountIgnoresBlankSegmentsAndIsCaseInsensitive() {
        assertEquals(2, LiveTelemetryProjection.openDoorCount("Open, ,OPEN,Closed"))
        assertEquals(0, LiveTelemetryProjection.openDoorCount(""))
        assertEquals(0, LiveTelemetryProjection.openDoorCount(null))
    }

    @Test
    fun securityWindowCountTreatsNullAndClosedAndEmptyAsClosed() {
        val content =
            LiveTelemetryProjection.security(
                SecurityLive(fdWindow = "Open", fpWindow = "closed", rdWindow = null, rpWindow = ""),
            )!!
        assertEquals(1, content.openWindows)
    }

    // ── Tire pressure ──

    @Test
    fun tireFormatsEachCornerValueColorAndUnit() {
        val content = LiveTelemetryProjection.tire(fullData.tire, metric)!!
        assertEquals(
            listOf(TireCorner.FrontLeft, TireCorner.FrontRight, TireCorner.RearLeft, TireCorner.RearRight),
            content.cells.map { it.corner },
        )
        assertEquals(listOf("2.4", "2.5", "2.6", "2.8"), content.cells.map { it.valueText })
        assertEquals("bar", content.unitLabel)
        assertTrue(content.allNormal)
    }

    @Test
    fun tireConvertsTheBarValueToTheDisplayPressureUnit() {
        val content = LiveTelemetryProjection.tire(TirePressureLive(frontLeft = 2.8), imperial)!!
        assertEquals("40.6", content.cells.first().valueText)
        assertEquals("psi", content.unitLabel)
    }

    @Test
    fun tireColorMirrorsTheWebGetPressureColorBands() {
        assertEquals(TireColor.Muted, LiveTelemetryProjection.pressureColor(null))
        assertEquals(TireColor.Danger, LiveTelemetryProjection.pressureColor(2.0))
        assertEquals(TireColor.Danger, LiveTelemetryProjection.pressureColor(3.2))
        assertEquals(TireColor.Warn, LiveTelemetryProjection.pressureColor(2.1))
        assertEquals(TireColor.Warn, LiveTelemetryProjection.pressureColor(2.95))
        assertEquals(TireColor.Normal, LiveTelemetryProjection.pressureColor(2.6))
    }

    @Test
    fun tireAllNormalTreatsNullAsNormalButFlagsAnyOutOfBandReading() {
        val allGood =
            LiveTelemetryProjection.tire(
                TirePressureLive(frontLeft = 2.4, frontRight = null, rearLeft = 2.5, rearRight = 2.6),
                metric,
            )!!
        assertTrue(allGood.allNormal)
        // A muted (null) corner stays muted even when the badge counts it as normal.
        assertEquals(TireColor.Muted, allGood.cells[1].color)
        val oneSoft =
            LiveTelemetryProjection.tire(
                TirePressureLive(frontLeft = 2.1, frontRight = 2.5, rearLeft = 2.6, rearRight = 2.8),
                metric,
            )!!
        assertFalse(oneSoft.allNormal)
    }

    @Test
    fun tireMissingCornerValueRendersTheEmDash() {
        val content = LiveTelemetryProjection.tire(TirePressureLive(frontLeft = null), metric)!!
        assertEquals(EM_DASH, content.cells.first().valueText)
    }

    // ── Media ──

    @Test
    fun mediaFormatsTitleArtistStatusAndVolume() {
        val content = LiveTelemetryProjection.media(fullData.media)!!
        assertEquals("Starlight", content.title)
        assertEquals("Muse", content.artist)
        assertEquals("Playing", content.statusText)
        assertEquals(BadgeTone.Success, content.statusTone)
        assertEquals("7/11", content.volumeText)
        assertEquals(7f / 11f, content.volumeFraction, FLOAT_TOLERANCE)
    }

    @Test
    fun mediaEmptyValuesFallToTheEmDashNullArtistAndZeroVolume() {
        val content = LiveTelemetryProjection.media(MediaLive())!!
        assertEquals(EM_DASH, content.title)
        assertNull(content.artist)
        assertNull(content.statusText)
        assertEquals(BadgeTone.Neutral, content.statusTone)
        assertEquals(EM_DASH, content.volumeText)
        assertEquals(0f, content.volumeFraction, FLOAT_TOLERANCE)
    }

    @Test
    fun mediaStatusToneMirrorsTheWebTernary() {
        assertEquals(BadgeTone.Success, LiveTelemetryProjection.statusTone("Playing"))
        assertEquals(BadgeTone.Warning, LiveTelemetryProjection.statusTone("Paused"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryProjection.statusTone("Stopped"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryProjection.statusTone(null))
    }

    @Test
    fun mediaVolumeLabelHandlesPartialReadingsLikeTheWeb() {
        assertEquals("7/11", LiveTelemetryProjection.volumeText(7.0, 11.0))
        assertEquals("7", LiveTelemetryProjection.volumeText(7.0, null))
        assertEquals("$EM_DASH/11", LiveTelemetryProjection.volumeText(null, 11.0))
        assertEquals(EM_DASH, LiveTelemetryProjection.volumeText(null, null))
        assertEquals(0f, LiveTelemetryProjection.volumeFraction(7.0, 0.0), FLOAT_TOLERANCE)
    }

    // ── Navigation ──

    @Test
    fun navigationFormatsDestinationDistanceEtaAndLocationChips() {
        val content = LiveTelemetryProjection.navigation(fullData.location, metric)!!
        assertEquals("Supercharger", content.destinationText)
        assertEquals("12.0 km", content.distanceText)
        assertEquals("9 min", content.etaText)
        assertEquals(listOf(NavLocation.Home), content.locations)
    }

    @Test
    fun navigationConvertsDistanceToTheDisplayUnit() {
        val content = LiveTelemetryProjection.navigation(LocationLive(metersToArrival = 12000.0), imperial)!!
        assertEquals("7.5 mi", content.distanceText)
    }

    @Test
    fun navigationEmptyValuesFallToTheEmDashAndNoSavedLocation() {
        val content = LiveTelemetryProjection.navigation(LocationLive(), metric)!!
        assertEquals(EM_DASH, content.destinationText)
        assertEquals(EM_DASH, content.distanceText)
        assertEquals(EM_DASH, content.etaText)
        assertTrue(content.locations.isEmpty())
    }

    @Test
    fun navigationSavedLocationsKeepWebOrder() {
        val all = LocationLive(locatedAtHome = true, locatedAtWork = true, locatedAtFavorite = true)
        assertEquals(listOf(NavLocation.Home, NavLocation.Work, NavLocation.Favorite), LiveTelemetryProjection.savedLocations(all))
    }

    // ── shared value helpers ──

    @Test
    fun cleanNilFiltersGoNilRepresentationsAndEmpty() {
        assertNull(LiveTelemetryProjection.cleanNil(null))
        assertNull(LiveTelemetryProjection.cleanNil(""))
        assertNull(LiveTelemetryProjection.cleanNil("<nil>"))
        assertNull(LiveTelemetryProjection.cleanNil("nil"))
        assertNull(LiveTelemetryProjection.cleanNil("null"))
        assertEquals("Muse", LiveTelemetryProjection.cleanNil("Muse"))
    }

    @Test
    fun jsNumberDropsTheTrailingZeroForIntegralValues() {
        assertEquals("280", LiveTelemetryProjection.jsNumber(280.0))
        assertEquals("0", LiveTelemetryProjection.jsNumber(0.0))
        assertEquals("280.5", LiveTelemetryProjection.jsNumber(280.5))
    }

    @Test
    fun hvacPowerGuardsNonFiniteInput() {
        assertEquals("3.4 kW", LiveTelemetryProjection.hvacPowerText(3.4))
        assertEquals(EM_DASH, LiveTelemetryProjection.hvacPowerText(null))
        assertEquals(EM_DASH, LiveTelemetryProjection.hvacPowerText(Double.NaN))
    }

    // ── i18n key mirrors (every web `t('telemetry.*')` key resolves to a generated resource name) ──

    @Test
    fun i18nKeyMirrorsFollowTheGeneratedTelemetryNamespace() {
        assertEquals("translation_telemetry_title", LiveTelemetryKeys.TITLE)
        assertEquals("translation_telemetry_drivetrain", LiveTelemetryKeys.DRIVETRAIN)
        assertEquals("translation_telemetry_climate", LiveTelemetryKeys.CLIMATE)
        assertEquals("translation_telemetry_security", LiveTelemetryKeys.SECURITY)
        assertEquals("translation_telemetry_tirePressure", LiveTelemetryKeys.TIRE_PRESSURE)
        assertEquals("translation_telemetry_media", LiveTelemetryKeys.MEDIA)
        assertEquals("translation_telemetry_navigation", LiveTelemetryKeys.NAVIGATION)
        assertEquals("translation_telemetry_torque", LiveTelemetryKeys.TORQUE)
        assertEquals("translation_telemetry_motorTemp", LiveTelemetryKeys.MOTOR_TEMP)
        assertEquals("translation_telemetry_gear", LiveTelemetryKeys.GEAR)
        assertEquals("translation_telemetry_gforce", LiveTelemetryKeys.GFORCE)
        assertEquals("translation_telemetry_cabin", LiveTelemetryKeys.CABIN)
        assertEquals("translation_telemetry_outside", LiveTelemetryKeys.OUTSIDE)
        assertEquals("translation_telemetry_hvac", LiveTelemetryKeys.HVAC)
        assertEquals("translation_telemetry_fan", LiveTelemetryKeys.FAN)
        assertEquals("translation_telemetry_defrost", LiveTelemetryKeys.DEFROST)
        assertEquals("translation_telemetry_batHeater", LiveTelemetryKeys.BAT_HEATER)
        assertEquals("translation_telemetry_noModes", LiveTelemetryKeys.NO_MODES)
        assertEquals("translation_telemetry_lock", LiveTelemetryKeys.LOCK)
        assertEquals("translation_telemetry_locked", LiveTelemetryKeys.LOCKED)
        assertEquals("translation_telemetry_unlocked", LiveTelemetryKeys.UNLOCKED)
        assertEquals("translation_telemetry_sentry", LiveTelemetryKeys.SENTRY)
        assertEquals("translation_telemetry_active", LiveTelemetryKeys.ACTIVE)
        assertEquals("translation_telemetry_off", LiveTelemetryKeys.OFF)
        assertEquals("translation_telemetry_doors", LiveTelemetryKeys.DOORS)
        assertEquals("translation_telemetry_allClosed", LiveTelemetryKeys.ALL_CLOSED)
        assertEquals("translation_telemetry_open", LiveTelemetryKeys.OPEN)
        assertEquals("translation_telemetry_windows", LiveTelemetryKeys.WINDOWS)
        assertEquals("translation_telemetry_allNormal", LiveTelemetryKeys.ALL_NORMAL)
        assertEquals("translation_telemetry_warning", LiveTelemetryKeys.WARNING)
        assertEquals("translation_telemetry_unknownArtist", LiveTelemetryKeys.UNKNOWN_ARTIST)
        assertEquals("translation_telemetry_status", LiveTelemetryKeys.STATUS)
        assertEquals("translation_telemetry_volume", LiveTelemetryKeys.VOLUME)
        assertEquals("translation_telemetry_destination", LiveTelemetryKeys.DESTINATION)
        assertEquals("translation_telemetry_distance", LiveTelemetryKeys.DISTANCE)
        assertEquals("translation_telemetry_eta", LiveTelemetryKeys.ETA)
        assertEquals("translation_telemetry_home", LiveTelemetryKeys.HOME)
        assertEquals("translation_telemetry_work", LiveTelemetryKeys.WORK)
        assertEquals("translation_telemetry_favorite", LiveTelemetryKeys.FAVORITE)
        assertEquals("translation_telemetry_noSavedLocation", LiveTelemetryKeys.NO_SAVED_LOCATION)
    }

    // ── diagnostics (PII-safe view.opened) ──

    @Test
    fun diagnosticsEmitsViewOpenedWithOnlyTheSurfaceSlug() {
        assertEquals("LiveTelemetry", LiveTelemetryDiagnostics.SLUG)
        val logger = RecordingLogger()
        LiveTelemetryDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "LiveTelemetry"), record.fields)
    }

    private data class LogEntry(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogEntry>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogEntry(level, event, fields))
        }
    }

    private companion object {
        const val FLOAT_TOLERANCE = 0.0001f
    }
}
