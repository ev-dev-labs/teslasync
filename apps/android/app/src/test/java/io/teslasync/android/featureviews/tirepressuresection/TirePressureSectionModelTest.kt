// Off-device unit coverage for the TirePressureSection feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the snapshot -> display projection (the typed-field reads + web
// `typeof number` guard, the per-corner badge tone ported from the web `tirePressureVariant` helper, the
// badge-text ternary ported from the web component, and the Pa -> kPa -> display pressure conversion through the
// shared UnitFormatter / `useUnits`), the empty-snapshot classifier the composable + view-model switch on
// (per-state coverage), the corner-label routing through the supplied i18n strings + the grouped TalkBack phrase
// (a11y label coverage), the lifecycle [UiState] surfaces (loading / content / empty / error / offline), and the
// PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressuresection

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

class TirePressureSectionModelTest {
    private val metric = UnitFormatter.default()
    private val imperial =
        UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_pressure":"psi"}""")))

    private val strings =
        TirePressureSectionStrings(
            title = "Tire Pressure",
            frontLeft = "Front Left",
            frontRight = "Front Right",
            rearLeft = "Rear Left",
            rearRight = "Rear Right",
            normal = "Normal",
            low = "Low",
            critical = "Critical",
            noData = "No Data",
            noTireData = "No tire pressure data available",
        )

    // A within-band snapshot: all four corners ≈ 250 kPa (between the warning thresholds).
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
    ) = TirePressureSectionProjection.project(snapshot, formatter, strings)

    private fun tile(
        display: TirePressureSectionDisplay,
        corner: TireCorner,
    ): TireCornerTile = display.tiles.first { it.corner == corner }

    // ── Field reads (web typed `number | null`) ──────────────────────────────────

    @Test
    fun parsesTheFourTypedPascalFields() {
        val reading = TirePressureSectionProjection.parse(allNormal)
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
        val reading = TirePressureSectionProjection.parse(typed)
        assertEquals(null, reading.frontLeftPa)
        assertEquals(251_000.0, reading.frontRightPa)
    }

    // ── Badge tone (web tirePressureVariant) ─────────────────────────────────────

    @Test
    fun toneClassifiesEachThreshold() {
        assertEquals(TireBadgeTone.Success, TirePressureSectionProjection.toneOf(250_000.0))
        assertEquals(TireBadgeTone.Warning, TirePressureSectionProjection.toneOf(230_000.0))
        assertEquals(TireBadgeTone.Warning, TirePressureSectionProjection.toneOf(320_000.0))
        assertEquals(TireBadgeTone.Danger, TirePressureSectionProjection.toneOf(200_000.0))
        assertEquals(TireBadgeTone.Danger, TirePressureSectionProjection.toneOf(350_000.0))
        assertEquals(TireBadgeTone.Neutral, TirePressureSectionProjection.toneOf(null))
    }

    @Test
    fun toneIsInclusiveAtTheWarningEdges() {
        // == LOW_WARNING and == HIGH_WARNING are inside the safe band (web `< / >`, not `<= / >=`).
        assertEquals(TireBadgeTone.Success, TirePressureSectionProjection.toneOf(TirePressureSectionPa.LOW_WARNING))
        assertEquals(TireBadgeTone.Success, TirePressureSectionProjection.toneOf(TirePressureSectionPa.HIGH_WARNING))
        // == LOW_CRITICAL is below the warning band but not yet critical.
        assertEquals(TireBadgeTone.Warning, TirePressureSectionProjection.toneOf(TirePressureSectionPa.LOW_CRITICAL))
    }

    // ── Badge text (web value != null ? Normal/Low/Critical : No Data) ────────────

    @Test
    fun badgeStatusClassifiesEachThreshold() {
        assertEquals(TireBadgeStatus.NoData, TirePressureSectionProjection.badgeStatusOf(null))
        assertEquals(TireBadgeStatus.Normal, TirePressureSectionProjection.badgeStatusOf(250_000.0))
        // Below the warning band but inside the critical band ⇒ "Low" (web text), tone "Warning".
        assertEquals(TireBadgeStatus.Low, TirePressureSectionProjection.badgeStatusOf(230_000.0))
        // Above the warning band but inside the critical band also reads "Low" (web `value <= HIGH_CRITICAL`).
        assertEquals(TireBadgeStatus.Low, TirePressureSectionProjection.badgeStatusOf(320_000.0))
        // Outside the critical band ⇒ "Critical".
        assertEquals(TireBadgeStatus.Critical, TirePressureSectionProjection.badgeStatusOf(200_000.0))
        assertEquals(TireBadgeStatus.Critical, TirePressureSectionProjection.badgeStatusOf(350_000.0))
    }

    @Test
    fun badgeStatusIsInclusiveAtTheWarningEdges() {
        assertEquals(
            TireBadgeStatus.Normal,
            TirePressureSectionProjection.badgeStatusOf(TirePressureSectionPa.LOW_WARNING),
        )
        assertEquals(
            TireBadgeStatus.Normal,
            TirePressureSectionProjection.badgeStatusOf(TirePressureSectionPa.HIGH_WARNING),
        )
        assertEquals(
            TireBadgeStatus.Low,
            TirePressureSectionProjection.badgeStatusOf(TirePressureSectionPa.LOW_CRITICAL),
        )
    }

    @Test
    fun badgeLabelRoutesThroughTheSuppliedI18nStrings() {
        val localized = strings.copy(low = "Basse", critical = "Critique")
        assertEquals("Normal", TirePressureSectionProjection.badgeLabel(TireBadgeStatus.Normal, localized))
        assertEquals("Basse", TirePressureSectionProjection.badgeLabel(TireBadgeStatus.Low, localized))
        assertEquals("Critique", TirePressureSectionProjection.badgeLabel(TireBadgeStatus.Critical, localized))
        assertEquals("No Data", TirePressureSectionProjection.badgeLabel(TireBadgeStatus.NoData, localized))
    }

    // ── Projection: tiles, formatting, badges ────────────────────────────────────

    @Test
    fun projectsFourTilesInWebOrderWithMetricPressureAndNormalBadges() {
        val display = project(allNormal)
        assertTrue(display.hasData)
        assertEquals(
            listOf(TireCorner.FrontLeft, TireCorner.FrontRight, TireCorner.RearLeft, TireCorner.RearRight),
            display.tiles.map { it.corner },
        )
        val fl = tile(display, TireCorner.FrontLeft)
        assertEquals("Front Left", fl.label)
        assertEquals(TireBadgeTone.Success, fl.tone)
        assertEquals("Normal", fl.statusText)
        assertTrue("metric value should carry the bar unit: ${fl.valueText}", fl.valueText.endsWith("bar"))
    }

    @Test
    fun projectsEachBadgeStateForAMixedSnapshot() {
        val mixed =
            buildJsonObject {
                put("front_left", 250_000.0) // Normal / Success
                put("front_right", 230_000.0) // Low / Warning
                put("rear_left", 180_000.0) // Critical / Danger
                // rear_right absent → No Data / Neutral
            }
        val display = project(mixed)
        assertEquals("Normal", tile(display, TireCorner.FrontLeft).statusText)
        assertEquals("Low", tile(display, TireCorner.FrontRight).statusText)
        assertEquals(TireBadgeTone.Warning, tile(display, TireCorner.FrontRight).tone)
        assertEquals("Critical", tile(display, TireCorner.RearLeft).statusText)
        assertEquals(TireBadgeTone.Danger, tile(display, TireCorner.RearLeft).tone)
        val rr = tile(display, TireCorner.RearRight)
        assertEquals("No Data", rr.statusText)
        assertEquals(TireBadgeTone.Neutral, rr.tone)
        assertEquals(EM_DASH, rr.valueText)
    }

    @Test
    fun pressureConvertsThroughTheImperialBoundary() {
        val metricFl = tile(project(allNormal, metric), TireCorner.FrontLeft).valueText
        val imperialFl = tile(project(allNormal, imperial), TireCorner.FrontLeft).valueText
        assertTrue("imperial value should carry the psi unit: $imperialFl", imperialFl.endsWith("psi"))
        assertFalse("metric and imperial pressures must differ", metricFl == imperialFl)
    }

    // ── a11y labels (grouped corner-name + value + status) ───────────────────────

    @Test
    fun tileContentDescriptionMergesCornerNameValueAndStatus() {
        val fl = tile(project(allNormal), TireCorner.FrontLeft)
        assertEquals("Front Left, ${fl.valueText}, Normal", fl.contentDescription)
        val rr = tile(project(buildJsonObject { put("front_left", 250_000.0) }), TireCorner.RearRight)
        assertEquals("Rear Right, $EM_DASH, No Data", rr.contentDescription)
    }

    // ── Empty-snapshot classifier (web `tireData ? … : <EmptyState/>`) ───────────

    @Test
    fun emptySnapshotIsDetectedForNonObjects() {
        assertTrue(TirePressureSectionProjection.isEmptySnapshot(null))
        assertTrue(TirePressureSectionProjection.isEmptySnapshot(JsonNull))
        assertTrue(TirePressureSectionProjection.isEmptySnapshot(JsonPrimitive("x")))
        assertFalse(TirePressureSectionProjection.isEmptySnapshot(allNormal))
    }

    @Test
    fun emptySnapshotProjectsToNoDataWithNoTiles() {
        val display = project(JsonNull)
        assertFalse(display.hasData)
        assertTrue(display.tiles.isEmpty())
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
        assertEquals(4, project(offline.data!!).tiles.size)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordTirePressureSectionOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "TirePressureSection"), record.fields)
        assertEquals("TirePressureSection", TIRE_PRESSURE_SECTION_SLUG)
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
