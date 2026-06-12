// Off-device verification of the LiveTelemetryPanels feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label coverage). Exercises the seven-panel projection (the web component's per-panel data
// derivations across LiveTelemetryPanels.tsx and its child panels), every value helper (web `fmtNumber` /
// `fmtInt` / `fmtWithUnit` / `cleanNil` / `convertDistanceFromSI` / the gear + charging + status tones / the
// tire Pascal bands / the `x || '—'` truthiness), the SI→display unit boundary (web `useUnits` via the shared
// UnitFormatter), the per-panel present-vs-empty branches (present input → content, absent input → null →
// the panel's empty surface), the always-rendered Vehicle State + Media panels, the within-panel em-dash /
// "Off" / "Unknown" fallbacks, the i18n key mirrors (a11y/label coverage), and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration", "LargeClass")

package io.teslasync.android.featureviews.livetelemetrypanels

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
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveTelemetryPanelsModelTest {
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
    private val precisionZero =
        UnitFormatter(metric.prefs.copy(precision = 0))

    private val fullData =
        LiveTelemetryPanelsData(
            motor =
                MotorSnapshotLive(
                    shiftState = "D",
                    powerKw = 142.0,
                    motorRpmFront = 3200.0,
                    motorRpmRear = 3210.0,
                    torqueNmFront = 180.0,
                    torqueNmRear = 210.0,
                    motorTempCFront = 54.0,
                    motorTempCRear = 61.0,
                    inverterTempC = 48.0,
                    regenKw = 22.0,
                ),
            climate =
                ClimateSnapshotLive(
                    insideTempC = 21.0,
                    outsideTempC = 8.0,
                    driverSetpointC = 21.0,
                    passengerSetpointC = 20.0,
                    hvacState = "On",
                    defrostMode = "Front",
                    isClimateOn = true,
                    isPreconditioning = false,
                    fanStatus = 4.0,
                ),
            security =
                SecurityEventLive(
                    doorsOpen = "Closed",
                    windowsOpen = "Closed",
                    locked = true,
                    sentryMode = true,
                    userPresent = true,
                    detail = "All systems nominal",
                ),
            vehicleState =
                VehicleStateLive(
                    lightsHighBeams = false,
                    lightsTurnSignal = "Left",
                    lightsHazards = false,
                    driverSeatOccupied = true,
                    pairedKeyCount = JsonPrimitive(3),
                    valetMode = false,
                    serviceMode = false,
                    speedLimitMode = false,
                    centerDisplay = JsonPrimitive("Drive"),
                    homelinkDeviceCount = JsonPrimitive(2),
                ),
            sseConnected = true,
            tire = TirePressureLive(frontLeft = 290_000.0, frontRight = 285_000.0, rearLeft = 295_000.0, rearRight = 300_000.0),
            charging =
                ChargingTelemetryLive(
                    batteryLevel = 72.0,
                    chargingState = "Charging",
                    chargerVoltage = 240.0,
                    chargerActualCurrent = 32.0,
                    chargerPowerW = 11_000.0,
                    chargeEnergyAddedWh = 18_400.0,
                    rangeAddedMetersPerHour = 48_280.0,
                ),
            media =
                MediaSnapshotLive(
                    nowPlayingTitle = "Starlight",
                    nowPlayingArtist = "Muse",
                    playbackStatus = "Playing",
                    playbackSource = "Spotify",
                ),
            location =
                LocationSnapshotLive(
                    destinationName = "Supercharger",
                    metersToArrival = 12_350.0,
                    minutesToArrival = 9.0,
                    locatedAtHome = false,
                    locatedAtWork = true,
                ),
            remoteStartEnabled = true,
        )

    // ── Adapter: project() maps each data-bearing panel; absent inputs select the empty surface ──

    @Test
    fun projectMapsEveryPanelWhenAllInputsPresent() {
        val display = LiveTelemetryPanelsProjection.project(fullData, metric)
        assertNotNull(display.powertrain)
        assertNotNull(display.climate)
        assertNotNull(display.security)
        assertNotNull(display.tire)
        assertNotNull(display.energy)
        assertNotNull(display.media.nowPlaying)
        assertNotNull(display.media.navigation)
        assertTrue(display.sseConnected)
    }

    @Test
    fun projectTreatsAbsentDataBearingInputsAsTheEmptySurface() {
        val display = LiveTelemetryPanelsProjection.project(LiveTelemetryPanelsData(), metric)
        assertNull(display.powertrain)
        assertNull(display.climate)
        assertNull(display.security)
        assertNull(display.tire)
        assertNull(display.energy)
        // Media always renders, with each sub-section empty.
        assertNull(display.media.nowPlaying)
        assertNull(display.media.navigation)
        assertFalse(display.sseConnected)
    }

    @Test
    fun vehicleStateAlwaysProjectsEvenWithNoData() {
        val display = LiveTelemetryPanelsProjection.project(LiveTelemetryPanelsData(), metric)
        // The web VehicleStatePanel has no empty branch — it always renders its rows.
        assertEquals(EM_DASH, display.vehicleState.pairedKeysText)
        assertEquals(EM_DASH, display.vehicleState.centerDisplayText)
        assertFalse(display.vehicleState.highBeamsOn)
    }

    // ── Powertrain ──

    @Test
    fun powertrainFormatsShiftPowerRpmTorqueTempsAndRegen() {
        val content = LiveTelemetryPanelsProjection.powertrain(fullData.motor, metric)!!
        assertEquals("D", content.shiftText)
        assertEquals(BadgeTone.Success, content.shiftTone)
        assertEquals("142.00 kW", content.powerText)
        assertEquals(true, content.powerFill?.positive)
        assertEquals("3,200", content.rpmFrontText)
        assertEquals("3,210", content.rpmRearText)
        assertEquals("180.00", content.torqueFrontText)
        assertEquals("210.00", content.torqueRearText)
        assertEquals("61.0\u00B0C", content.motorTempText)
        assertFalse(content.motorTempHot)
        assertEquals("48.0\u00B0C", content.inverterTempText)
        assertEquals("22.00 kW", content.regenText)
    }

    @Test
    fun powertrainPeakMotorTempFlagsHotAboveEighty() {
        val hot = LiveTelemetryPanelsProjection.powertrain(MotorSnapshotLive(motorTempCFront = 70.0, motorTempCRear = 85.0), metric)!!
        assertEquals("85.0\u00B0C", hot.motorTempText)
        assertTrue(hot.motorTempHot)
    }

    @Test
    fun powertrainPeakMotorTempTakesTheLargerPresentAxis() {
        assertEquals(61.0, LiveTelemetryPanelsProjection.peakMotorTemp(54.0, 61.0))
        assertEquals(54.0, LiveTelemetryPanelsProjection.peakMotorTemp(54.0, null))
        assertEquals(61.0, LiveTelemetryPanelsProjection.peakMotorTemp(null, 61.0))
        assertNull(LiveTelemetryPanelsProjection.peakMotorTemp(null, null))
    }

    @Test
    fun powertrainEmptyValuesFallToTheEmDashAndNoBar() {
        val content = LiveTelemetryPanelsProjection.powertrain(MotorSnapshotLive(), metric)!!
        assertEquals(EM_DASH, content.powerText)
        assertNull(content.powerFill)
        assertEquals(EM_DASH, content.rpmFrontText)
        assertEquals(EM_DASH, content.torqueRearText)
        assertEquals(EM_DASH, content.motorTempText)
        assertEquals(EM_DASH, content.inverterTempText)
        assertEquals(EM_DASH, content.regenText)
        assertNull(content.shiftText)
        assertEquals(BadgeTone.Neutral, content.shiftTone)
    }

    @Test
    fun powerFillPicksSideAndClampsMagnitude() {
        val positive = LiveTelemetryPanelsProjection.powerFill(150.0)!!
        assertTrue(positive.positive)
        assertEquals(0.5f, positive.fraction, FLOAT_TOLERANCE)
        val negative = LiveTelemetryPanelsProjection.powerFill(-450.0)!!
        assertFalse(negative.positive)
        assertEquals(1f, negative.fraction, FLOAT_TOLERANCE)
        assertNull(LiveTelemetryPanelsProjection.powerFill(null))
    }

    @Test
    fun shiftToneMirrorsTheWebTernary() {
        assertEquals(BadgeTone.Success, LiveTelemetryPanelsProjection.shiftTone("D"))
        assertEquals(BadgeTone.Danger, LiveTelemetryPanelsProjection.shiftTone("R"))
        assertEquals(BadgeTone.Warning, LiveTelemetryPanelsProjection.shiftTone("N"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryPanelsProjection.shiftTone("P"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryPanelsProjection.shiftTone(null))
    }

    // ── Climate ──

    @Test
    fun climateFormatsTempsFanAndModeFlags() {
        val content = LiveTelemetryPanelsProjection.climate(fullData.climate, metric)!!
        assertEquals("21.0\u00B0C", content.cabinText)
        assertEquals("8.0\u00B0C", content.outsideText)
        assertEquals("21.0\u00B0C", content.driverSetpointText)
        assertEquals("20.0\u00B0C", content.passengerSetpointText)
        assertEquals("On", content.hvacStateText)
        assertEquals(4, content.fanLevel)
        assertTrue(content.defrostActive)
        assertEquals("Front", content.defrostModeValue)
        assertTrue(content.climateOn)
        assertFalse(content.preconditioning)
    }

    @Test
    fun climateEmptyValuesFallToTheEmDashZeroFanAndInactiveModes() {
        val content = LiveTelemetryPanelsProjection.climate(ClimateSnapshotLive(), metric)!!
        assertEquals(EM_DASH, content.cabinText)
        assertEquals(EM_DASH, content.hvacStateText)
        assertEquals(0, content.fanLevel)
        assertFalse(content.defrostActive)
        assertNull(content.defrostModeValue)
        assertFalse(content.climateOn)
        assertFalse(content.preconditioning)
    }

    @Test
    fun climateDefrostRespectsTheOffSentinel() {
        assertTrue(LiveTelemetryPanelsProjection.showsDefrost("Front"))
        assertFalse(LiveTelemetryPanelsProjection.showsDefrost("Off"))
        assertFalse(LiveTelemetryPanelsProjection.showsDefrost(null))
        assertFalse(LiveTelemetryPanelsProjection.showsDefrost("   "))
    }

    @Test
    fun climateFanClampsToTheSixBarScale() {
        assertEquals(FAN_BAR_COUNT, LiveTelemetryPanelsProjection.climate(ClimateSnapshotLive(fanStatus = 9.0), metric)!!.fanLevel)
        assertEquals(0, LiveTelemetryPanelsProjection.climate(ClimateSnapshotLive(fanStatus = -1.0), metric)!!.fanLevel)
    }

    // ── Security ──

    @Test
    fun securityCarriesRowsAndRemoteStartWhenBothPresent() {
        val content = LiveTelemetryPanelsProjection.security(fullData.security, true)!!
        val rows = content.rows!!
        assertTrue(rows.locked)
        assertTrue(rows.sentryOn)
        assertEquals("Closed", rows.doorsValue)
        assertEquals("Closed", rows.windowsValue)
        assertTrue(rows.userPresent)
        assertEquals("All systems nominal", rows.detail)
        assertEquals(RemoteStartState.Enabled, content.remoteStart)
    }

    @Test
    fun securityIsTheEmptySurfaceOnlyWhenBothInputsAbsent() {
        assertNull(LiveTelemetryPanelsProjection.security(null, null))
    }

    @Test
    fun securityShowsOnlyRemoteStartWhenEventAbsent() {
        val content = LiveTelemetryPanelsProjection.security(null, false)!!
        assertNull(content.rows)
        assertEquals(RemoteStartState.Disabled, content.remoteStart)
    }

    @Test
    fun securityShowsOnlyRowsWhenRemoteStartUnknown() {
        val content = LiveTelemetryPanelsProjection.security(SecurityEventLive(locked = false), null)!!
        assertNotNull(content.rows)
        assertFalse(content.rows!!.locked)
        assertEquals(RemoteStartState.Unknown, content.remoteStart)
    }

    @Test
    fun securityDropsBlankDetailAndDefaultsFlags() {
        val content = LiveTelemetryPanelsProjection.security(SecurityEventLive(detail = ""), null)!!
        val rows = content.rows!!
        assertNull(rows.detail)
        assertFalse(rows.locked)
        assertFalse(rows.sentryOn)
        assertNull(rows.doorsValue)
    }

    @Test
    fun remoteStartTriStateMirrorsTheWebRead() {
        assertEquals(RemoteStartState.Unknown, LiveTelemetryPanelsProjection.remoteStartState(null))
        assertEquals(RemoteStartState.Enabled, LiveTelemetryPanelsProjection.remoteStartState(true))
        assertEquals(RemoteStartState.Disabled, LiveTelemetryPanelsProjection.remoteStartState(false))
    }

    // ── Vehicle State ──

    @Test
    fun vehicleStatePassesThroughTheLiveSignals() {
        val content = LiveTelemetryPanelsProjection.vehicleState(fullData.vehicleState, metric)
        assertFalse(content.highBeamsOn)
        assertEquals("Left", content.turnSignalValue)
        assertFalse(content.hazardsActive)
        assertTrue(content.driverSeatOccupied)
        assertEquals("3", content.pairedKeysText)
        assertEquals("Drive", content.centerDisplayText)
        assertEquals("2", content.homelinkText)
        assertFalse(content.speedLimitActive)
        assertNull(content.speedLimitValue)
    }

    @Test
    fun vehicleStateTurnSignalIsActiveOnlyWhenSetAndNotOff() {
        fun turnSignal(value: String?) =
            LiveTelemetryPanelsProjection.vehicleState(VehicleStateLive(lightsTurnSignal = value), metric).turnSignalValue
        assertEquals("Right", turnSignal("Right"))
        assertNull(turnSignal("Off"))
        assertNull(turnSignal(""))
        assertNull(turnSignal(null))
    }

    @Test
    fun vehicleStateSpeedLimitFormatsTheSiSpeedWhenActive() {
        val content =
            LiveTelemetryPanelsProjection.vehicleState(
                VehicleStateLive(speedLimitMode = true, currentSpeedLimit = 25.0),
                metric,
            )
        assertTrue(content.speedLimitActive)
        assertEquals("90 km/h", content.speedLimitValue)
    }

    @Test
    fun vehicleStateCountsUseTheTruthyFallback() {
        val zeroKeys = LiveTelemetryPanelsProjection.vehicleState(VehicleStateLive(pairedKeyCount = JsonPrimitive(0)), metric)
        val noHomelink = LiveTelemetryPanelsProjection.vehicleState(VehicleStateLive(homelinkDeviceCount = null), metric)
        assertEquals(EM_DASH, zeroKeys.pairedKeysText)
        assertEquals(EM_DASH, noHomelink.homelinkText)
    }

    @Test
    fun truthyTextMirrorsJavaScriptOrFallback() {
        assertEquals("3", LiveTelemetryPanelsProjection.truthyText(JsonPrimitive(3)))
        assertEquals("2", LiveTelemetryPanelsProjection.truthyText(JsonPrimitive("2")))
        assertEquals("0", LiveTelemetryPanelsProjection.truthyText(JsonPrimitive("0")))
        assertNull(LiveTelemetryPanelsProjection.truthyText(JsonPrimitive(0)))
        assertNull(LiveTelemetryPanelsProjection.truthyText(JsonPrimitive("")))
        assertNull(LiveTelemetryPanelsProjection.truthyText(JsonPrimitive(false)))
        assertNull(LiveTelemetryPanelsProjection.truthyText(null))
    }

    // ── Tire Pressure ──

    @Test
    fun tireBuildsFourCornersInWebOrderWithFormattedValues() {
        val content = LiveTelemetryPanelsProjection.tire(fullData.tire, metric)!!
        val order = listOf(TireCorner.FrontLeft, TireCorner.FrontRight, TireCorner.RearLeft, TireCorner.RearRight)
        assertEquals(order, content.cells.map { it.corner })
        assertEquals("2.9 bar", content.cells.first().valueText)
        assertEquals(TireColor.Normal, content.cells.first().color)
        assertEquals(TireStatus.AllNormal, content.status)
    }

    @Test
    fun tireIsTheEmptySurfaceWhenAbsent() {
        assertNull(LiveTelemetryPanelsProjection.tire(null, metric))
    }

    @Test
    fun tireColorBandsMatchTheWebPascalThresholds() {
        assertEquals(TireColor.Muted, LiveTelemetryPanelsProjection.tireColor(null))
        assertEquals(TireColor.Danger, LiveTelemetryPanelsProjection.tireColor(200_000.0))
        assertEquals(TireColor.Danger, LiveTelemetryPanelsProjection.tireColor(350_000.0))
        assertEquals(TireColor.Warn, LiveTelemetryPanelsProjection.tireColor(230_000.0))
        assertEquals(TireColor.Warn, LiveTelemetryPanelsProjection.tireColor(320_000.0))
        assertEquals(TireColor.Normal, LiveTelemetryPanelsProjection.tireColor(275_000.0))
    }

    @Test
    fun tireStatusSummaryMatchesTheWebBadge() {
        assertEquals(TireStatus.AllNormal, LiveTelemetryPanelsProjection.tireStatus(listOf(290_000.0, 285_000.0, 295_000.0, 300_000.0)))
        assertEquals(TireStatus.Attention, LiveTelemetryPanelsProjection.tireStatus(listOf(290_000.0, 285_000.0, 295_000.0, 200_000.0)))
        assertEquals(TireStatus.Check, LiveTelemetryPanelsProjection.tireStatus(listOf(290_000.0, 230_000.0, 295_000.0, 300_000.0)))
        assertEquals(TireStatus.Check, LiveTelemetryPanelsProjection.tireStatus(listOf(290_000.0, 285_000.0, 295_000.0, null)))
    }

    @Test
    fun tirePressureTextBridgesPascalsToTheFormatterAndEmDashesNull() {
        assertEquals("2.9 bar", LiveTelemetryPanelsProjection.tirePressureText(290_000.0, metric))
        assertEquals(EM_DASH, LiveTelemetryPanelsProjection.tirePressureText(null, metric))
    }

    // ── Energy & Charging ──

    @Test
    fun energyFormatsChargerReadsStateLevelAndRate() {
        val content = LiveTelemetryPanelsProjection.energy(fullData.charging, metric)!!
        assertEquals("240.00", content.chargerVoltageText)
        assertEquals("32.00", content.chargerCurrentText)
        assertEquals("11,000.00 kW", content.chargerPowerText)
        assertEquals("18,400.00 kWh", content.energyAddedText)
        assertEquals("Charging", content.chargingStateText)
        assertEquals(BadgeTone.Info, content.chargingTone)
        assertEquals("72.00%", content.batteryLevelText)
        assertEquals("48 km/h", content.chargeRateText)
    }

    @Test
    fun energyEmptyValuesFallToTheEmDash() {
        val content = LiveTelemetryPanelsProjection.energy(ChargingTelemetryLive(), metric)!!
        assertEquals(EM_DASH, content.chargerVoltageText)
        assertEquals(EM_DASH, content.chargerPowerText)
        assertEquals(EM_DASH, content.energyAddedText)
        assertEquals(EM_DASH, content.batteryLevelText)
        assertEquals(EM_DASH, content.chargeRateText)
        assertNull(content.chargingStateText)
        assertEquals(BadgeTone.Neutral, content.chargingTone)
    }

    @Test
    fun energyIsTheEmptySurfaceWhenAbsent() {
        assertNull(LiveTelemetryPanelsProjection.energy(null, metric))
    }

    @Test
    fun chargingToneMirrorsTheWebTernary() {
        assertEquals(BadgeTone.Info, LiveTelemetryPanelsProjection.chargingTone("Charging"))
        assertEquals(BadgeTone.Success, LiveTelemetryPanelsProjection.chargingTone("Complete"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryPanelsProjection.chargingTone("Stopped"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryPanelsProjection.chargingTone(null))
    }

    // ── Media & Navigation ──

    @Test
    fun mediaCleansNowPlayingAndTonesTheStatus() {
        val content = LiveTelemetryPanelsProjection.media(fullData.media, fullData.location, metric).nowPlaying!!
        assertEquals("Starlight", content.titleValue)
        assertEquals("Muse", content.artistValue)
        assertEquals("Spotify", content.sourceValue)
        assertEquals("Playing", content.statusValue)
        assertEquals(BadgeTone.Success, content.statusTone)
    }

    @Test
    fun mediaNowPlayingFiltersGoNilTokens() {
        val content =
            LiveTelemetryPanelsProjection.media(
                MediaSnapshotLive(nowPlayingTitle = "<nil>", nowPlayingArtist = "", playbackStatus = "Paused"),
                null,
                metric,
            )
        assertNull(content.nowPlaying!!.titleValue)
        assertNull(content.nowPlaying.artistValue)
        assertEquals(BadgeTone.Warning, content.nowPlaying.statusTone)
        assertNull(content.navigation)
    }

    @Test
    fun mediaSubSectionsAreEmptyWhenInputsAbsent() {
        val content = LiveTelemetryPanelsProjection.media(null, null, metric)
        assertNull(content.nowPlaying)
        assertNull(content.navigation)
    }

    @Test
    fun navigationBuildsDestinationDistanceEtaAndPlaces() {
        val nav = LiveTelemetryPanelsProjection.media(fullData.media, fullData.location, metric).navigation!!
        val destination = nav.destination!!
        assertEquals("Supercharger", destination.name)
        assertEquals("12.35 km", destination.distanceText)
        assertEquals("9", destination.etaMinutesText)
        assertEquals(listOf(NavPlace.Work), nav.places)
    }

    @Test
    fun navigationShowsNoDestinationButKeepsPlacesWhenNameAbsent() {
        val nav =
            LiveTelemetryPanelsProjection
                .media(null, LocationSnapshotLive(locatedAtHome = true, locatedAtFavorite = true), metric)
                .navigation!!
        assertNull(nav.destination)
        assertEquals(listOf(NavPlace.Home, NavPlace.Favorite), nav.places)
    }

    @Test
    fun navigationDistanceUsesTheImperialUnitAndGlobalPrecision() {
        val nav =
            LiveTelemetryPanelsProjection
                .media(null, LocationSnapshotLive(destinationName = "Home", metersToArrival = 12_350.0), imperial)
                .navigation!!
        assertEquals("7.67 mi", nav.destination!!.distanceText)
    }

    @Test
    fun savedPlacesAreOrderedHomeWorkFavorite() {
        val location = LocationSnapshotLive(locatedAtHome = true, locatedAtWork = true, locatedAtFavorite = true)
        val places = LiveTelemetryPanelsProjection.savedPlaces(location)
        assertEquals(listOf(NavPlace.Home, NavPlace.Work, NavPlace.Favorite), places)
    }

    @Test
    fun statusToneMirrorsTheWebTernary() {
        assertEquals(BadgeTone.Success, LiveTelemetryPanelsProjection.statusTone("Playing"))
        assertEquals(BadgeTone.Warning, LiveTelemetryPanelsProjection.statusTone("Paused"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryPanelsProjection.statusTone("Stopped"))
        assertEquals(BadgeTone.Neutral, LiveTelemetryPanelsProjection.statusTone(null))
    }

    // ── Number / cleanNil helpers ──

    @Test
    fun fmtNumberUsesTheGlobalDecimalPrecisionAndGrouping() {
        assertEquals("142.00", LiveTelemetryPanelsProjection.fmtNumber(142.0, metric))
        assertEquals("11,000.00", LiveTelemetryPanelsProjection.fmtNumber(11_000.0, metric))
        assertEquals("143", LiveTelemetryPanelsProjection.fmtNumber(142.5, precisionZero))
    }

    @Test
    fun fmtIntRoundsAndGroups() {
        assertEquals("3,200", LiveTelemetryPanelsProjection.fmtInt(3200.0))
        assertEquals("10", LiveTelemetryPanelsProjection.fmtInt(9.6))
    }

    @Test
    fun fmtWithUnitAppendsTheVerbatimSuffix() {
        assertEquals("11,000.00 kW", LiveTelemetryPanelsProjection.fmtWithUnit(11_000.0, POWER_KW_UNIT, metric))
        assertEquals("18,400.00 kWh", LiveTelemetryPanelsProjection.fmtWithUnit(18_400.0, ENERGY_KWH_UNIT, metric))
    }

    @Test
    fun cleanNilFiltersGoNilTokensAndEmpty() {
        assertEquals("Drive", LiveTelemetryPanelsProjection.cleanNil("Drive"))
        assertNull(LiveTelemetryPanelsProjection.cleanNil("<nil>"))
        assertNull(LiveTelemetryPanelsProjection.cleanNil("nil"))
        assertNull(LiveTelemetryPanelsProjection.cleanNil("null"))
        assertNull(LiveTelemetryPanelsProjection.cleanNil(""))
        assertNull(LiveTelemetryPanelsProjection.cleanNil(null))
    }

    @Test
    fun distanceTextConvertsFromSiAndAppendsUnit() {
        assertEquals("12.35 km", LiveTelemetryPanelsProjection.distanceText(12_350.0, metric))
        assertEquals("7.67 mi", LiveTelemetryPanelsProjection.distanceText(12_350.0, imperial))
    }

    // ── Diagnostics (PII-safe view.opened) ──

    @Test
    fun diagnosticsSlugMatchesTheSurfaceContract() {
        assertEquals("LiveTelemetryPanels", LiveTelemetryPanelsDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()
        LiveTelemetryPanelsDiagnostics.recordViewOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "LiveTelemetryPanels"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoSignalFields() {
        val logger = RecordingLogger()
        LiveTelemetryPanelsDiagnostics.recordViewOpened(logger)
        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }

    // ── i18n key contract (a11y / label coverage) ──

    @Test
    fun everyMappedKeyTargetsTheTranslationNamespace() {
        val keys =
            listOf(
                LiveTelemetryPanelsKeys.TITLE,
                LiveTelemetryPanelsKeys.POWERTRAIN,
                LiveTelemetryPanelsKeys.CLIMATE,
                LiveTelemetryPanelsKeys.SECURITY,
                LiveTelemetryPanelsKeys.VEHICLE_STATE,
                LiveTelemetryPanelsKeys.TIRE_PRESSURE,
                LiveTelemetryPanelsKeys.ENERGY_CHARGING,
                LiveTelemetryPanelsKeys.MEDIA_NAV,
                LiveTelemetryPanelsKeys.NO_MOTOR_DATA,
                LiveTelemetryPanelsKeys.NO_CLIMATE_DATA,
                LiveTelemetryPanelsKeys.NO_SECURITY_DATA,
                LiveTelemetryPanelsKeys.NO_TIRE_DATA,
                LiveTelemetryPanelsKeys.NO_CHARGING,
                LiveTelemetryPanelsKeys.ATTENTION_NEEDED,
                LiveTelemetryPanelsKeys.LIVE_INDICATOR,
            )
        assertTrue(keys.all { it.startsWith("translation_") })
        assertEquals(keys.size, keys.distinct().size)
    }

    private companion object {
        const val FLOAT_TOLERANCE = 1e-4f
    }

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
}
