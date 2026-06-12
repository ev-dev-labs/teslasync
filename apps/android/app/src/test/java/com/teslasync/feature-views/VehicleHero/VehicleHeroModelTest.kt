// Off-device unit coverage for the dashboard Vehicle Hero feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the header derivation (name / subtitle / status — the web
// `display_name || vin`, `{model} {trim} · {vin}`, `state ?? 'offline'`), the context-aware gauge specs
// (battery / range + conditional speed/charge-power + temps), the charging-detail strings (power / rate /
// time-to-full / done-at), the three stat-card layouts (driving / charging / idle) plus the always-visible
// cards, the SI -> display unit boundary (metric + imperial), the accessible summary (label presence), the
// lifecycle surface classifier (per-state coverage), the web-parity state builder, and the PII-safe
// `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclehero

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class VehicleHeroModelTest {
    private val metric = UnitFormatter.default()
    private val imperial =
        UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_length":"mi","unit_of_temp":"F"}""")))

    private val strings =
        VehicleHeroStrings(
            battery = "Battery",
            range = "Range",
            speed = "Speed",
            power = "Power",
            inside = "Inside",
            outside = "Outside",
            charging = "Charging",
            chargePower = "ChargePower",
            rate = "Rate",
            timeToFull = "Time to Full",
            doneAt = "Done",
            odometer = "Odometer",
            idealRange = "Ideal Range",
            chargeRate = "Charge Rate",
            firmware = "Firmware",
            status = "Status",
            locked = "Locked",
            unlocked = "Unlocked",
            sentry = "Sentry",
            active = "Active",
            off = "Off",
            details = "Details",
            commands = "Commands",
            liveMap = "Live Map",
            digitalTwin = "Digital Twin",
        )

    private val clock: (Long) -> String = { millis -> millis.toString() }

    private val vehicle: Vehicle =
        Json.decodeFromString(
            Vehicle.serializer(),
            """
            {"id":7,"tesla_id":42,"vin":"5YJ3VIN000007","display_name":"My Model 3","model":"Model 3",
             "trim_level":"Long Range","timezone":"UTC","created_at":"2026-01-01T00:00:00Z",
             "enrolled_at":"2026-01-01T00:00:00Z","updated_at":"2026-06-01T00:00:00Z"}
            """.trimIndent(),
        )

    @Suppress("LongParameterList")
    private fun state(
        batteryLevel: Long = 72,
        speed: Double = 0.0,
        power: Double = 0.0,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        timeToFullCharge: Double = 0.0,
        isLocked: Boolean = true,
        sentryMode: Boolean = false,
        insideTemp: Double = 21.5,
        state: String = "online",
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 48_000.0,
            chargerPower = chargerPower,
            idealRange = 380_000.0,
            insideTemp = insideTemp,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = isLocked,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 42_000_000.0,
            outsideTemp = 12.0,
            power = power,
            ratedRange = 350_000.0,
            sentryMode = sentryMode,
            softwareVersion = "2026.20.1",
            speed = speed,
            state = state,
            timeToFullCharge = timeToFullCharge,
            vehicleId = 7L,
        )

    private fun project(
        vehicleState: VehicleState?,
        formatter: UnitFormatter = metric,
        now: Long = 0L,
    ): VehicleHeroDisplay =
        VehicleHeroProjection.project(
            vehicle = vehicle,
            state = vehicleState,
            firmwareVersion = "2026.20.1",
            formatter = formatter,
            strings = strings,
            nowMillis = now,
            locale = Locale.US,
            formatClockTime = clock,
        )

    // ── Header (web `display_name || vin`, `{model} {trim} · {vin}`, `state ?? 'offline'`) ───────────

    @Test
    fun projectsHeaderNameSubtitleStatus() {
        val display = project(state(state = "online"))
        assertEquals("My Model 3", display.name)
        assertEquals("Model 3 Long Range \u00B7 5YJ3VIN000007", display.subtitle)
        assertEquals("online", display.status)
        assertFalse(display.asleep)
    }

    @Test
    fun nameFallsBackToVinAndStatusToOffline() {
        val blankName = vehicle.copy(displayName = "  ")
        val display =
            VehicleHeroProjection.project(blankName, null, "\u2014", metric, strings, 0L, Locale.US, clock)
        assertEquals("5YJ3VIN000007", display.name)
        assertEquals(HERO_OFFLINE, display.status)
        assertTrue(display.asleep)
    }

    // ── Gauges (battery / range + conditional speed / charge-power + temps) ──────────────────────────

    @Test
    fun idleGaugesAreBatteryRangeInsideOutside() {
        val gauges = project(state()).gauges
        assertEquals(listOf("battery", "range", "inside", "outside"), gauges.map { it.key })
        assertEquals(72.0, gauges.first { it.key == "battery" }.value, 0.0)
        assertEquals(HeroAccent.Green, gauges.first { it.key == "battery" }.accent)
        assertEquals(350.0, gauges.first { it.key == "range" }.value, 0.001)
        assertEquals("km", gauges.first { it.key == "range" }.unit)
    }

    @Test
    fun lowBatteryGaugeUsesAmberAccent() {
        val battery = project(state(batteryLevel = 40)).gauges.first { it.key == "battery" }
        assertEquals(HeroAccent.Amber, battery.accent)
    }

    @Test
    fun drivingAddsSpeedGauge() {
        val gauges = project(state(speed = 27.0, state = "driving")).gauges
        assertEquals(listOf("battery", "range", "speed", "inside", "outside"), gauges.map { it.key })
        // 27 m/s -> 97.2 km/h.
        assertEquals(97.2, gauges.first { it.key == "speed" }.value, 0.001)
        assertEquals(HERO_SPEED_MAX, gauges.first { it.key == "speed" }.max, 0.0)
    }

    @Test
    fun chargingAddsChargePowerGauge() {
        val gauges = project(state(isCharging = true, chargerPower = 48.4)).gauges
        assertEquals(listOf("battery", "range", "chargePower", "inside", "outside"), gauges.map { it.key })
        val power = gauges.first { it.key == "chargePower" }
        assertEquals(48.4, power.value, 0.0)
        assertEquals("kW", power.unit)
        assertEquals(HeroAccent.Green, power.accent)
    }

    @Test
    fun imperialUnitsConvertRangeAndTempAtTheBoundary() {
        val gauges = project(state(), imperial).gauges
        // 350 km -> 217.48 mi; 21.5 C -> 70.7 F.
        assertEquals(217.48, gauges.first { it.key == "range" }.value, 0.01)
        assertEquals("mi", gauges.first { it.key == "range" }.unit)
        assertEquals(70.7, gauges.first { it.key == "inside" }.value, 0.01)
        assertEquals(HERO_TEMP_MAX_F, gauges.first { it.key == "inside" }.max, 0.0)
    }

    // ── Charging banner (web `is_charging` detail block) ─────────────────────────────────────────────

    @Test
    fun chargingDetailsRenderPowerRateTimeAndDoneAt() {
        val charging = project(state(isCharging = true, chargerPower = 48.4, timeToFullCharge = 1.5), now = 0L).charging!!
        assertEquals("48.40 kW", charging.powerText)
        // 48 000 m/h -> 48 km/h, whole units.
        assertEquals("48 km/h", charging.rateText)
        assertEquals("1.5h", charging.timeToFullText)
        // now (0) + 1.5h -> 5 400 000 ms, fed through the injected clock formatter.
        assertEquals("Done ~5400000", charging.doneAtText)
    }

    @Test
    fun chargingWithNoEstimateShowsEmDashAndNoDoneAt() {
        val charging = project(state(isCharging = true, chargerPower = 11.0, timeToFullCharge = 0.0)).charging!!
        assertEquals(HERO_EM_DASH, charging.timeToFullText)
        assertNull(charging.doneAtText)
    }

    @Test
    fun notChargingHasNoChargingBanner() {
        assertNull(project(state(isCharging = false)).charging)
    }

    // ── Stat cards: driving / charging / idle layouts + always-visible cards ─────────────────────────

    @Test
    fun drivingStatCardsMatchWebLayout() {
        val stats = project(state(speed = 27.0, power = 32.0, state = "driving")).stats
        val power = HERO_POWER_LABEL_SENTINEL
        assertEquals(
            listOf("Speed", power, "Odometer", "Ideal Range", "Status", "Sentry", "Firmware", power),
            stats.map { it.label },
        )
        assertEquals("97 km/h", stats.first { it.key == "stat-speed" }.value)
        assertEquals("42,000 km", stats.first { it.key == "odometer" }.value)
        assertEquals("380 km", stats.first { it.key == "idealRange" }.value)
        assertEquals("32.00 kW", stats.first { it.key == "stat-power" }.value)
        assertEquals(HeroAccent.Amber, stats.first { it.key == "stat-power" }.accent)
    }

    @Test
    fun chargingStatCardsMatchWebLayout() {
        val stats = project(state(isCharging = true, chargerPower = 48.4, timeToFullCharge = 2.0, state = "charging")).stats
        assertEquals("Charge Rate", stats.first { it.key == "stat-chargeRate" }.label)
        assertEquals("48 km/h", stats.first { it.key == "stat-chargeRate" }.value)
        assertEquals("2.0h", stats.first { it.key == "stat-timeToFull" }.value)
        assertEquals(HeroGlyph.Clock, stats.first { it.key == "stat-timeToFull" }.glyph)
    }

    @Test
    fun idleStatCardsShowTemperatures() {
        val stats = project(state()).stats
        assertEquals("Inside", stats.first { it.key == "stat-inside" }.label)
        assertEquals("21.5\u00B0C", stats.first { it.key == "stat-inside" }.value)
        assertEquals("12.0\u00B0C", stats.first { it.key == "stat-outside" }.value)
        assertEquals(HeroGlyph.Thermometer, stats.first { it.key == "stat-inside" }.glyph)
    }

    @Test
    fun lockedSentryStatsCarryValueAccentAndGlyph() {
        val locked = project(state(isLocked = true, sentryMode = true)).stats
        val status = locked.first { it.key == "stat-status" }
        assertEquals("Locked", status.value)
        assertEquals(HeroAccent.Green, status.accent)
        assertEquals(HeroGlyph.Lock, status.glyph)
        val sentry = locked.first { it.key == "stat-sentry" }
        assertEquals("Active", sentry.value)
        assertEquals(HeroAccent.Red, sentry.accent)

        val unlocked = project(state(isLocked = false, sentryMode = false)).stats
        val openStatus = unlocked.first { it.key == "stat-status" }
        assertEquals("Unlocked", openStatus.value)
        assertEquals(HeroAccent.Amber, openStatus.accent)
        assertEquals(HeroGlyph.Unlock, openStatus.glyph)
        assertEquals("Off", unlocked.first { it.key == "stat-sentry" }.value)
    }

    @Test
    fun firmwareStatCarriesTheProvidedVersion() {
        val firmware = project(state()).stats.first { it.key == "stat-firmware" }
        assertEquals("Firmware", firmware.label)
        assertEquals("2026.20.1", firmware.value)
        assertEquals(HeroAccent.Primary, firmware.accent)
    }

    @Test
    fun powerAccentTracksSign() {
        assertEquals(HeroAccent.Amber, heroPowerAccent(5.0))
        assertEquals(HeroAccent.Green, heroPowerAccent(-5.0))
        assertEquals(HeroAccent.Neutral, heroPowerAccent(0.0))
    }

    // ── Asleep state (web `state ? hero : <asleep/>`) ────────────────────────────────────────────────

    @Test
    fun asleepStateProducesHeaderOnlyDisplay() {
        val display = project(null)
        assertTrue(display.asleep)
        assertTrue(display.gauges.isEmpty())
        assertTrue(display.stats.isEmpty())
        assertNull(display.charging)
        assertEquals("My Model 3, offline", display.accessibleSummary)
    }

    // ── Accessibility label presence ─────────────────────────────────────────────────────────────────

    @Test
    fun accessibleSummaryCarriesNameStatusAndBattery() {
        val summary = project(state(batteryLevel = 72, state = "online")).accessibleSummary
        assertEquals("My Model 3, online, Battery 72%", summary)
    }

    @Test
    fun accessibleSummaryFlagsChargingState() {
        val summary = project(state(isCharging = true, chargerPower = 11.0)).accessibleSummary
        assertTrue(summary.contains("Charging"))
    }

    // ── Lifecycle surface classifier (per-state) ─────────────────────────────────────────────────────

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(VehicleHeroSurface.Loading, vehicleHeroSurface(UiState.loading<VehicleHeroData>()))
        assertEquals(
            VehicleHeroSurface.Error,
            vehicleHeroSurface(UiState<VehicleHeroData>(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(
            VehicleHeroSurface.Empty,
            vehicleHeroSurface(UiState(UiPhase.Empty, data = VehicleHeroData(null, null, HERO_EM_DASH))),
        )
        assertEquals(
            VehicleHeroSurface.Content,
            vehicleHeroSurface(UiState(UiPhase.Content, data = VehicleHeroData(vehicle, state(), "2026.20.1"))),
        )
    }

    // ── Web-parity state builder (web `loading={!vehicle}` + freshness flags) ────────────────────────

    @Test
    fun stateBuilderClassifiesLoadingEmptyErrorAndContent() {
        assertEquals(UiPhase.Loading, vehicleHeroStateOf(null, loading = true).phase)
        assertEquals(UiPhase.Empty, vehicleHeroStateOf(null, loading = false).phase)
        assertEquals(
            UiPhase.Empty,
            vehicleHeroStateOf(VehicleHeroData(null, null, HERO_EM_DASH), loading = false).phase,
        )
        val error = vehicleHeroStateOf(null, loading = false, isError = true)
        assertEquals(UiPhase.Error, error.phase)
        assertEquals(ErrorKind.Unknown, error.errorKind)
        val content = vehicleHeroStateOf(VehicleHeroData(vehicle, state(), "2026.20.1"), loading = false)
        assertEquals(UiPhase.Content, content.phase)
    }

    @Test
    fun contentStaysContentWhileRefreshingOrOffline() {
        val refreshing = vehicleHeroStateOf(VehicleHeroData(vehicle, state(), "2026.20.1"), loading = true)
        assertEquals(UiPhase.Content, refreshing.phase)
        assertTrue(refreshing.refreshing)

        val offline =
            vehicleHeroStateOf(
                VehicleHeroData(vehicle, state(), "2026.20.1"),
                loading = false,
                isError = true,
                fetchedAt = 1_700_000_000_000L,
            )
        assertEquals(UiPhase.Content, offline.phase)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        assertEquals(ErrorKind.Unknown, offline.errorKind)
    }

    // ── Diagnostics (P1/S11 `view.opened`) + registry ────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordVehicleHeroOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "VehicleHero"), record.fields)
    }

    @Test
    fun registrationSlugAndIdMatchTheSurfaceContract() {
        assertEquals("VehicleHero", VehicleHeroRegistration.SLUG)
        assertEquals("vehicle-hero", VehicleHeroRegistration.ID)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }
}
