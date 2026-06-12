package io.teslasync.android.featureviews.aiusagecard

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the AIUsageCard's pure logic — the native analogue of every derivation the web
 * component performs (web/src/features/settings/components/AIUsageCard.tsx): the `/ai/usage/today` payload
 * adapter ([AiUsageToday.fromJson]), the `fmtInt` token counts + the micro-cents → dollars currency cost, the
 * per-field `'—'` placeholder, the `call_count > 0` caption switch, the cache-then-network
 * [Resource] → [io.teslasync.android.data.UiState] mapping ([toAiUsageTodayUiState], covering loading / empty
 * / content / error / offline), and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate. Locale.US fixes the grouping/separator so the assertions are deterministic.
 */
class AIUsageCardModelTest {
    private val us = AiUsageFormatting(currencySymbol = "$", precision = 2, locale = Locale.US)

    private fun usageJson(
        callCount: Long = 80,
        inputTokens: Long = 134_795,
        outputTokens: Long = 8_512,
        costMicroCents: Long = 12_500_000,
    ): JsonObject =
        buildJsonObject {
            put("call_count", callCount)
            put("input_tokens", inputTokens)
            put("output_tokens", outputTokens)
            put("cost_micro_cents", costMicroCents)
        }

    // ── Data adapter: fromJson (cached payload → typed projection) ───────────────────

    @Test
    fun fromJsonParsesEverySnakeCaseFieldThisCardReads() {
        val data = AiUsageToday.fromJson(usageJson())

        requireNotNull(data)
        assertEquals(80.0, requireNotNull(data.callCount), DELTA)
        assertEquals(134_795.0, requireNotNull(data.inputTokens), DELTA)
        assertEquals(8_512.0, requireNotNull(data.outputTokens), DELTA)
        assertEquals(12_500_000.0, requireNotNull(data.costMicroCents), DELTA)
    }

    @Test
    fun fromJsonReturnsNullForANonObjectPayload() {
        assertNull(AiUsageToday.fromJson(null))
        assertNull(AiUsageToday.fromJson(JsonPrimitive("not-an-object")))
    }

    @Test
    fun fromJsonLeavesAbsentFieldsNull() {
        val sparse = buildJsonObject { put("call_count", 3) }

        val data = AiUsageToday.fromJson(sparse)

        requireNotNull(data)
        assertEquals(3.0, requireNotNull(data.callCount), DELTA)
        assertNull(data.inputTokens)
        assertNull(data.outputTokens)
        assertNull(data.costMicroCents)
    }

    // ── Projection: figures + caption ───────────────────────────────────────────────

    @Test
    fun projectFormatsTheThreeFiguresAndLiveCaption() {
        val display = AiUsageProjection.project(requireNotNull(AiUsageToday.fromJson(usageJson())), us)

        assertEquals("134,795", display.tokensIn)
        assertEquals("8,512", display.tokensOut)
        assertEquals("$12.50", display.cost)
        assertEquals("80", display.callCountText)
        assertTrue(display.hasUsage)
    }

    @Test
    fun projectRendersZeroUsageAsZerosWithoutTheLiveCaption() {
        val display = AiUsageProjection.project(AiUsageToday.EMPTY, us)

        assertEquals("0", display.tokensIn)
        assertEquals("0", display.tokensOut)
        assertEquals("$0.00", display.cost)
        assertFalse(display.hasUsage)
    }

    @Test
    fun projectFallsBackToTheEmDashForMissingFigures() {
        val sparse = AiUsageToday(callCount = 0.0, inputTokens = null, outputTokens = null, costMicroCents = 0.0)

        val display = AiUsageProjection.project(sparse, us)

        assertEquals(AI_USAGE_EM_DASH, display.tokensIn)
        assertEquals(AI_USAGE_EM_DASH, display.tokensOut)
        // A null cost still renders a currency string because the micro-cents helper coerces it to 0.
        assertEquals("$0.00", display.cost)
    }

    // ── Formatters (web fmtInt / microCentsToDollars / formatCurrency) ────────────────

    @Test
    fun formatCountGroupsThousandsAndPlaceholdersNonFiniteValues() {
        assertEquals("1,234", AiUsageProjection.formatCount(1_234.0, Locale.US))
        assertEquals("0", AiUsageProjection.formatCount(0.0, Locale.US))
        assertEquals(AI_USAGE_EM_DASH, AiUsageProjection.formatCount(null, Locale.US))
        assertEquals(AI_USAGE_EM_DASH, AiUsageProjection.formatCount(Double.NaN, Locale.US))
        assertEquals(AI_USAGE_EM_DASH, AiUsageProjection.formatCount(Double.POSITIVE_INFINITY, Locale.US))
    }

    @Test
    fun microCentsAsDollarsDividesByAMillionAndGuardsNonFinite() {
        assertEquals(12.5, AiUsageProjection.microCentsAsDollars(12_500_000.0), DELTA)
        assertEquals(0.0, AiUsageProjection.microCentsAsDollars(null), DELTA)
        assertEquals(0.0, AiUsageProjection.microCentsAsDollars(Double.NaN), DELTA)
    }

    @Test
    fun formatCurrencyPrefixesTheSymbolAtTheGivenPrecision() {
        assertEquals("$12.50", AiUsageProjection.formatCurrency(12.5, "$", 2, Locale.US))
        assertEquals("\u20ac12.50", AiUsageProjection.formatCurrency(12.5, "\u20ac", 2, Locale.US))
        // A negative precision is floored at zero so formatting never throws.
        assertEquals("$13", AiUsageProjection.formatCurrency(12.5, "$", -1, Locale.US))
    }

    @Test
    fun formattingResolvesBlankSymbolAndNegativePrecisionToTheWebDefaults() {
        assertEquals("$", AiUsageFormatting(currencySymbol = "   ", precision = 2, locale = Locale.US).resolvedSymbol)
        assertEquals(0, AiUsageFormatting(currencySymbol = "$", precision = -3, locale = Locale.US).resolvedPrecision)
    }

    @Test
    fun hasUsageAndIsEmptyTrackTheCallCount() {
        assertTrue(AiUsageToday(callCount = 1.0, inputTokens = 0.0, outputTokens = 0.0, costMicroCents = 0.0).hasUsage)
        assertTrue(AiUsageToday.EMPTY.isEmpty)
        assertFalse(AiUsageToday.EMPTY.hasUsage)
    }

    // ── Cache-then-network mapping (Resource → UiState) ───────────────────────────────

    @Test
    fun loadingWithNoCacheMapsToTheLoadingPhase() {
        val state =
            Resource
                .Loading<JsonElement>(cached = null, fetchedAt = null, stale = false)
                .toAiUsageTodayUiState()

        assertTrue(state.isLoading)
        assertNull(state.data)
    }

    @Test
    fun successMapsToContentWithTheParsedPayload() {
        val state = Resource.Success(data = usageJson(), fetchedAt = 1L, stale = false).toAiUsageTodayUiState()

        assertTrue(state.isContent)
        assertEquals(134_795.0, requireNotNull(state.data?.inputTokens), DELTA)
    }

    @Test
    fun successWithZeroUsageMapsToTheEmptyPhase() {
        val zeros = usageJson(callCount = 0, inputTokens = 0, outputTokens = 0, costMicroCents = 0)

        val state = Resource.Success(data = zeros, fetchedAt = 1L, stale = false).toAiUsageTodayUiState()

        assertTrue(state.isEmpty)
    }

    @Test
    fun errorWithNoCacheMapsToTheErrorPhase() {
        val state =
            Resource
                .Error<JsonElement>(
                    cached = null,
                    fetchedAt = null,
                    stale = false,
                    error = RuntimeException("boom"),
                ).toAiUsageTodayUiState()

        assertTrue(state.isError)
        assertNull(state.data)
    }

    @Test
    fun errorWithCacheKeepsTheLastKnownValueAsOffline() {
        val state =
            Resource
                .Error(
                    cached = usageJson(),
                    fetchedAt = 1_700_000_000_000L,
                    stale = true,
                    error = RuntimeException("offline"),
                ).toAiUsageTodayUiState()

        assertTrue(state.isContent)
        assertTrue(state.stale)
        assertTrue(state.hasError)
        assertTrue(state.isOffline)
        assertEquals(134_795.0, requireNotNull(state.data?.inputTokens), DELTA)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        AiUsageCardDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AIUsageCard"), fields)
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
    }
}
