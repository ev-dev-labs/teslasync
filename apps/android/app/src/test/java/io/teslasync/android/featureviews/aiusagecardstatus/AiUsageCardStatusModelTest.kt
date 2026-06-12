package io.teslasync.android.featureviews.aiusagecardstatus

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device verification of the operator AiUsageCard's pure logic — the native analogue of every derivation the
 * web component performs (web/src/features/system/components/status/AiUsageCard.tsx): the three payload adapters
 * ([AiUsageToday.fromJson] / [AiUsageFeatureRow.listFromJson] / [AiUsageRecentRow.listFromJson]), the band /
 * detail figures, the error-ratio intent, the top-feature sort+slice, the recent-call token sum + relative-age
 * bucketing, the cache-then-network [Resource] -> [io.teslasync.android.data.UiState] mappings (loading / empty /
 * content / error / offline), the off-mode gate, and the PII-safe `view.opened` diagnostic. Runs in the
 * :app:testReleaseUnitTest gate. Locale.US fixes the grouping/separator so the assertions are deterministic.
 */
class AiUsageCardStatusModelTest {
    private val us = AiUsageStatusFormatting(currencySymbol = "$", precision = 2, locale = Locale.US)

    private fun todayJson(): JsonObject =
        buildJsonObject {
            put("call_count", 312)
            put("input_tokens", 134_795)
            put("output_tokens", 48_512)
            put("cost_micro_cents", 12_500_000)
            put("error_count", 4)
            put("avg_latency_ms", 287)
        }

    private fun zerosTodayJson(): JsonObject =
        buildJsonObject {
            put("call_count", 0)
            put("input_tokens", 0)
            put("output_tokens", 0)
            put("cost_micro_cents", 0)
            put("error_count", 0)
            put("avg_latency_ms", 0)
        }

    // ── Data adapter: today.fromJson ──────────────────────────────────────────────────

    @Test
    fun todayFromJsonParsesEverySnakeCaseFieldThisCardReads() {
        val data = requireNotNull(AiUsageToday.fromJson(todayJson()))

        assertEquals(312.0, requireNotNull(data.callCount), DELTA)
        assertEquals(134_795.0, requireNotNull(data.inputTokens), DELTA)
        assertEquals(48_512.0, requireNotNull(data.outputTokens), DELTA)
        assertEquals(12_500_000.0, requireNotNull(data.costMicroCents), DELTA)
        assertEquals(4.0, requireNotNull(data.errorCount), DELTA)
        assertEquals(287.0, requireNotNull(data.avgLatencyMs), DELTA)
    }

    @Test
    fun todayFromJsonReturnsNullForANonObjectPayload() {
        assertNull(AiUsageToday.fromJson(null))
        assertNull(AiUsageToday.fromJson(JsonPrimitive("not-an-object")))
    }

    @Test
    fun todayFromJsonLeavesAbsentFieldsNull() {
        val data = requireNotNull(AiUsageToday.fromJson(buildJsonObject { put("call_count", 3) }))

        assertEquals(3.0, requireNotNull(data.callCount), DELTA)
        assertNull(data.inputTokens)
        assertNull(data.avgLatencyMs)
    }

    @Test
    fun hasUsageAndIsEmptyTrackTheCallCount() {
        assertTrue(AiUsageToday.fromJson(todayJson())!!.hasUsage)
        assertTrue(AiUsageToday.EMPTY.isEmpty)
        assertFalse(AiUsageToday.EMPTY.hasUsage)
    }

    // ── Data adapter: by-feature + recent rows ────────────────────────────────────────

    @Test
    fun byFeatureListFromJsonParsesRowsAndSkipsRowsWithoutAFeatureId() {
        val payload =
            buildJsonObject {
                putJsonArray("rows") {
                    add(
                        buildJsonObject {
                            put("feature_id", "chatbot")
                            put("call_count", 12)
                        },
                    )
                    add(buildJsonObject { put("call_count", 9) }) // no feature_id -> skipped
                }
            }

        val rows = AiUsageFeatureRow.listFromJson(payload)

        assertEquals(1, rows.size)
        assertEquals("chatbot", rows.single().featureId)
        assertEquals(12.0, requireNotNull(rows.single().callCount), DELTA)
    }

    @Test
    fun byFeatureListFromJsonReturnsEmptyForAnAbsentOrNonObjectPayload() {
        assertTrue(AiUsageFeatureRow.listFromJson(null).isEmpty())
        assertTrue(AiUsageFeatureRow.listFromJson(buildJsonObject { }).isEmpty())
    }

    @Test
    fun recentListFromJsonParsesEveryRowAndTheErrorFlag() {
        val payload =
            buildJsonObject {
                putJsonArray("rows") {
                    add(recentRowJson(id = 1, error = ""))
                    add(recentRowJson(id = 2, error = "boom"))
                }
            }

        val rows = AiUsageRecentRow.listFromJson(payload)

        assertEquals(2, rows.size)
        assertFalse(rows[0].isError)
        assertTrue(rows[1].isError)
        assertEquals("chatbot", rows[0].featureId)
        assertEquals("gpt-4o-mini", rows[0].model)
    }

    // ── Projection: bands + details ───────────────────────────────────────────────────

    @Test
    fun projectFormatsTheBandAndDetailFigures() {
        val display = AiUsageStatusProjection.project(AiUsageToday.fromJson(todayJson())!!, emptyList(), emptyList(), us, NOW)

        assertEquals("312", display.callCount)
        assertEquals("4", display.errorCount)
        assertEquals(4, display.errorCountInt)
        assertEquals("183,307", display.tokensTotal) // 134,795 + 48,512
        assertEquals("134,795", display.tokensIn)
        assertEquals("48,512", display.tokensOut)
        assertEquals("$12.50", display.cost)
        assertEquals("287", display.avgLatency)
    }

    @Test
    fun projectRendersZeroUsageWithoutInventingFigures() {
        val display = AiUsageStatusProjection.project(AiUsageToday.EMPTY, emptyList(), emptyList(), us, NOW)

        assertEquals("0", display.callCount)
        assertEquals("$0.00", display.cost)
        assertEquals("0", display.tokensTotal)
        assertEquals(AiUsageIntent.Normal, display.callIntent)
    }

    @Test
    fun projectFallsBackToTheEmDashForMissingFigures() {
        val sparse =
            AiUsageToday(
                callCount = null,
                inputTokens = null,
                outputTokens = 0.0,
                costMicroCents = 0.0,
                errorCount = null,
                avgLatencyMs = null,
            )

        val display = AiUsageStatusProjection.project(sparse, emptyList(), emptyList(), us, NOW)

        assertEquals(AI_USAGE_STATUS_EM_DASH, display.callCount)
        assertEquals(AI_USAGE_STATUS_EM_DASH, display.tokensIn)
        assertEquals(AI_USAGE_STATUS_EM_DASH, display.avgLatency)
        // The total still renders because the absent token fields coerce to zero in the sum.
        assertEquals("0", display.tokensTotal)
    }

    // ── Projection: error intent (web ratio rule) ─────────────────────────────────────

    @Test
    fun callIntentIsNormalWhenThereAreNoErrorsOrNoCalls() {
        assertEquals(AiUsageIntent.Normal, AiUsageStatusProjection.callIntent(errorCount = 0.0, callCount = 100.0))
        assertEquals(AiUsageIntent.Normal, AiUsageStatusProjection.callIntent(errorCount = 5.0, callCount = 0.0))
        assertEquals(AiUsageIntent.Normal, AiUsageStatusProjection.callIntent(errorCount = null, callCount = null))
    }

    @Test
    fun callIntentIsWarnBelowFivePercentAndDangerAtOrAboveIt() {
        assertEquals(AiUsageIntent.Warn, AiUsageStatusProjection.callIntent(errorCount = 1.0, callCount = 100.0))
        assertEquals(AiUsageIntent.Danger, AiUsageStatusProjection.callIntent(errorCount = 5.0, callCount = 100.0))
        assertEquals(AiUsageIntent.Danger, AiUsageStatusProjection.callIntent(errorCount = 50.0, callCount = 100.0))
    }

    // ── Projection: top features (sort + slice) ───────────────────────────────────────

    @Test
    fun topFeaturesSortsByCallCountDescendingAndCapsAtFive() {
        val rows =
            listOf(
                AiUsageFeatureRow("a", 10.0),
                AiUsageFeatureRow("b", 90.0),
                AiUsageFeatureRow("c", 50.0),
                AiUsageFeatureRow("d", 30.0),
                AiUsageFeatureRow("e", 70.0),
                AiUsageFeatureRow("f", 5.0),
            )

        val top = AiUsageStatusProjection.topFeatures(rows, Locale.US)

        assertEquals(5, top.size)
        assertEquals(listOf("b", "e", "c", "d", "a"), top.map { it.featureId })
        assertEquals("90", top.first().callCount)
    }

    // ── Projection: recent rows (slice + token sum + relative age) ────────────────────

    @Test
    fun recentRowsCapAtFiveAndSumTokens() {
        val rows = (1..7).map { recentRow(id = it.toLong()) }

        val recent = AiUsageStatusProjection.recentRows(rows, Locale.US, NOW)

        assertEquals(5, recent.size)
        assertEquals("130", recent.first().tokens) // 50 + 80
    }

    @Test
    fun relativeAgeBucketsSecondsMinutesHoursAndDays() {
        assertEquals(RelativeAge.Seconds(30), AiUsageStatusProjection.relativeAge(isoBefore(30_000L), NOW))
        assertEquals(RelativeAge.Minutes(5), AiUsageStatusProjection.relativeAge(isoBefore(5L * 60_000L), NOW))
        assertEquals(RelativeAge.Hours(2), AiUsageStatusProjection.relativeAge(isoBefore(2L * 3_600_000L), NOW))
        assertEquals(RelativeAge.Days(3), AiUsageStatusProjection.relativeAge(isoBefore(3L * 86_400_000L), NOW))
    }

    @Test
    fun relativeAgeFloorsSecondsAtZeroAndReturnsNullForAnUnparseableTimestamp() {
        assertEquals(RelativeAge.Seconds(0), AiUsageStatusProjection.relativeAge(isoBefore(-5_000L), NOW))
        assertNull(AiUsageStatusProjection.relativeAge("not-a-timestamp", NOW))
    }

    // ── Formatters (web fmtInt / microCentsToDollars / formatCurrency) ────────────────

    @Test
    fun formatCountGroupsThousandsAndEmDashesNonFiniteValues() {
        assertEquals("1,234", AiUsageStatusProjection.formatCount(1_234.0, Locale.US))
        assertEquals("0", AiUsageStatusProjection.formatCount(0.0, Locale.US))
        assertEquals(AI_USAGE_STATUS_EM_DASH, AiUsageStatusProjection.formatCount(null, Locale.US))
        assertEquals(AI_USAGE_STATUS_EM_DASH, AiUsageStatusProjection.formatCount(Double.NaN, Locale.US))
        assertEquals(AI_USAGE_STATUS_EM_DASH, AiUsageStatusProjection.formatCount(Double.POSITIVE_INFINITY, Locale.US))
    }

    @Test
    fun microCentsAsDollarsDividesByAMillionAndGuardsNonFinite() {
        assertEquals(12.5, AiUsageStatusProjection.microCentsAsDollars(12_500_000.0), DELTA)
        assertEquals(0.0, AiUsageStatusProjection.microCentsAsDollars(null), DELTA)
        assertEquals(0.0, AiUsageStatusProjection.microCentsAsDollars(Double.NaN), DELTA)
    }

    @Test
    fun formatCurrencyPrefixesTheSymbolAtTheGivenPrecision() {
        assertEquals("$12.50", AiUsageStatusProjection.formatCurrency(12.5, "$", 2, Locale.US))
        assertEquals("\u20ac12.50", AiUsageStatusProjection.formatCurrency(12.5, "\u20ac", 2, Locale.US))
        assertEquals("$13", AiUsageStatusProjection.formatCurrency(12.5, "$", -1, Locale.US))
    }

    @Test
    fun roundedLatencyRoundsToWholeMillisAndPreservesNonFinite() {
        assertEquals(287.0, requireNotNull(AiUsageStatusProjection.roundedLatency(286.7)), DELTA)
        assertNull(AiUsageStatusProjection.roundedLatency(null))
    }

    @Test
    fun formattingResolvesBlankSymbolAndNegativePrecisionToTheWebDefaults() {
        assertEquals("$", AiUsageStatusFormatting("   ", 2, Locale.US).resolvedSymbol)
        assertEquals(0, AiUsageStatusFormatting("$", -3, Locale.US).resolvedPrecision)
    }

    // ── Cache-then-network mapping (Resource → UiState) ───────────────────────────────

    @Test
    fun todayLoadingWithNoCacheMapsToTheLoadingPhase() {
        val state = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).toAiUsageTodayUiState()

        assertTrue(state.isLoading)
        assertNull(state.data)
    }

    @Test
    fun todaySuccessMapsToContentAndZeroUsageToEmpty() {
        val content = Resource.Success(data = todayJson(), fetchedAt = 1L, stale = false).toAiUsageTodayUiState()
        assertTrue(content.isContent)
        assertEquals(312.0, requireNotNull(content.data?.callCount), DELTA)

        val empty = Resource.Success(data = zerosTodayJson(), fetchedAt = 1L, stale = false).toAiUsageTodayUiState()
        assertTrue(empty.isEmpty)
    }

    @Test
    fun todayErrorWithNoCacheMapsToErrorAndWithCacheToOffline() {
        val hard =
            Resource
                .Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom"))
                .toAiUsageTodayUiState()
        assertTrue(hard.isError)
        assertNull(hard.data)

        val offline =
            Resource
                .Error(cached = todayJson(), fetchedAt = 1_700_000_000_000L, stale = true, error = RuntimeException("offline"))
                .toAiUsageTodayUiState()
        assertTrue(offline.isContent)
        assertTrue(offline.isOffline)
        assertTrue(offline.hasError)
        assertEquals(312.0, requireNotNull(offline.data?.callCount), DELTA)
    }

    @Test
    fun byFeatureSuccessMapsRowsAndEmptyRowsToTheEmptyPhase() {
        val rowsJson =
            buildJsonObject {
                putJsonArray("rows") {
                    add(
                        buildJsonObject {
                            put("feature_id", "x")
                            put("call_count", 1)
                        },
                    )
                }
            }
        val content = Resource.Success(data = rowsJson, fetchedAt = 1L, stale = false).toAiUsageByFeatureUiState()
        assertTrue(content.isContent)
        assertEquals(1, content.data?.size)

        val emptyJson = buildJsonObject { putJsonArray("rows") { } }
        val empty = Resource.Success(data = emptyJson, fetchedAt = 1L, stale = false).toAiUsageByFeatureUiState()
        assertTrue(empty.isEmpty)
    }

    @Test
    fun recentLoadingWithNoCacheMapsToLoadingAndSuccessToContent() {
        val loading = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).toAiUsageRecentUiState()
        assertTrue(loading.isLoading)

        val rowsJson = buildJsonObject { putJsonArray("rows") { add(recentRowJson(id = 1, error = "")) } }
        val content = Resource.Success(data = rowsJson, fetchedAt = 1L, stale = false).toAiUsageRecentUiState()
        assertTrue(content.isContent)
        assertEquals(1, content.data?.size)
    }

    // ── Off-mode gate (ADR-015 §I4) ───────────────────────────────────────────────────

    @Test
    fun aiModeIsReadFromTheSettingsDocument() {
        assertEquals("local", aiModeOf(buildJsonObject { put("ai_mode", "local") }))
        assertNull(aiModeOf(buildJsonObject { }))
        assertNull(aiModeOf(null))
    }

    @Test
    fun aiUsageStatusEnabledMirrorsTheWebOffModeGate() {
        assertFalse(aiUsageStatusEnabled(null))
        assertFalse(aiUsageStatusEnabled("off"))
        assertTrue(aiUsageStatusEnabled("local"))
        assertTrue(aiUsageStatusEnabled("cloud"))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        AiUsageStatusDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AiUsageCard"), fields)
    }

    // ── Fixtures ──────────────────────────────────────────────────────────────────────

    private fun recentRowJson(
        id: Long,
        error: String,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("feature_id", "chatbot")
            put("model", "gpt-4o-mini")
            put("input_tokens", 50)
            put("output_tokens", 80)
            put("started_at", isoBefore(30_000L))
            put("error", error)
        }

    private fun recentRow(id: Long): AiUsageRecentRow =
        AiUsageRecentRow(
            id = id,
            featureId = "chatbot",
            model = "gpt-4o-mini",
            inputTokens = 50.0,
            outputTokens = 80.0,
            startedAt = isoBefore(30_000L),
            isError = false,
        )

    private fun isoBefore(ageMs: Long): String = Instant.ofEpochMilli(NOW - ageMs).toString()

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
        const val NOW: Long = 1_700_000_000_000L
    }
}
