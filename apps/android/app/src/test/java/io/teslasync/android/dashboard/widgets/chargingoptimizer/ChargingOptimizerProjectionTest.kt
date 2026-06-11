package io.teslasync.android.dashboard.widgets.chargingoptimizer

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlinx.serialization.json.JsonArray
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
 * Off-device verification of the ChargingOptimizerWidget's pure logic — the tolerant JSON parse, the
 * `formatHour` 12-hour clock, the schedule-match gate, the impact-badge map, the metric / short / peak
 * projection, the recommendation tips, the 24h timeline, the registry metadata, and the bounds/clamp.
 * Mirrors the web spec (web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx) and the WinUI
 * parity tests (apps/windows/.../ChargingOptimizerWidgetTests.cs).
 */
class ChargingOptimizerProjectionTest {
    private fun strings(): ChargingOptimizerStrings =
        ChargingOptimizerStrings(
            title = "Charging Optimizer",
            noData = "No optimizer data",
            optimalStart = "Optimal start",
            targetSoc = "Target SOC",
            savingsLabel = "Savings/mo",
            peakUsageTemplate = "Peak charging: %1\$s%%",
            optimized = "Optimized",
            canImprove = "Can improve",
            rateTimeline = "24h Rate Timeline",
            peak = "Peak",
            offpeak = "Off-peak",
            standard = "Standard",
            noRecommendations = "No recommendations",
            targetSocShortTemplate = "SOC %1\$s%%",
            savingsShortTemplate = "\$%1\$s/mo",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = ::renderRelative,
        )

    private fun fullBody(): JsonObject =
        buildJsonObject {
            put(
                "current_schedule",
                buildJsonObject {
                    put("most_common_start_hour", 8)
                    put("avg_charge_to_pct", 80)
                },
            )
            put(
                "cost_analysis",
                buildJsonObject {
                    put("potential_monthly_savings", 45)
                    put("sessions_during_peak_pct", 25)
                    put("peak_hours", hoursArray(17, 18))
                    put("offpeak_hours", hoursArray(2, 3))
                },
            )
            put(
                "recommendations",
                buildJsonArray {
                    add(
                        buildJsonObject {
                            put("type", "schedule")
                            put("priority", "high")
                            put("title", "Shift to off-peak")
                            put("detail", "Save money overnight")
                        },
                    )
                },
            )
        }

    private fun project(
        report: ChargingOptimizerReport,
        size: ChargingOptimizerSize = ChargingOptimizerRegistration.defaultSize,
    ): ChargingOptimizerDisplay = ChargingOptimizerProjection.project(report, size, strings())

    // ---- tolerant JSON parse (web !data gate + OptimizerJson) ----------------------

    @Test
    fun emptyOrNonObjectBodyYieldsEmptyReport() {
        assertFalse(ChargingOptimizerReport.fromJson(JsonNull).hasData)
        assertFalse(ChargingOptimizerReport.fromJson(JsonPrimitive("nope")).hasData)
        assertFalse(ChargingOptimizerReport.fromJson(buildJsonObject { }).hasData)
        assertEquals(ChargingOptimizerReport.Empty, ChargingOptimizerReport.fromJson(buildJsonObject { }))
    }

    @Test
    fun fullBodyParsesEverySurfacedField() {
        val report = ChargingOptimizerReport.fromJson(fullBody())
        assertTrue(report.hasData)
        assertEquals(8, report.optimalStartHour)
        assertEquals(80.0, report.targetSocPct, 0.0)
        assertEquals(45.0, report.monthlySavings, 0.0)
        assertEquals(25.0, report.peakPct, 0.0)
        assertEquals(listOf(17, 18), report.peakHours)
        assertEquals(listOf(2, 3), report.offpeakHours)
        assertEquals(1, report.recommendations.size)
        assertEquals("high", report.recommendations.single().priority)
    }

    @Test
    fun missingNestedObjectsFallBackToDefaults() {
        val report = ChargingOptimizerReport.fromJson(buildJsonObject { put("battery_health_score", 88) })
        assertTrue(report.hasData)
        assertEquals(0, report.optimalStartHour)
        assertEquals(0.0, report.targetSocPct, 0.0)
        assertEquals(0.0, report.monthlySavings, 0.0)
        assertEquals(0.0, report.peakPct, 0.0)
        assertTrue(report.peakHours.isEmpty())
        assertTrue(report.offpeakHours.isEmpty())
        assertTrue(report.recommendations.isEmpty())
    }

    @Test
    fun numericStringsParseButHourArrayIsNumberOnlyAndRangeChecked() {
        val body =
            buildJsonObject {
                put("current_schedule", buildJsonObject { put("avg_charge_to_pct", "80") })
                put(
                    "cost_analysis",
                    buildJsonObject {
                        put("sessions_during_peak_pct", "25")
                        put(
                            "peak_hours",
                            buildJsonArray {
                                add(17)
                                add(25)
                                add(-1)
                                add("18")
                            },
                        )
                    },
                )
            }
        val report = ChargingOptimizerReport.fromJson(body)
        // Scalar getDouble accepts a numeric string (web/Windows parity)…
        assertEquals(80.0, report.targetSocPct, 0.0)
        assertEquals(25.0, report.peakPct, 0.0)
        // …but the hour array is number-only and clamps to 0..23, so 25 / -1 / "18" are dropped.
        assertEquals(listOf(17), report.peakHours)
    }

    @Test
    fun hourIsRoundedAndClampedZeroToTwentyFour() {
        val body = buildJsonObject { put("current_schedule", buildJsonObject { put("most_common_start_hour", 30) }) }
        assertEquals(24, ChargingOptimizerReport.fromJson(body).optimalStartHour)
    }

    @Test
    fun recommendationTitleAndDetailFallBackToEmDash() {
        val body =
            buildJsonObject {
                put("recommendations", buildJsonArray { add(buildJsonObject { put("priority", "low") }) })
            }
        val rec = ChargingOptimizerReport.fromJson(body).recommendations.single()
        assertEquals("\u2014", rec.title)
        assertEquals("\u2014", rec.detail)
        assertEquals("low", rec.priority)
    }

    // ---- formatHour (web local formatHour) -----------------------------------------

    @Test
    fun formatHourMatchesWebTwelveHourClock() {
        assertEquals("12 AM", ChargingOptimizerProjection.formatHour(0))
        assertEquals("12 AM", ChargingOptimizerProjection.formatHour(24))
        assertEquals("6 AM", ChargingOptimizerProjection.formatHour(6))
        assertEquals("12 PM", ChargingOptimizerProjection.formatHour(12))
        assertEquals("6 PM", ChargingOptimizerProjection.formatHour(18))
        assertEquals("11 PM", ChargingOptimizerProjection.formatHour(23))
    }

    // ---- schedule gate + impact map ------------------------------------------------

    @Test
    fun scheduleMatchesOptimalBelowThirtyPercent() {
        assertTrue(ChargingOptimizerReport.Empty.copy(peakPct = 29.9).scheduleMatchesOptimal)
        assertFalse(ChargingOptimizerReport.Empty.copy(peakPct = 30.0).scheduleMatchesOptimal)
    }

    @Test
    fun impactToneAndKnownPriorityMatchWeb() {
        assertEquals(OptimizerBadgeTone.Success, ChargingOptimizerProjection.impactToneFor("high"))
        assertEquals(OptimizerBadgeTone.Warning, ChargingOptimizerProjection.impactToneFor("medium"))
        assertEquals(OptimizerBadgeTone.Neutral, ChargingOptimizerProjection.impactToneFor("low"))
        assertEquals(OptimizerBadgeTone.Neutral, ChargingOptimizerProjection.impactToneFor("urgent"))
        assertTrue(ChargingOptimizerProjection.isKnownPriority("high"))
        assertTrue(ChargingOptimizerProjection.isKnownPriority("low"))
        assertFalse(ChargingOptimizerProjection.isKnownPriority(""))
        assertFalse(ChargingOptimizerProjection.isKnownPriority("urgent"))
    }

    // ---- metric + short-string projection ------------------------------------------

    @Test
    fun metricsProjectValueLabelAndAccessibleName() {
        val display = project(ChargingOptimizerReport.fromJson(fullBody()))
        assertEquals("8 AM", display.optimalStartMetric.value)
        assertEquals("Optimal start", display.optimalStartMetric.label)
        assertEquals("Optimal start: 8 AM", display.optimalStartMetric.contentDescription)

        assertEquals("80%", display.targetSocMetric.value)
        assertEquals("Target SOC: 80%", display.targetSocMetric.contentDescription)

        assertEquals("\$45", display.savingsMetric.value)
        assertEquals("Savings/mo: \$45", display.savingsMetric.contentDescription)
    }

    @Test
    fun shortStringsAndPeakUsageFillTemplates() {
        val display = project(ChargingOptimizerReport.fromJson(fullBody()))
        assertEquals("SOC 80%", display.targetSocShortText)
        assertEquals("\$45/mo", display.savingsShortText)
        assertEquals("Peak charging: 25%", display.peakUsageText)
        assertTrue(display.showSavingsBadge)
    }

    @Test
    fun zeroSavingsHidesBadge() {
        val report = ChargingOptimizerReport.fromJson(fullBody()).copy(monthlySavings = 0.0)
        assertFalse(project(report).showSavingsBadge)
    }

    @Test
    fun thousandsSavingsUseGroupingSeparator() {
        val report = ChargingOptimizerReport.fromJson(fullBody()).copy(monthlySavings = 1_234.0)
        assertEquals("\$1,234", project(report).savingsMetric.value)
        assertEquals("\$1,234/mo", project(report).savingsShortText)
    }

    // ---- schedule badge ------------------------------------------------------------

    @Test
    fun scheduleBadgeReflectsOptimizedVsCanImprove() {
        val optimized = project(ChargingOptimizerReport.fromJson(fullBody()))
        assertTrue(optimized.scheduleMatchesOptimal)
        assertEquals("Optimized", optimized.scheduleBadgeText)
        assertEquals(OptimizerBadgeTone.Success, optimized.scheduleBadgeTone)

        val canImprove = project(ChargingOptimizerReport.fromJson(fullBody()).copy(peakPct = 60.0))
        assertFalse(canImprove.scheduleMatchesOptimal)
        assertEquals("Can improve", canImprove.scheduleBadgeText)
        assertEquals(OptimizerBadgeTone.Warning, canImprove.scheduleBadgeTone)
    }

    // ---- compact content description -----------------------------------------------

    @Test
    fun compactContentDescriptionFoldsStartSocAndSavings() {
        val withSavings = project(ChargingOptimizerReport.fromJson(fullBody()), ChargingOptimizerSize(1, 2))
        assertEquals("Optimal start: 8 AM, SOC 80%, \$45/mo", withSavings.compactContentDescription)

        val noSavings =
            project(
                ChargingOptimizerReport.fromJson(fullBody()).copy(monthlySavings = 0.0),
                ChargingOptimizerSize(1, 2),
            )
        // Only savings is zeroed here, so the SOC stays 80% and the savings clause is dropped.
        assertEquals("Optimal start: 8 AM, SOC 80%", noSavings.compactContentDescription)
    }

    // ---- recommendation tips -------------------------------------------------------

    @Test
    fun tipProjectsTitleDescriptionImpactAndAccessibleName() {
        val tip = project(ChargingOptimizerReport.fromJson(fullBody())).tips.single()
        assertEquals(0, tip.id)
        assertEquals("Shift to off-peak", tip.title)
        assertEquals("Save money overnight", tip.description)
        assertTrue(tip.hasImpact)
        assertEquals("high", tip.impactLabel)
        assertEquals(OptimizerBadgeTone.Success, tip.impactTone)
        assertEquals("high: Shift to off-peak. Save money overnight", tip.contentDescription)
    }

    @Test
    fun tipWithoutKnownPriorityHasNoImpactChip() {
        val report =
            ChargingOptimizerReport.Empty.copy(
                hasData = true,
                recommendations =
                    listOf(OptimizerRecommendation("eco", "", "Tip", "Detail", null)),
            )
        val tip = project(report).tips.single()
        assertFalse(tip.hasImpact)
        assertEquals("Tip. Detail", tip.contentDescription)
    }

    @Test
    fun maxTipsIsThreeStandardFiveWide() {
        val report =
            ChargingOptimizerReport.Empty.copy(
                hasData = true,
                recommendations = (1..6).map { OptimizerRecommendation("t", "low", "T$it", "D$it", null) },
            )
        assertEquals(ChargingOptimizerProjection.MAX_STANDARD_TIPS, project(report, ChargingOptimizerSize(2, 2)).maxTips)
        assertEquals(ChargingOptimizerProjection.MAX_WIDE_TIPS, project(report, ChargingOptimizerSize(4, 4)).maxTips)
        // The projection keeps every tip; the render caps to maxTips.
        assertEquals(6, project(report).tips.size)
    }

    // ---- 24h rate timeline ---------------------------------------------------------

    @Test
    fun timelineClassifiesHoursWithPeakPrecedenceAndStartMarker() {
        val display = project(ChargingOptimizerReport.fromJson(fullBody()), ChargingOptimizerSize(4, 4))
        assertEquals(24, display.segments.size)
        assertEquals(OptimizerRateKind.Peak, display.segments[17].kind)
        assertEquals(OptimizerRateKind.Offpeak, display.segments[2].kind)
        assertEquals(OptimizerRateKind.Standard, display.segments[10].kind)
        assertTrue(display.segments[8].isCurrentStart)
        assertFalse(display.segments[9].isCurrentStart)
        assertEquals("5 PM \u2014 Peak", display.segments[17].label)
        assertEquals("2 AM \u2014 Off-peak", display.segments[2].label)
        assertEquals("10 AM \u2014 Standard", display.segments[10].label)
    }

    @Test
    fun timelinePeakWinsWhenHourInBothSets() {
        val report = ChargingOptimizerReport.Empty.copy(hasData = true, peakHours = listOf(5), offpeakHours = listOf(5))
        val display = project(report, ChargingOptimizerSize(4, 4))
        assertEquals(OptimizerRateKind.Peak, display.segments[5].kind)
    }

    // ---- registry metadata (web registry/charging.ts) ------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("charging-optimizer", ChargingOptimizerRegistration.ID)
        assertEquals("charging", ChargingOptimizerRegistration.CATEGORY)
        assertEquals("ChargingOptimizerWidget", ChargingOptimizerRegistration.SLUG)
        assertEquals(ChargingOptimizerSize(2, 2), ChargingOptimizerRegistration.defaultSize)
        assertEquals(ChargingOptimizerSize(1, 2), ChargingOptimizerRegistration.minSize)
        assertEquals(ChargingOptimizerSize(4, 40), ChargingOptimizerRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(ChargingOptimizerRegistration.isWithinBounds(ChargingOptimizerSize(2, 2)))
        assertFalse(ChargingOptimizerRegistration.isWithinBounds(ChargingOptimizerSize(0, 1)))
        assertFalse(ChargingOptimizerRegistration.isWithinBounds(ChargingOptimizerSize(5, 50)))
        assertEquals(ChargingOptimizerSize(1, 2), ChargingOptimizerRegistration.clamp(ChargingOptimizerSize(0, 0)))
        assertEquals(ChargingOptimizerSize(4, 40), ChargingOptimizerRegistration.clamp(ChargingOptimizerSize(9, 99)))
    }

    @Test
    fun sizeFlagsFollowColumnCount() {
        assertTrue(ChargingOptimizerSize(1, 4).isCompact)
        assertFalse(ChargingOptimizerSize(2, 4).isCompact)
        assertFalse(ChargingOptimizerSize(2, 4).isWide)
        assertTrue(ChargingOptimizerSize(4, 4).isWide)
    }

    private fun hoursArray(vararg hours: Int): JsonArray = buildJsonArray { hours.forEach { add(it) } }

    private fun renderRelative(age: FreshnessAge): String =
        when (age) {
            FreshnessAge.Unknown -> "\u2014"
            FreshnessAge.JustNow -> "just now"
            is FreshnessAge.Seconds -> "${age.value}s ago"
            is FreshnessAge.Minutes -> "${age.value}m ago"
            is FreshnessAge.Hours -> "${age.value}h ago"
            is FreshnessAge.Days -> "${age.value}d ago"
            is FreshnessAge.Weeks -> "${age.value}w ago"
        }
}
