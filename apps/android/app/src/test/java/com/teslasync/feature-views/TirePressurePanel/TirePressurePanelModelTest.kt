// Off-device unit coverage for the TirePressurePanel feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the snapshot -> display projection (the typed-field reads + web
// `typeof number` guard, the per-wheel safety band ported from the web `getColor`/`getBorder` ladders, the
// aggregate-status ternary, and the Pa -> kPa -> display pressure conversion through the shared UnitFormatter /
// `useUnits`), the empty-snapshot classifier the composable + view-model switch on (per-state coverage), the
// tile/label routing through the supplied i18n strings + the grouped TalkBack phrase (a11y label coverage), the
// lifecycle [UiState] surfaces (loading / content / empty / error / offline), and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressurepanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TirePressurePanelModelTest {
    private val metric = UnitFormatter.default()
    private val imperial =
        UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_pressure":"psi"}""")))

    private val strings =
        TirePressurePanelStrings(
            title = "Tire Pressure",
            flLabel = "FL",
            frLabel = "FR",
            rlLabel = "RL",
            rrLabel = "RR",
            frontLeft = "Front Left",
            frontRight = "Front Right",
            rearLeft = "Rear Left",
            rearRight = "Rear Right",
            allNormal = "All Normal",
            attentionNeeded = "Attention Needed",
            checkPressure = "Check Pressure",
            noData = "No tire pressure data available",
        )

    // A within-band snapshot: all four wheels ≈ 250 kPa (between the warning thresholds).
    private val allNormal =
        buildJsonObject {
            put("front_left", 250_000.0)
            put("front_right", 251_000.0)
            put("rear_left", 249_000.0)
            put("rear_right", 252_000.0)
        }

    private fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter = metric,
    ) = TirePressurePanelProjection.project(snapshot, formatter, strings)

    private fun wheel(
        display: TirePressurePanelDisplay,
        id: TirePressureWheel,
    ): TireWheelDisplay = display.wheels.first { it.wheel == id }

    // ── Field reads (web typed `number | null`) ──────────────────────────────────

    @Test
    fun parsesTheFourTypedPascalFields() {
        val reading = TirePressurePanelProjection.parse(allNormal)
        assertEquals(250_000.0, reading.frontLeftPa)
        assertEquals(251_000.0, reading.frontRightPa)
        assertEquals(249_000.0, reading.rearLeftPa)
        assertEquals(252_000.0, reading.rearRightPa)
    }

    @Test
    fun quotedStringPressuresAreRejectedLikeTheWebTypeofGuard() {
        val typed =
            buildJsonObject {
                put("front_left", "250000")
                put("front_right", 251_000.0)
            }
        val reading = TirePressurePanelProjection.parse(typed)
        assertEquals(null, reading.frontLeftPa)
        assertEquals(251_000.0, reading.frontRightPa)
    }

    // ── Per-wheel safety band (web getColor/getBorder) ───────────────────────────

    @Test
    fun wheelBandClassifiesEachThreshold() {
        assertEquals(TirePressureVariant.Normal, TirePressurePanelProjection.variantOf(250_000.0))
        assertEquals(TirePressureVariant.Warning, TirePressurePanelProjection.variantOf(230_000.0))
        assertEquals(TirePressureVariant.Warning, TirePressurePanelProjection.variantOf(320_000.0))
        assertEquals(TirePressureVariant.Critical, TirePressurePanelProjection.variantOf(200_000.0))
        assertEquals(TirePressureVariant.Critical, TirePressurePanelProjection.variantOf(350_000.0))
        assertEquals(TirePressureVariant.Unknown, TirePressurePanelProjection.variantOf(null))
    }

    @Test
    fun wheelBandIsInclusiveAtTheWarningEdges() {
        // == LOW_WARNING and == HIGH_WARNING are inside the safe band (web `< / >`, not `<= / >=`).
        assertEquals(TirePressureVariant.Normal, TirePressurePanelProjection.variantOf(TirePressurePa.LOW_WARNING))
        assertEquals(TirePressureVariant.Normal, TirePressurePanelProjection.variantOf(TirePressurePa.HIGH_WARNING))
        // == LOW_CRITICAL is below the warning band but not yet critical.
        assertEquals(TirePressureVariant.Warning, TirePressurePanelProjection.variantOf(TirePressurePa.LOW_CRITICAL))
    }

    // ── Aggregate status (web allGood ? … : anyBad ? … : …) ──────────────────────

    @Test
    fun allWheelsInTheWarningBandReadsAllNormal() {
        assertEquals(TireOverallStatus.AllNormal, TirePressurePanelProjection.overallStatus(parseReading(allNormal)))
    }

    @Test
    fun aCriticalWheelReadsAttentionNeeded() {
        val snapshot =
            buildJsonObject {
                put("front_left", 180_000.0)
                put("front_right", 251_000.0)
                put("rear_left", 249_000.0)
                put("rear_right", 252_000.0)
            }
        assertEquals(
            TireOverallStatus.AttentionNeeded,
            TirePressurePanelProjection.overallStatus(parseReading(snapshot)),
        )
    }

    @Test
    fun aSoftOrMissingWheelReadsCheckPressure() {
        val soft =
            buildJsonObject {
                put("front_left", 230_000.0)
                put("front_right", 251_000.0)
                put("rear_left", 249_000.0)
                put("rear_right", 252_000.0)
            }
        assertEquals(TireOverallStatus.CheckPressure, TirePressurePanelProjection.overallStatus(parseReading(soft)))

        val missing =
            buildJsonObject {
                put("front_right", 251_000.0)
                put("rear_left", 249_000.0)
                put("rear_right", 252_000.0)
            }
        assertEquals(TireOverallStatus.CheckPressure, TirePressurePanelProjection.overallStatus(parseReading(missing)))
    }

    // ── Projection: tiles, formatting, status label ──────────────────────────────

    @Test
    fun projectsFourTilesInWebOrderWithMetricPressure() {
        val display = project(allNormal)
        assertTrue(display.hasData)
        assertEquals(
            listOf(
                TirePressureWheel.FrontLeft,
                TirePressureWheel.FrontRight,
                TirePressureWheel.RearLeft,
                TirePressureWheel.RearRight,
            ),
            display.wheels.map { it.wheel },
        )
        val fl = wheel(display, TirePressureWheel.FrontLeft)
        assertEquals(TirePressureVariant.Normal, fl.variant)
        assertTrue("metric value should carry the bar unit: ${fl.valueText}", fl.valueText.endsWith("bar"))
        assertEquals("FL", fl.label)
        assertEquals(TireOverallStatus.AllNormal, display.status)
        assertEquals("All Normal", display.statusLabel)
    }

    @Test
    fun pressureConvertsThroughTheImperialBoundary() {
        val metricFl = wheel(project(allNormal, metric), TirePressureWheel.FrontLeft).valueText
        val imperialFl = wheel(project(allNormal, imperial), TirePressureWheel.FrontLeft).valueText
        assertTrue("imperial value should carry the psi unit: $imperialFl", imperialFl.endsWith("psi"))
        assertFalse("metric and imperial pressures must differ", metricFl == imperialFl)
    }

    @Test
    fun missingWheelFallsBackToEmDashAndUnknownBand() {
        val sparse = buildJsonObject { put("front_right", 251_000.0) }
        val display = project(sparse)
        assertTrue(display.hasData)
        val fl = wheel(display, TirePressureWheel.FrontLeft)
        assertEquals(EM_DASH, fl.valueText)
        assertEquals(TirePressureVariant.Unknown, fl.variant)
        // A present-but-no-critical-wheel snapshot is the web "Check Pressure" aggregate.
        assertEquals(TireOverallStatus.CheckPressure, display.status)
        assertEquals("Check Pressure", display.statusLabel)
    }

    // ── a11y labels (web `t('driveDetail.frontLeft')` full names) ────────────────

    @Test
    fun tileContentDescriptionMergesFullWheelNameAndValue() {
        val fl = wheel(project(allNormal), TirePressureWheel.FrontLeft)
        assertEquals("Front Left, ${fl.valueText}", fl.contentDescription)
        val rr = wheel(project(allNormal), TirePressureWheel.RearRight)
        assertEquals("Rear Right, ${rr.valueText}", rr.contentDescription)
    }

    @Test
    fun statusLabelRoutesThroughTheSuppliedI18nStrings() {
        val localized = strings.copy(attentionNeeded = "Attention requise")
        val snapshot = buildJsonObject { put("front_left", 180_000.0) }
        val display = TirePressurePanelProjection.project(snapshot, metric, localized)
        assertEquals(TireOverallStatus.AttentionNeeded, display.status)
        assertEquals("Attention requise", display.statusLabel)
        assertEquals("Attention requise", display.statusContentDescription)
    }

    // ── Empty-snapshot classifier (web `tireData ? … : <empty/>`) ────────────────

    @Test
    fun emptySnapshotIsDetectedForNonObjects() {
        assertTrue(TirePressurePanelProjection.isEmptySnapshot(null))
        assertTrue(TirePressurePanelProjection.isEmptySnapshot(JsonNull))
        assertTrue(TirePressurePanelProjection.isEmptySnapshot(JsonPrimitive("x")))
        assertFalse(TirePressurePanelProjection.isEmptySnapshot(allNormal))
    }

    @Test
    fun emptySnapshotProjectsToNoDataWithNoTiles() {
        val display = project(JsonNull)
        assertFalse(display.hasData)
        assertTrue(display.wheels.isEmpty())
    }

    // ── Lifecycle surface states (per-state coverage) ────────────────────────────

    @Test
    fun perStateUiSurfacesClassifyCorrectly() {
        assertTrue(UiState.loading<JsonElement>().isLoading)

        val content = UiState(phase = UiPhase.Content, data = allNormal, fetchedAt = 1L)
        assertTrue(content.isContent)
        assertTrue(project(content.data).hasData)

        val empty = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L)
        assertTrue(empty.isEmpty)
        assertFalse(project(empty.data).hasData)

        val error = UiState<JsonElement>(phase = UiPhase.Error, errorKind = ErrorKind.Network)
        assertTrue(error.isError)
        assertFalse(error.hasData)
    }

    @Test
    fun offlineCachedStateStaysContentAndStillRendersTheTiles() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = allNormal,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertFalse(offline.isLoading)
        assertFalse(offline.isError)
        assertFalse(offline.isEmpty)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        // Cached data still renders the full tile grid while stale.
        assertEquals(4, project(offline.data!!).wheels.size)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordTirePressurePanelOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "TirePressurePanel"), record.fields)
        assertEquals("TirePressurePanel", TIRE_PRESSURE_PANEL_SLUG)
    }

    private fun parseReading(snapshot: JsonElement) = TirePressurePanelProjection.parse(snapshot)

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
