package io.teslasync.android.dashboard.widgets.drivingcoach

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DrivingCoachWidget's pure logic — the tolerant JSON parse, the
 * `savingsPct` (web `Math.round` half-up) gate, the impact-badge map, the score / savings-badge
 * projection, the recommendation tips, the registry metadata, and the bounds/clamp. Mirrors the web spec
 * (web/src/features/dashboard/widgets/DrivingCoachWidget.tsx) and the sibling ChargingOptimizer parity
 * tests.
 */
class DrivingCoachProjectionTest {
    private fun strings(): DrivingCoachStrings =
        DrivingCoachStrings(
            title = "Driving Coach",
            scoreLabel = "/ 100",
            potentialSavingsTemplate = "Potential savings: %1\$s%%",
            noTips = "No tips available",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = { _ -> "" },
        )

    private fun fullBody(): JsonObject =
        buildJsonObject {
            put("overall_score", 87)
            put("efficiency_wh_km", 160)
            put("best_efficiency_wh_km", 140)
            put(
                "recommendations",
                buildJsonArray {
                    add(
                        buildJsonObject {
                            put("category", "Highway speed")
                            put("tip", "Slow down on highways")
                            put("impact", "high")
                        },
                    )
                },
            )
        }

    private fun project(
        report: DrivingCoachReport,
        size: DrivingCoachSize = DrivingCoachRegistration.defaultSize,
    ): DrivingCoachDisplay = DrivingCoachProjection.project(report, size, strings())

    // ---- tolerant JSON parse (web !data gate + CoachJson) --------------------------

    @Test
    fun emptyOrNonObjectBodyYieldsEmptyReport() {
        assertFalse(DrivingCoachReport.fromJson(JsonNull).hasData)
        assertFalse(DrivingCoachReport.fromJson(JsonPrimitive("nope")).hasData)
        assertFalse(DrivingCoachReport.fromJson(buildJsonObject { }).hasData)
        assertEquals(DrivingCoachReport.Empty, DrivingCoachReport.fromJson(buildJsonObject { }))
    }

    @Test
    fun fullBodyParsesEverySurfacedField() {
        val report = DrivingCoachReport.fromJson(fullBody())
        assertTrue(report.hasData)
        assertEquals(87.0, report.overallScore, 0.0)
        assertEquals(160.0, report.efficiencyWhKm, 0.0)
        assertEquals(140.0, report.bestEfficiencyWhKm, 0.0)
        assertEquals(1, report.recommendations.size)
        val rec = report.recommendations.single()
        assertEquals("Highway speed", rec.category)
        assertEquals("Slow down on highways", rec.tip)
        assertEquals("high", rec.impact)
    }

    @Test
    fun missingFieldsFallBackToDefaults() {
        val report = DrivingCoachReport.fromJson(buildJsonObject { put("total_drives_analyzed", 12) })
        assertTrue(report.hasData)
        assertEquals(0.0, report.overallScore, 0.0)
        assertEquals(0.0, report.efficiencyWhKm, 0.0)
        assertEquals(0.0, report.bestEfficiencyWhKm, 0.0)
        assertTrue(report.recommendations.isEmpty())
    }

    @Test
    fun numericStringScoreParses() {
        val report = DrivingCoachReport.fromJson(buildJsonObject { put("overall_score", "85") })
        assertEquals(85.0, report.overallScore, 0.0)
    }

    @Test
    fun recommendationCategoryAndTipFallBackToEmDash() {
        val body =
            buildJsonObject {
                put("recommendations", buildJsonArray { add(buildJsonObject { put("impact", "low") }) })
            }
        val rec = DrivingCoachReport.fromJson(body).recommendations.single()
        assertEquals("\u2014", rec.category)
        assertEquals("\u2014", rec.tip)
        assertEquals("low", rec.impact)
    }

    // ---- savingsPct (web Math.round half-up) ---------------------------------------

    @Test
    fun savingsPctComputedLikeWeb() {
        assertEquals(25, report(current = 160.0, best = 120.0).savingsPct)
        assertEquals(0, report(current = 160.0, best = 160.0).savingsPct)
        // Guard: a non-positive current efficiency yields 0 (web `currentEff > 0 ? … : 0`).
        assertEquals(0, report(current = 0.0, best = 100.0).savingsPct)
        // Negative savings (best worse than current) are preserved; the badge simply hides.
        assertEquals(-25, report(current = 160.0, best = 200.0).savingsPct)
    }

    @Test
    fun savingsPctRoundsHalfTowardPositiveInfinity() {
        // 12.5 → 13 and -2.5 → -2, matching JS Math.round (ties round toward +∞).
        assertEquals(13, report(current = 200.0, best = 175.0).savingsPct)
        assertEquals(-2, report(current = 200.0, best = 205.0).savingsPct)
    }

    // ---- impact map ----------------------------------------------------------------

    @Test
    fun impactToneAndKnownImpactMatchWeb() {
        assertEquals(CoachBadgeTone.Success, DrivingCoachProjection.impactToneFor("high"))
        assertEquals(CoachBadgeTone.Warning, DrivingCoachProjection.impactToneFor("medium"))
        assertEquals(CoachBadgeTone.Neutral, DrivingCoachProjection.impactToneFor("low"))
        assertEquals(CoachBadgeTone.Neutral, DrivingCoachProjection.impactToneFor("urgent"))
        assertTrue(DrivingCoachProjection.isKnownImpact("high"))
        assertTrue(DrivingCoachProjection.isKnownImpact("low"))
        assertFalse(DrivingCoachProjection.isKnownImpact(""))
        assertFalse(DrivingCoachProjection.isKnownImpact("urgent"))
    }

    // ---- projection ----------------------------------------------------------------

    @Test
    fun projectionFormatsScoreSavingsAndTip() {
        val display = project(DrivingCoachReport.fromJson(fullBody()))
        assertEquals("87", display.scoreText)
        assertEquals("/ 100", display.scoreLabel)
        assertEquals(13, display.savingsPct)
        assertTrue(display.showSavingsBadge)
        assertEquals("Potential savings: 13%", display.savingsBadgeText)
        assertEquals(DrivingCoachProjection.MAX_TIPS, display.maxTips)
        assertEquals(1, display.tips.size)
        val tip = display.tips.single()
        assertEquals("Highway speed", tip.title)
        assertEquals("Slow down on highways", tip.description)
        assertTrue(tip.hasImpact)
        assertEquals("high", tip.impactLabel)
        assertEquals(CoachBadgeTone.Success, tip.impactTone)
        assertEquals("high: Highway speed. Slow down on highways", tip.contentDescription)
    }

    @Test
    fun tipWithoutKnownImpactShowsNoChipAndPlainDescription() {
        val body =
            buildJsonObject {
                put(
                    "recommendations",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("category", "Tire pressure")
                                put("tip", "Inflate to spec")
                            },
                        )
                    },
                )
            }
        val tip = project(DrivingCoachReport.fromJson(body)).tips.single()
        assertFalse(tip.hasImpact)
        assertEquals("Tire pressure. Inflate to spec", tip.contentDescription)
    }

    @Test
    fun compactInlineEmptyOnlyWhenNoSavingsAndNoRecommendations() {
        val compact = DrivingCoachSize(cols = 1, rows = 2)
        // Score present but no savings + no tips → the compact inline empty shows.
        val empty = project(report(current = 150.0, best = 150.0), compact)
        assertTrue(empty.compactShowsEmptyState)
        assertFalse(empty.showSavingsBadge)
        assertTrue(empty.compactContentDescription.contains("No tips available"))
        // Savings present → no inline empty.
        assertFalse(project(report(current = 160.0, best = 120.0), compact).compactShowsEmptyState)
        // Recommendations present → no inline empty.
        assertFalse(project(DrivingCoachReport.fromJson(fullBody()), compact).compactShowsEmptyState)
    }

    @Test
    fun savingsBadgeHiddenWhenNotPositive() {
        assertFalse(project(report(current = 160.0, best = 160.0)).showSavingsBadge)
        assertFalse(project(report(current = 160.0, best = 200.0)).showSavingsBadge)
    }

    // ---- registry metadata + bounds ------------------------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("driving-coach", DrivingCoachRegistration.ID)
        assertEquals("driving", DrivingCoachRegistration.CATEGORY)
        assertEquals("DrivingCoachWidget", DrivingCoachRegistration.SLUG)
        assertEquals(DrivingCoachSize(2, 4), DrivingCoachRegistration.defaultSize)
        assertEquals(DrivingCoachSize(1, 2), DrivingCoachRegistration.minSize)
        assertEquals(DrivingCoachSize(4, 40), DrivingCoachRegistration.maxSize)
    }

    @Test
    fun boundsAndClampHonourMinMaxFootprint() {
        assertTrue(DrivingCoachRegistration.isWithinBounds(DrivingCoachSize(2, 4)))
        assertFalse(DrivingCoachRegistration.isWithinBounds(DrivingCoachSize(0, 1)))
        assertFalse(DrivingCoachRegistration.isWithinBounds(DrivingCoachSize(5, 41)))
        assertEquals(DrivingCoachSize(1, 2), DrivingCoachRegistration.clamp(DrivingCoachSize(0, 1)))
        assertEquals(DrivingCoachSize(4, 40), DrivingCoachRegistration.clamp(DrivingCoachSize(9, 99)))
    }

    @Test
    fun compactSizeFlagMatchesWeb() {
        assertTrue(DrivingCoachSize(cols = 1, rows = 2).isCompact)
        assertFalse(DrivingCoachSize(cols = 2, rows = 4).isCompact)
    }

    private fun report(
        current: Double,
        best: Double,
    ): DrivingCoachReport =
        DrivingCoachReport.Empty.copy(
            hasData = true,
            overallScore = 90.0,
            efficiencyWhKm = current,
            bestEfficiencyWhKm = best,
        )
}
