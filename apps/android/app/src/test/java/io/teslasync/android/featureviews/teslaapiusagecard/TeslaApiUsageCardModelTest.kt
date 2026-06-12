package io.teslasync.android.featureviews.teslaapiusagecard

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the operator TeslaApiUsageCard's pure logic — the native analogue of every
 * derivation the web component performs (web/src/features/system/components/status/TeslaApiUsageCard.tsx): the
 * two payload adapters ([TeslaApiUsage.fromJson] / [TeslaApiLogStats.fromJson]), the billing-window arithmetic
 * (days elapsed / remaining / total), the budget percentage + intent, the band / detail figures, the
 * forecast + error intents, the `dedupeMap` camelCase-clone collapse, the top-services sort + slice, the
 * cache-then-network [Resource] -> [io.teslasync.android.data.UiState] mappings (loading / empty / content /
 * error / offline), and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 * `Locale.US` + a fixed UTC instant pin the grouping/separator and the countdown so the assertions are
 * deterministic, mirroring the web test's frozen `NOW`.
 */
class TeslaApiUsageCardModelTest {
    private val us = TeslaApiUsageFormatting(currencySymbol = "$", precision = 2, locale = Locale.US)

    private fun usageJson(): JsonObject =
        buildJsonObject {
            put("total_requests", 39_436)
            put("skipped_polls", 0)
            put("estimated_cost", 87.55)
            put("cost_per_request", 0.00222)
            put("monthly_credit", 10)
            put("estimated_remaining", 0)
        }

    private fun logStatsJson(): JsonObject =
        buildJsonObject {
            put("last_24h", 2_800)
            put("error_rate", 1.2)
            put("error_count", 470)
            put("avg_duration_ms", 184)
            putJsonObject("by_method") {
                put("GET", 30_000)
                put("POST", 9_436)
            }
            putJsonObject("by_service") {
                put("tesla_fleet", 28_000)
                put("tesla_streaming", 11_000)
            }
        }

    private fun usage(skippedPolls: Double = 0.0): TeslaApiUsage =
        TeslaApiUsage(
            totalRequests = 39_436.0,
            skippedPolls = skippedPolls,
            estimatedCost = 87.55,
            costPerRequest = 0.00222,
            monthlyCredit = 10.0,
            estimatedRemaining = 0.0,
        )

    private fun logStats(): TeslaApiLogStats = requireNotNull(TeslaApiLogStats.fromJson(logStatsJson()))

    // ── Data adapter: usage.fromJson ──────────────────────────────────────────────────

    @Test
    fun usageFromJsonParsesEverySnakeCaseFieldThisCardReads() {
        val data = requireNotNull(TeslaApiUsage.fromJson(usageJson()))

        assertEquals(39_436.0, requireNotNull(data.totalRequests), DELTA)
        assertEquals(0.0, requireNotNull(data.skippedPolls), DELTA)
        assertEquals(87.55, requireNotNull(data.estimatedCost), DELTA)
        assertEquals(0.00222, requireNotNull(data.costPerRequest), DELTA)
        assertEquals(10.0, requireNotNull(data.monthlyCredit), DELTA)
        assertEquals(0.0, requireNotNull(data.estimatedRemaining), DELTA)
    }

    @Test
    fun usageFromJsonReturnsNullForANonObjectPayload() {
        assertNull(TeslaApiUsage.fromJson(null))
        assertNull(TeslaApiUsage.fromJson(JsonPrimitive("not-an-object")))
    }

    @Test
    fun usageFromJsonLeavesAbsentFieldsNull() {
        val data = requireNotNull(TeslaApiUsage.fromJson(buildJsonObject { put("total_requests", 3) }))

        assertEquals(3.0, requireNotNull(data.totalRequests), DELTA)
        assertNull(data.estimatedCost)
        assertNull(data.monthlyCredit)
    }

    // ── Data adapter: logStats.fromJson ─────────────────────────────────────────────────

    @Test
    fun logStatsFromJsonParsesSnakeCaseScalarsAndGroupedMaps() {
        val data = requireNotNull(TeslaApiLogStats.fromJson(logStatsJson()))

        assertEquals(2_800.0, requireNotNull(data.last24h), DELTA)
        assertEquals(1.2, requireNotNull(data.errorRate), DELTA)
        assertEquals(470.0, requireNotNull(data.errorCount), DELTA)
        assertEquals(184.0, requireNotNull(data.avgDurationMs), DELTA)
        assertEquals(mapOf("GET" to 30_000.0, "POST" to 9_436.0), data.byMethod)
        assertEquals(mapOf("tesla_fleet" to 28_000.0, "tesla_streaming" to 11_000.0), data.byService)
    }

    @Test
    fun logStatsFromJsonReadsTheCamelCaseAliasAsAFallback() {
        val camel =
            buildJsonObject {
                put("last24h", 99)
                put("errorRate", 3.0)
                putJsonObject("byMethod") { put("GET", 7) }
            }

        val data = requireNotNull(TeslaApiLogStats.fromJson(camel))

        assertEquals(99.0, requireNotNull(data.last24h), DELTA)
        assertEquals(3.0, requireNotNull(data.errorRate), DELTA)
        assertEquals(mapOf("GET" to 7.0), data.byMethod)
    }

    @Test
    fun logStatsFromJsonReturnsNullForANonObjectPayload() {
        assertNull(TeslaApiLogStats.fromJson(null))
        assertNull(TeslaApiLogStats.fromJson(JsonPrimitive("x")))
    }

    // ── Projection: billing window (days elapsed / total / remaining) ─────────────────

    @Test
    fun projectComputesTheBillingWindowCountdown() {
        val display = TeslaApiUsageProjection.project(usage(), logStats(), us, NOW, ZONE)

        // 2025-01-15T12:00Z → day 15 of 31, resets in 16 days (mirrors the web test).
        assertEquals(15, display.daysElapsed)
        assertEquals(31, display.totalDaysInMonth)
        assertEquals(16, display.daysRemaining)
    }

    // ── Projection: budget bar + intent ───────────────────────────────────────────────

    @Test
    fun projectFormatsTheBudgetHeadlinePercentageAndOverage() {
        val display = TeslaApiUsageProjection.project(usage(), logStats(), us, NOW, ZONE)

        assertEquals("$87.55", display.estimatedCostText)
        assertEquals("$10.00", display.monthlyCreditText)
        // 87.55 / 10 = 875.4999… → rounds to 875 exactly as the web test locks in.
        assertEquals("875%", display.pctOfBudgetText)
        assertTrue(display.overBudget)
        assertEquals(ApiUsageIntent.Danger, display.budgetIntent)
        assertEquals("$77.55", display.overageText)
    }

    @Test
    fun budgetIntentIsWarnAboveEightyPercentAndNormalBelow() {
        val warn =
            TeslaApiUsageProjection.project(
                usage().copy(estimatedCost = 9.0, monthlyCredit = 10.0),
                logStats(),
                us,
                NOW,
                ZONE,
            )
        assertFalse(warn.overBudget)
        assertEquals(ApiUsageIntent.Warn, warn.budgetIntent)

        val normal =
            TeslaApiUsageProjection.project(
                usage().copy(estimatedCost = 2.0, monthlyCredit = 10.0),
                logStats(),
                us,
                NOW,
                ZONE,
            )
        assertEquals(ApiUsageIntent.Normal, normal.budgetIntent)
    }

    // ── Projection: bands ───────────────────────────────────────────────────────────────

    @Test
    fun projectFormatsTheBandFigures() {
        val display = TeslaApiUsageProjection.project(usage(), logStats(), us, NOW, ZONE)

        assertEquals("39,436", display.totalRequestsText)
        assertEquals("$5.84", display.dailyAvgCostText) // 87.55 / 15
        assertEquals("2,800", display.last24hText)
        assertEquals("$6.22", display.last24hBurnText) // 2800 * 0.00222
        assertEquals("$180.94", display.forecastFromMtdText) // 5.8367 * 31
        assertEquals("$192.70", display.forecastFromRecentText) // 6.216 * 31
        assertEquals(ApiUsageIntent.Danger, display.forecastIntent) // 180.94 > 10
    }

    // ── Projection: details ─────────────────────────────────────────────────────────────

    @Test
    fun projectFormatsTheDetailFigures() {
        val display = TeslaApiUsageProjection.project(usage(skippedPolls = 1_280.0), logStats(), us, NOW, ZONE)

        assertEquals("38,156", display.usefulText) // 39,436 − 1,280
        assertEquals("1,280", display.skippedText)
        assertEquals("184", display.avgLatencyText)
        assertEquals("1.2%", display.errorRateText)
        assertEquals("470", display.errorCountText)
        assertEquals(ApiUsageIntent.Warn, display.errorIntent) // 1.2% ≥ 1%, < 5%
    }

    @Test
    fun projectRoundsAverageLatencyToWholeMillis() {
        val stats = logStats().copy(avgDurationMs = 184.7)

        val display = TeslaApiUsageProjection.project(usage(), stats, us, NOW, ZONE)

        assertEquals("185", display.avgLatencyText)
    }

    @Test
    fun errorIntentIsDangerAtOrAboveFivePercentAndNormalWhenAbsent() {
        val danger = TeslaApiUsageProjection.project(usage(), logStats().copy(errorRate = 7.0), us, NOW, ZONE)
        assertEquals(ApiUsageIntent.Danger, danger.errorIntent)

        val absent = TeslaApiUsageProjection.project(usage(), logStats().copy(errorRate = null), us, NOW, ZONE)
        assertEquals(ApiUsageIntent.Normal, absent.errorIntent)
        assertNull(absent.errorRateText)
    }

    // ── Projection: degradation when log stats are missing ──────────────────────────────

    @Test
    fun projectEmDashesTheLogStatFiguresWhenStatsAreMissing() {
        val display = TeslaApiUsageProjection.project(usage(), null, us, NOW, ZONE)

        assertEquals(TESLA_API_USAGE_EM_DASH, display.last24hText)
        assertNull(display.avgLatencyText)
        assertNull(display.errorRateText)
        assertNull(display.errorCountText)
        assertTrue(display.topServices.isEmpty())
        assertTrue(display.methodEntries.isEmpty())
        // The budget + this-month band still render off the usage snapshot alone.
        assertEquals("39,436", display.totalRequestsText)
        assertEquals("$0.00", display.last24hBurnText) // (0) * cost_per_request
    }

    // ── Projection: dedupe + sort + slice ───────────────────────────────────────────────

    @Test
    fun dedupeMapCollapsesTheCamelCaseClonesCamelCaseKeysInjects() {
        val withClones =
            linkedMapOf(
                "tesla_fleet" to 28_000.0,
                "teslaFleet" to 28_000.0,
                "tesla_streaming" to 11_000.0,
                "teslaStreaming" to 11_000.0,
            )

        val deduped = TeslaApiUsageProjection.dedupeMap(withClones)

        assertEquals(listOf("tesla_fleet", "tesla_streaming"), deduped.map { it.first })
    }

    @Test
    fun dedupeMapKeepsACleanSnakeOnlyMapAndReturnsEmptyForNull() {
        assertEquals(
            listOf("a" to 1.0, "b" to 2.0),
            TeslaApiUsageProjection.dedupeMap(linkedMapOf("a" to 1.0, "b" to 2.0)),
        )
        assertTrue(TeslaApiUsageProjection.dedupeMap(null).isEmpty())
    }

    @Test
    fun topServicesSortsByCallCountDescendingAndCapsAtThree() {
        val stats =
            logStats().copy(
                byService =
                    linkedMapOf(
                        "a" to 10.0,
                        "b" to 90.0,
                        "c" to 50.0,
                        "d" to 70.0,
                    ),
            )

        val display = TeslaApiUsageProjection.project(usage(), stats, us, NOW, ZONE)

        assertEquals(listOf("b", "d", "c"), display.topServices.map { it.label })
        assertEquals("90", display.topServices.first().value)
    }

    @Test
    fun methodEntriesAreSortedDescendingWithNoCap() {
        val display = TeslaApiUsageProjection.project(usage(), logStats(), us, NOW, ZONE)

        assertEquals(listOf("GET", "POST"), display.methodEntries.map { it.label })
        assertEquals("30,000", display.methodEntries.first().value)
        assertEquals("9,436", display.methodEntries.last().value)
    }

    // ── Formatters ──────────────────────────────────────────────────────────────────────

    @Test
    fun formatCountGroupsThousandsAndEmDashesNonFiniteValues() {
        assertEquals("1,234", TeslaApiUsageProjection.formatCount(1_234.0, Locale.US))
        assertEquals(TESLA_API_USAGE_EM_DASH, TeslaApiUsageProjection.formatCount(null, Locale.US))
        assertEquals(TESLA_API_USAGE_EM_DASH, TeslaApiUsageProjection.formatCount(Double.NaN, Locale.US))
    }

    @Test
    fun formatCurrencyPrefixesTheSymbolAndCoercesNonFiniteToZero() {
        assertEquals("$12.50", TeslaApiUsageProjection.formatCurrency(12.5, "$", 2, Locale.US))
        assertEquals("\u20ac13", TeslaApiUsageProjection.formatCurrency(12.5, "\u20ac", -1, Locale.US))
        assertEquals("$0.00", TeslaApiUsageProjection.formatCurrency(Double.NaN, "$", 2, Locale.US))
    }

    @Test
    fun formatPercentAppendsTheSignAndCoercesNonFiniteToZero() {
        assertEquals("875%", TeslaApiUsageProjection.formatPercent(875.4999, 0, Locale.US))
        assertEquals("1.2%", TeslaApiUsageProjection.formatPercent(1.2, 1, Locale.US))
        assertEquals("0%", TeslaApiUsageProjection.formatPercent(Double.NaN, 0, Locale.US))
    }

    @Test
    fun roundedLatencyRoundsToWholeMillisAndPreservesNull() {
        assertEquals(185.0, requireNotNull(TeslaApiUsageProjection.roundedLatency(184.7)), DELTA)
        assertNull(TeslaApiUsageProjection.roundedLatency(null))
        assertNull(TeslaApiUsageProjection.roundedLatency(Double.POSITIVE_INFINITY))
    }

    @Test
    fun formattingResolvesBlankSymbolAndNegativePrecisionToTheWebDefaults() {
        assertEquals("$", TeslaApiUsageFormatting("   ", 2, Locale.US).resolvedSymbol)
        assertEquals(0, TeslaApiUsageFormatting("$", -3, Locale.US).resolvedPrecision)
    }

    // ── Cache-then-network mapping (Resource → UiState) ───────────────────────────────

    @Test
    fun usageLoadingWithNoCacheMapsToTheLoadingPhase() {
        val state = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).toTeslaApiUsageUiState()

        assertTrue(state.isLoading)
        assertNull(state.data)
    }

    @Test
    fun usageSuccessMapsToContentAndAnUnparseablePayloadToEmpty() {
        val content = Resource.Success<JsonElement>(data = usageJson(), fetchedAt = 1L, stale = false).toTeslaApiUsageUiState()
        assertTrue(content.isContent)
        assertEquals(39_436.0, requireNotNull(content.data?.totalRequests), DELTA)

        val empty = Resource.Success<JsonElement>(data = JsonPrimitive("nope"), fetchedAt = 1L, stale = false).toTeslaApiUsageUiState()
        assertTrue(empty.isEmpty)
        assertNull(empty.data)
    }

    @Test
    fun usageErrorWithNoCacheMapsToErrorAndWithCacheToOffline() {
        val hard =
            Resource
                .Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom"))
                .toTeslaApiUsageUiState()
        assertTrue(hard.isError)
        assertNull(hard.data)

        val offline =
            Resource
                .Error(cached = usageJson(), fetchedAt = 1_700_000_000_000L, stale = true, error = RuntimeException("offline"))
                .toTeslaApiUsageUiState()
        assertTrue(offline.isContent)
        assertTrue(offline.isOffline)
        assertTrue(offline.hasError)
        assertEquals(39_436.0, requireNotNull(offline.data?.totalRequests), DELTA)
    }

    @Test
    fun logStatsLoadingMapsToLoadingAndSuccessToContent() {
        val loading = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).toTeslaApiLogStatsUiState()
        assertTrue(loading.isLoading)

        val content = Resource.Success<JsonElement>(data = logStatsJson(), fetchedAt = 1L, stale = false).toTeslaApiLogStatsUiState()
        assertTrue(content.isContent)
        assertEquals(2_800.0, requireNotNull(content.data?.last24h), DELTA)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        TeslaApiUsageDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TeslaApiUsageCard"), fields)
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

    private companion object {
        const val DELTA: Double = 1e-9
        const val NOW: Long = 1_736_942_400_000L // 2025-01-15T12:00:00Z
        val ZONE: ZoneId = ZoneId.of("UTC")
    }
}
