package io.teslasync.android.dashboard.widgets.drivescoregauge

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DriveScoreGaugeWidget's pure logic — the JSON parse adapter, the
 * `scoreColor` band heuristic, the gauge + breakdown projection, the registry metadata, the size
 * flags, and the cache-then-network `Resource` mapper. Mirrors the web spec
 * (web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx).
 */
class DriveScoreGaugeProjectionTest {
    private fun labels(): DriveScoreGaugeLabels =
        DriveScoreGaugeLabels(
            weekly = "Weekly score",
            efficiency = "Efficiency",
            smoothness = "Smoothness",
            speed = "Speed Discipline",
        )

    private fun snapshot(
        overall: Double = 85.0,
        efficiency: Double = 82.0,
        smoothness: Double = 88.0,
        speedDiscipline: Double = 80.0,
        grade: String? = "A",
    ): DriveScoreSnapshot =
        DriveScoreSnapshot(
            overall = overall,
            efficiency = efficiency,
            smoothness = smoothness,
            speedDiscipline = speedDiscipline,
            grade = grade,
        )

    private fun project(snapshot: DriveScoreSnapshot): DriveScoreGaugeDisplay = DriveScoreGaugeProjection.project(snapshot, labels())

    // ---- Parse adapter (web DriveScore shape) ---------------------------------------

    @Test
    fun fromJson_readsSnakeCaseFields() {
        val json =
            Json.parseToJsonElement(
                """
                {"overall":85,"efficiency":82,"smoothness":88,"speed_discipline":80,
                 "grade":"A","total_drives":42,"trend":"up"}
                """.trimIndent(),
            )

        val s = requireNotNull(DriveScoreSnapshot.fromJson(json))

        assertEquals(85.0, s.overall, EPS)
        assertEquals(82.0, s.efficiency, EPS)
        assertEquals(88.0, s.smoothness, EPS)
        assertEquals(80.0, s.speedDiscipline, EPS)
        assertEquals("A", s.grade)
    }

    @Test
    fun fromJson_defaultsMissingNumbersToZeroAndNullGrade() {
        val s = requireNotNull(DriveScoreSnapshot.fromJson(Json.parseToJsonElement("{}")))

        assertEquals(0.0, s.overall, EPS)
        assertEquals(0.0, s.efficiency, EPS)
        assertEquals(0.0, s.smoothness, EPS)
        assertEquals(0.0, s.speedDiscipline, EPS)
        assertNull(s.grade)
    }

    @Test
    fun fromJson_decodesAllZeroFCardAsContent() {
        // The backend returns this card (HTTP 200) when there are no drives; the web `score ?` gate
        // is truthy so the gauge renders rather than the empty state.
        val json =
            Json.parseToJsonElement(
                """{"overall":0,"efficiency":0,"smoothness":0,"speed_discipline":0,"grade":"F","total_drives":0,"trend":"flat"}""",
            )

        val s = requireNotNull(DriveScoreSnapshot.fromJson(json))
        assertEquals(0.0, s.overall, EPS)
        assertEquals("F", s.grade)
    }

    @Test
    fun fromJson_returnsNullForNonObjectBody() {
        assertNull(DriveScoreSnapshot.fromJson(Json.parseToJsonElement("null")))
        assertNull(DriveScoreSnapshot.fromJson(Json.parseToJsonElement("[]")))
    }

    // ---- band heuristic (web scoreColor) --------------------------------------------

    @Test
    fun bandFor_matchesWebThresholds() {
        assertEquals(DriveScoreBand.Excellent, DriveScoreGaugeProjection.bandFor(100.0))
        assertEquals(DriveScoreBand.Excellent, DriveScoreGaugeProjection.bandFor(80.0))
        assertEquals(DriveScoreBand.Good, DriveScoreGaugeProjection.bandFor(79.9))
        assertEquals(DriveScoreBand.Good, DriveScoreGaugeProjection.bandFor(60.0))
        assertEquals(DriveScoreBand.Fair, DriveScoreGaugeProjection.bandFor(59.9))
        assertEquals(DriveScoreBand.Fair, DriveScoreGaugeProjection.bandFor(40.0))
        assertEquals(DriveScoreBand.Poor, DriveScoreGaugeProjection.bandFor(39.9))
        assertEquals(DriveScoreBand.Poor, DriveScoreGaugeProjection.bandFor(0.0))
    }

    // ---- projection (web gauge + stats + subScores) ---------------------------------

    @Test
    fun project_buildsGaugeGradeBandAndBreakdown() {
        val view = project(snapshot())

        assertEquals(85.0, view.gaugeValue, EPS)
        assertEquals("A", view.gradeLabel)
        assertEquals(DriveScoreBand.Excellent, view.band)
        assertEquals("Weekly score", view.weeklyLabel)

        assertEquals(3, view.breakdown.size)
        assertBreakdown(view.breakdown[0], "efficiency", "Efficiency", "82", DriveScoreBand.Excellent)
        assertBreakdown(view.breakdown[1], "smoothness", "Smoothness", "88", DriveScoreBand.Excellent)
        assertBreakdown(view.breakdown[2], "speed", "Speed Discipline", "80", DriveScoreBand.Excellent)
        // The bar fills from the raw Double value (web `value={s.value}`).
        assertEquals(82.0, view.breakdown[0].value, EPS)
    }

    @Test
    fun project_breakdownBandsAndDisplayArePerScore() {
        val view = project(snapshot(efficiency = 72.6, smoothness = 55.4, speedDiscipline = 38.2))

        // Display mirrors the web `${value}` interpolation (raw, not rounded); the band is per score.
        assertBreakdown(view.breakdown[0], "efficiency", "Efficiency", "72.6", DriveScoreBand.Good)
        assertBreakdown(view.breakdown[1], "smoothness", "Smoothness", "55.4", DriveScoreBand.Fair)
        assertBreakdown(view.breakdown[2], "speed", "Speed Discipline", "38.2", DriveScoreBand.Poor)
        assertEquals(72.6, view.breakdown[0].value, EPS)
    }

    @Test
    fun project_blankOrMissingGradeFallsBackToEmDash() {
        assertEquals(EM_DASH, project(snapshot(grade = null)).gradeLabel)
        assertEquals(EM_DASH, project(snapshot(grade = "  ")).gradeLabel)
    }

    @Test
    fun project_poorOverallUsesPoorBand() {
        assertEquals(DriveScoreBand.Poor, project(snapshot(overall = 12.0, grade = "F")).band)
    }

    // ---- registry metadata (web registry/driving.ts) --------------------------------

    @Test
    fun registry_metadataMatchesWebRegistry() {
        assertEquals("drive-score-gauge", DriveScoreGaugeRegistration.ID)
        assertEquals("driving", DriveScoreGaugeRegistration.CATEGORY)
        assertEquals("DriveScoreGaugeWidget", DriveScoreGaugeRegistration.SLUG)
        assertEquals(DriveScoreGaugeSize(cols = 1, rows = 2), DriveScoreGaugeRegistration.defaultSize)
        assertEquals(DriveScoreGaugeSize(cols = 1, rows = 2), DriveScoreGaugeRegistration.minSize)
        assertEquals(DriveScoreGaugeSize(cols = 2, rows = 40), DriveScoreGaugeRegistration.maxSize)
    }

    @Test
    fun registry_boundsAndClampHonourMinMax() {
        assertTrue(DriveScoreGaugeRegistration.withinBounds(DriveScoreGaugeSize(cols = 1, rows = 2)))
        assertFalse(DriveScoreGaugeRegistration.withinBounds(DriveScoreGaugeSize(cols = 0, rows = 1)))
        assertFalse(DriveScoreGaugeRegistration.withinBounds(DriveScoreGaugeSize(cols = 3, rows = 50)))
        assertEquals(
            DriveScoreGaugeSize(cols = 1, rows = 2),
            DriveScoreGaugeRegistration.clamp(DriveScoreGaugeSize(cols = 0, rows = 0)),
        )
        assertEquals(
            DriveScoreGaugeSize(cols = 2, rows = 40),
            DriveScoreGaugeRegistration.clamp(DriveScoreGaugeSize(cols = 9, rows = 99)),
        )
    }

    @Test
    fun size_flagsMatchWeb() {
        assertTrue(DriveScoreGaugeSize(cols = 1, rows = 1).isCompact)
        assertFalse(DriveScoreGaugeSize(cols = 1, rows = 2).isCompact)
        assertFalse(DriveScoreGaugeSize(cols = 1, rows = 1).isTall)
        assertTrue(DriveScoreGaugeSize(cols = 1, rows = 2).isTall)
        assertTrue(DriveScoreGaugeSize(cols = 2, rows = 4).isTall)
    }

    // ---- Resource mapper (cache-then-network preservation) --------------------------

    @Test
    fun resourceMapper_parsesPayloadAndPreservesStatus() {
        val json = Json.parseToJsonElement("""{"overall":85,"grade":"A"}""")

        val cached = Resource.Loading(cached = json, fetchedAt = NOW, stale = true).toDriveScoreSnapshot()
        assertTrue(cached is Resource.Loading)
        assertTrue(cached.stale)
        assertEquals(85.0, requireNotNull(cached.cached).overall, EPS)

        val offline =
            Resource.Error(cached = json, fetchedAt = NOW, stale = true, error = ApiError.Network()).toDriveScoreSnapshot()
        assertTrue(offline is Resource.Error)
        assertEquals("A", requireNotNull(offline.cached?.grade))
    }

    @Test
    fun resourceMapper_successWithNonObjectBecomesNullSnapshot() {
        val mapped =
            Resource.Success(data = Json.parseToJsonElement("null"), fetchedAt = NOW, stale = false).toDriveScoreSnapshot()
        assertTrue(mapped is Resource.Success)
        assertNull((mapped as Resource.Success).data)
    }

    private fun assertBreakdown(
        item: DriveScoreBreakdownItem,
        key: String,
        label: String,
        valueText: String,
        band: DriveScoreBand,
    ) {
        assertEquals(key, item.key)
        assertEquals(label, item.label)
        assertEquals(valueText, item.valueText)
        assertEquals(band, item.band)
    }

    private companion object {
        const val EPS = 1e-9
        const val NOW = 1_700_000_000_000L
        const val EM_DASH = "\u2014"
    }
}
