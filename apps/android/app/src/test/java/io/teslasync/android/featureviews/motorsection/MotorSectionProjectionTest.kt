package io.teslasync.android.featureviews.motorsection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the MotorSection pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx): the
 * `motorData ? … : …` presence gate (here the composable's [io.teslasync.android.data.UiState] switch), the
 * pack-voltage `vbat_rear ?? vbat_front` fallback, the per-field `… != null ? '<value> <unit>' : '—'`
 * formatting, the zero-suffix `fmtInt` RPM read, and the peak-temperature `Math.max(front ?? -∞, rear ?? -∞)`
 * + `isFinite` guard. Because the surface is presentational, the projected [MotorTile] list is exactly what the
 * thin composable renders, so these assertions double as the per-state adapter "snapshot".
 */
class MotorSectionProjectionTest {
    private val locale = Locale.US

    private fun formatters(precision: Int = DEFAULT_DECIMAL_PRECISION): MotorFormatters =
        MotorFormatters(
            number = { MotorSectionFormat.number(it, precision, locale) },
            integer = { MotorSectionFormat.integer(it, locale) },
            temperature = { "${MotorSectionFormat.number(it, 1, locale)}\u00B0C" },
        )

    private fun fullReadout(): MotorReadout =
        MotorReadout(
            shiftState = "D",
            vbatFront = 396.0,
            vbatRear = 398.0,
            motorCurrentFront = 152.0,
            torqueNmFront = 180.0,
            torqueNmRear = 175.0,
            motorRpmFront = 1240.0,
            motorRpmRear = 1238.0,
            motorTempCFront = 48.0,
            motorTempCRear = 47.0,
        )

    private fun emptyReadout(): MotorReadout =
        MotorReadout(
            shiftState = null,
            vbatFront = null,
            vbatRear = null,
            motorCurrentFront = null,
            torqueNmFront = null,
            torqueNmRear = null,
            motorRpmFront = null,
            motorRpmRear = null,
            motorTempCFront = null,
            motorTempCRear = null,
        )

    private fun valueOf(
        tiles: List<MotorTile>,
        key: MotorTileKey,
    ): String = tiles.single { it.key == key }.value

    // ── tile order, keys, and accents (the web grid layout) ─────────────────────────────────────────

    @Test
    fun projectEmitsTheEightTilesInTheWebGridOrder() {
        val tiles = MotorSectionProjection.project(fullReadout(), formatters())
        assertEquals(
            listOf(
                MotorTileKey.ShiftState,
                MotorTileKey.PackVoltage,
                MotorTileKey.MotorCurrentFront,
                MotorTileKey.TorqueFront,
                MotorTileKey.TorqueRear,
                MotorTileKey.RpmFront,
                MotorTileKey.RpmRear,
                MotorTileKey.MotorTemp,
            ),
            tiles.map { it.key },
        )
    }

    @Test
    fun eachTileCarriesTheWebMetricCardColor() {
        val accents = MotorSectionProjection.project(fullReadout(), formatters()).associate { it.key to it.accent }
        assertEquals(MotorAccent.Cyan, accents[MotorTileKey.ShiftState])
        assertEquals(MotorAccent.Purple, accents[MotorTileKey.PackVoltage])
        assertEquals(MotorAccent.Green, accents[MotorTileKey.MotorCurrentFront])
        assertEquals(MotorAccent.Cyan, accents[MotorTileKey.TorqueFront])
        assertEquals(MotorAccent.Purple, accents[MotorTileKey.TorqueRear])
        assertEquals(MotorAccent.Cyan, accents[MotorTileKey.RpmFront])
        assertEquals(MotorAccent.Purple, accents[MotorTileKey.RpmRear])
        assertEquals(MotorAccent.Green, accents[MotorTileKey.MotorTemp])
    }

    // ── populated values (web `${fmtNumber(value)} <unit>` / `fmtInt` / `formatTemperature`) ─────────

    @Test
    fun fullReadoutFormatsEveryTileLikeTheWeb() {
        val tiles = MotorSectionProjection.project(fullReadout(), formatters())
        assertEquals("D", valueOf(tiles, MotorTileKey.ShiftState))
        assertEquals("398.00 V", valueOf(tiles, MotorTileKey.PackVoltage))
        assertEquals("152.00 A", valueOf(tiles, MotorTileKey.MotorCurrentFront))
        assertEquals("180.00 Nm", valueOf(tiles, MotorTileKey.TorqueFront))
        assertEquals("175.00 Nm", valueOf(tiles, MotorTileKey.TorqueRear))
        assertEquals("1,240", valueOf(tiles, MotorTileKey.RpmFront))
        assertEquals("1,238", valueOf(tiles, MotorTileKey.RpmRear))
        assertEquals("48.0\u00B0C", valueOf(tiles, MotorTileKey.MotorTemp))
    }

    @Test
    fun rpmHasNoUnitSuffixUnlikeTheOtherNumericTiles() {
        val tiles = MotorSectionProjection.project(fullReadout(), formatters())
        assertFalse(valueOf(tiles, MotorTileKey.RpmFront).contains("RPM"))
        assertFalse(valueOf(tiles, MotorTileKey.RpmRear).any { it.isLetter() })
    }

    // ── null fallbacks (web `… : '—'`) ──────────────────────────────────────────────────────────────

    @Test
    fun absentReadingsRenderTheEmDashFallback() {
        val tiles = MotorSectionProjection.project(emptyReadout(), formatters())
        assertTrue(tiles.all { it.value == DASH })
    }

    // ── pack-voltage `vbat_rear ?? vbat_front` ──────────────────────────────────────────────────────

    @Test
    fun packVoltagePrefersRearBus() {
        val tiles = MotorSectionProjection.project(fullReadout().copy(vbatRear = 401.0, vbatFront = 350.0), formatters())
        assertEquals("401.00 V", valueOf(tiles, MotorTileKey.PackVoltage))
    }

    @Test
    fun packVoltageFallsBackToFrontBusWhenRearAbsent() {
        val tiles = MotorSectionProjection.project(fullReadout().copy(vbatRear = null, vbatFront = 350.0), formatters())
        assertEquals("350.00 V", valueOf(tiles, MotorTileKey.PackVoltage))
    }

    @Test
    fun packVoltageIsEmDashWhenBothBusesAbsent() {
        val tiles = MotorSectionProjection.project(fullReadout().copy(vbatRear = null, vbatFront = null), formatters())
        assertEquals(DASH, valueOf(tiles, MotorTileKey.PackVoltage))
    }

    // ── peak motor temperature (web `Math.max(front ?? -∞, rear ?? -∞)` + `isFinite`) ───────────────

    @Test
    fun peakMotorTempTakesTheHotterOfTheTwoReadings() {
        assertEquals(48.0, MotorSectionProjection.peakMotorTemp(fullReadout().copy(motorTempCFront = 48.0, motorTempCRear = 47.0)), 0.0)
        assertEquals(50.0, MotorSectionProjection.peakMotorTemp(fullReadout().copy(motorTempCFront = 44.0, motorTempCRear = 50.0)), 0.0)
    }

    @Test
    fun peakMotorTempUsesTheSolePresentReading() {
        assertEquals(48.0, MotorSectionProjection.peakMotorTemp(emptyReadout().copy(motorTempCFront = 48.0)), 0.0)
        assertEquals(47.0, MotorSectionProjection.peakMotorTemp(emptyReadout().copy(motorTempCRear = 47.0)), 0.0)
    }

    @Test
    fun peakMotorTempIsNonFiniteWhenBothReadingsAbsent() {
        assertFalse(MotorSectionProjection.peakMotorTemp(emptyReadout()).isFinite())
    }

    @Test
    fun motorTempTileIsEmDashWhenBothReadingsAbsentButOtherFieldsPresent() {
        val readout = fullReadout().copy(motorTempCFront = null, motorTempCRear = null)
        val tiles = MotorSectionProjection.project(readout, formatters())
        assertEquals(DASH, valueOf(tiles, MotorTileKey.MotorTemp))
    }

    // ── number formatting (web `fmtNumber` / `fmtInt`, web/src/lib/numberFormat.ts) ──────────────────

    @Test
    fun numberAppliesLocaleGroupingAndPrecision() {
        assertEquals("1,234.50", MotorSectionFormat.number(1234.5, 2, Locale.US))
        assertEquals("1,234", MotorSectionFormat.integer(1234.0, Locale.US))
    }

    @Test
    fun numberRoundsHalfAwayFromZeroLikeIntlNumberFormat() {
        assertEquals("2.46", MotorSectionFormat.number(2.455, 2, Locale.US))
    }

    @Test
    fun nonFiniteCoercesToZeroAndSignedZeroNormalizes() {
        assertEquals("0.00", MotorSectionFormat.number(Double.NaN, 2, Locale.US))
        assertEquals("0.00", MotorSectionFormat.number(Double.POSITIVE_INFINITY, 2, Locale.US))
        assertEquals("0.00", MotorSectionFormat.number(-0.0, 2, Locale.US))
    }

    @Test
    fun precisionZeroHonoursTheUserSetting() {
        val tiles = MotorSectionProjection.project(fullReadout(), formatters(precision = 0))
        assertEquals("398 V", valueOf(tiles, MotorTileKey.PackVoltage))
    }

    // ── JSON decode (web `motorData: MotorSnapshot | null | undefined`) ─────────────────────────────

    @Test
    fun fromJsonDecodesASnapshotObject() {
        val json =
            buildJsonObject {
                put("shift_state", "D")
                put("vbat_rear", 398.0)
                put("vbat_front", 396.0)
                put("motor_current_front", 152.0)
                put("torque_nm_front", 180.0)
                put("torque_nm_rear", 175.0)
                put("motor_rpm_front", 1240.0)
                put("motor_rpm_rear", 1238.0)
                put("motor_temp_c_front", 48.0)
                put("motor_temp_c_rear", 47.0)
            }
        val readout = MotorReadout.fromJson(json)
        assertEquals(fullReadout(), readout)
    }

    @Test
    fun fromJsonReturnsNullForAnAbsentOrNonObjectBody() {
        assertNull(MotorReadout.fromJson(null))
        assertNull(MotorReadout.fromJson(JsonNull))
        assertNull(MotorReadout.fromJson(JsonPrimitive("not-an-object")))
        assertNull(MotorReadout.fromJson(buildJsonArray { add(JsonPrimitive(1)) }))
    }

    @Test
    fun fromJsonTreatsMissingAndJsonNullFieldsAsAbsent() {
        val json =
            buildJsonObject {
                put("shift_state", "P")
                put("vbat_rear", JsonNull)
            }
        val readout = MotorReadout.fromJson(json)
        assertNull(readout?.vbatRear)
        assertNull(readout?.vbatFront)
        assertNull(readout?.motorRpmFront)
        assertEquals("P", readout?.shiftState)
    }

    @Test
    fun fromJsonRejectsAMistypedShiftStateNumber() {
        val json = buildJsonObject { put("shift_state", 3) }
        assertNull(MotorReadout.fromJson(json)?.shiftState)
    }

    @Test
    fun fromJsonDecodesAPresentButAllNullSnapshotSoTheGridStillRenders() {
        val json = buildJsonObject { put("shift_state", JsonNull) }
        val readout = MotorReadout.fromJson(json)
        assertEquals(emptyReadout(), readout)
    }

    // ── locale resolution (web `useUnits` locale → `fmtNumber` fallback) ─────────────────────────────

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankTags() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale("  "))
        assertEquals(Locale.forLanguageTag("de-DE"), resolveDisplayLocale("de-DE"))
    }

    // ── diagnostics (P1/S11 PII-safe `view.opened`) ─────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsOnlyTheSurfaceSlug() {
        val logger = RecordingLogger()
        MotorSectionDiagnostics.recordViewOpened(logger)
        assertEquals("MotorSection", MotorSectionDiagnostics.SLUG)
        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "MotorSection"), opened.second)
        assertTrue(opened.second.values.none { it.any(Char::isDigit) })
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
