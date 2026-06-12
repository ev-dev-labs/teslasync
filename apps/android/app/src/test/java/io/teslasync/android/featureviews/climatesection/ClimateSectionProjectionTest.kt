package io.teslasync.android.featureviews.climatesection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the Climate section's pure logic — the native analogue of the web component's
 * per-tile value + accent derivations
 * (web/src/features/vehicles/components/vehicle-detail/ClimateSection.tsx): the three `formatTemperature`
 * tiles, the `String(fan_status)` / `'—'` fan tile, the `` `${t('common.level')} ${n}` `` / `'—'` seat-heater
 * tiles, the `defrost_mode && defrost_mode !== 'Off'` defrost value + accent ternary, the
 * `(is_ac_on ?? is_climate_on) ? 'On' : 'Off'` climate value + accent ternary, and the PII-safe `view.opened`
 * diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class ClimateSectionProjectionTest {
    // Stub formatter tags each value so the test pins which formatter each temperature tile uses.
    private val stubFormatter: (Double?) -> String = { "T($it)" }

    private val strings = ClimateValueStrings(level = "Level", on = "On", off = "Off")

    private val fullData =
        ClimateData(
            insideTempC = 21.5,
            outsideTempC = 12.0,
            driverSetpointC = 22.0,
            fanStatus = 3,
            seatHeaterLeft = 2,
            seatHeaterRight = 0,
            defrostMode = "Front",
            isClimateOn = true,
        )

    private fun project(data: ClimateData) = ClimateSectionProjection.project(data, stubFormatter, strings)

    // ── Tile order + the always-eight-tiles contract ──────────────────────────────

    @Test
    fun projectBuildsAllEightTilesInWebGridOrder() {
        val ids = project(fullData).metrics.map { it.id }
        assertEquals(
            listOf(
                ClimateMetricId.InsideTemp,
                ClimateMetricId.OutsideTemp,
                ClimateMetricId.DriverSetpoint,
                ClimateMetricId.FanSpeed,
                ClimateMetricId.SeatHeaterLeft,
                ClimateMetricId.SeatHeaterRight,
                ClimateMetricId.Defrost,
                ClimateMetricId.ClimateOn,
            ),
            ids,
        )
    }

    @Test
    fun projectAlwaysBuildsEightTilesEvenForAnEmptySnapshot() {
        assertEquals(8, project(ClimateData()).metrics.size)
    }

    // ── Temperature tiles (web formatTemperature) ─────────────────────────────────

    @Test
    fun temperatureTilesFormatThroughTheInjectedFormatter() {
        val metrics = project(fullData).metrics
        assertEquals("T(21.5)", metrics[0].value)
        assertEquals("T(12.0)", metrics[1].value)
        assertEquals("T(22.0)", metrics[2].value)
    }

    @Test
    fun temperatureTilesCarryGreenCyanPurpleAccents() {
        val metrics = project(fullData).metrics
        assertEquals(ClimateMetricTone.Green, metrics[0].tone)
        assertEquals(ClimateMetricTone.Cyan, metrics[1].tone)
        assertEquals(ClimateMetricTone.Purple, metrics[2].tone)
    }

    @Test
    fun temperatureTilesPassNullThroughToTheFormatter() {
        // A null reading is handed to formatTemperature (which renders the em-dash fallback in production).
        val inside = project(ClimateData()).metrics.first { it.id == ClimateMetricId.InsideTemp }
        assertEquals("T(null)", inside.value)
    }

    // ── Fan tile (web String(fan_status) | '—') ───────────────────────────────────

    @Test
    fun fanTileShowsTheNumericStatusOrTheEmDash() {
        val present = project(fullData).metrics.first { it.id == ClimateMetricId.FanSpeed }
        assertEquals("3", present.value)
        assertEquals(ClimateMetricTone.Cyan, present.tone)

        val absent = project(ClimateData()).metrics.first { it.id == ClimateMetricId.FanSpeed }
        assertEquals("\u2014", absent.value)
    }

    // ── Seat-heater tiles (web `${level} ${n}` | '—') ─────────────────────────────

    @Test
    fun seatHeaterTilesShowLevelPlusValueIncludingZeroOrTheEmDash() {
        val metrics = project(fullData).metrics
        val left = metrics.first { it.id == ClimateMetricId.SeatHeaterLeft }
        val right = metrics.first { it.id == ClimateMetricId.SeatHeaterRight }
        assertEquals("Level 2", left.value)
        // A 0 level is non-null, so it reads "Level 0" (web `seat_heater_right != null`), not the em dash.
        assertEquals("Level 0", right.value)
        assertEquals(ClimateMetricTone.Green, left.tone)
        assertEquals(ClimateMetricTone.Green, right.tone)

        val absent = project(ClimateData()).metrics.first { it.id == ClimateMetricId.SeatHeaterLeft }
        assertEquals("\u2014", absent.value)
    }

    // ── Defrost tile (web defrost_mode && defrost_mode !== 'Off') ──────────────────

    @Test
    fun defrostTileShowsActiveModeGreenWhenPresentAndNotOff() {
        val defrost = project(fullData).metrics.first { it.id == ClimateMetricId.Defrost }
        assertEquals("Front", defrost.value)
        assertEquals(ClimateMetricTone.Green, defrost.tone)
    }

    @Test
    fun defrostTileShowsOffWordCyanForTheOffLiteralOrAbsentMode() {
        val offLiteral = project(ClimateData(defrostMode = "Off")).metrics.first { it.id == ClimateMetricId.Defrost }
        assertEquals("Off", offLiteral.value)
        assertEquals(ClimateMetricTone.Cyan, offLiteral.tone)

        val absent = project(ClimateData(defrostMode = null)).metrics.first { it.id == ClimateMetricId.Defrost }
        assertEquals("Off", absent.value)
        assertEquals(ClimateMetricTone.Cyan, absent.tone)
    }

    // ── Climate-on tile (web (is_ac_on ?? is_climate_on) ? 'On' : 'Off') ───────────

    @Test
    fun climateOnTileShowsOnGreenWhenOn() {
        val on = project(ClimateData(isClimateOn = true)).metrics.first { it.id == ClimateMetricId.ClimateOn }
        assertEquals("On", on.value)
        assertEquals(ClimateMetricTone.Green, on.tone)
    }

    @Test
    fun climateOnTileShowsOffCyanWhenOffOrNull() {
        val off = project(ClimateData(isClimateOn = false)).metrics.first { it.id == ClimateMetricId.ClimateOn }
        assertEquals("Off", off.value)
        assertEquals(ClimateMetricTone.Cyan, off.tone)

        val unknown = project(ClimateData(isClimateOn = null)).metrics.first { it.id == ClimateMetricId.ClimateOn }
        assertEquals("Off", unknown.value)
        assertEquals(ClimateMetricTone.Cyan, unknown.tone)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordClimateSectionOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ClimateSection"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
