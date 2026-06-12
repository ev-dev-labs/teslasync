package io.teslasync.android.featureviews.aisettings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of the pure AISettings projection — the parity-critical derivations the web component
 * performs before render (web/src/features/settings/components/AISettings.tsx): the `ai_mode` classification
 * (web `isAiMode`), the settings-document projection (`serverMode` + `ai_cost_cap_cents`), the cost-cap spend
 * math (web `AICostCapSpendBar`: micro-cents → dollars, pct, ok/warn/critical), the save-patch builder (web
 * `handleSave`, incl. the off-branch `ai_features:{}` clear), the freshness-preserving Resource map, and the
 * PII-safe `view.opened` diagnostic. Run by the `:android:testReleaseUnitTest` gate.
 */
class AISettingsViewProjectionTest {
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

    @Test
    fun helixModeFromMapsKnownAndFallsBackToOff() {
        assertEquals(HelixMode.Off, HelixMode.from("off"))
        assertEquals(HelixMode.Local, HelixMode.from("local"))
        assertEquals(HelixMode.Cloud, HelixMode.from("cloud"))
        assertEquals(HelixMode.Off, HelixMode.from(""))
        assertEquals(HelixMode.Off, HelixMode.from(null))
        assertEquals(HelixMode.Off, HelixMode.from("totally-unknown"))
    }

    @Test
    fun projectAiSettingsReadsModeAndCapFromDocument() {
        val doc =
            buildJsonObject {
                put("ai_mode", "cloud")
                put("ai_cost_cap_cents", 500)
            }
        val projection = projectAiSettings(doc)
        assertEquals(HelixMode.Cloud, projection.mode)
        assertEquals(500L, projection.costCapCents)
        assertTrue(projection.present)
    }

    @Test
    fun projectAiSettingsDefaultsModeOffAndCapZeroWhenAbsent() {
        val projection = projectAiSettings(buildJsonObject { put("theme", "dark") })
        assertEquals(HelixMode.Off, projection.mode)
        assertEquals(0L, projection.costCapCents)
        assertTrue(projection.present)
    }

    @Test
    fun projectAiSettingsMarksBlankAndNullDocumentsAbsent() {
        assertFalse(projectAiSettings(null).present)
        assertFalse(projectAiSettings(JsonNull).present)
        assertFalse(projectAiSettings(JsonObject(emptyMap())).present)
        // A blank document still resolves to the safe default-off mode (AI-Off Contract).
        assertEquals(HelixMode.Off, projectAiSettings(null).mode)
    }

    @Test
    fun projectAiSettingsClampsNegativeCapToZero() {
        val projection = projectAiSettings(buildJsonObject { put("ai_cost_cap_cents", -10) })
        assertEquals(0L, projection.costCapCents)
    }

    @Test
    fun projectAiUsageTodayReadsCostMicroCents() {
        val usage = projectAiUsageToday(buildJsonObject { put("cost_micro_cents", 4_200_000L) })
        assertEquals(4_200_000L, usage.costMicroCents)
        assertEquals(0L, projectAiUsageToday(JsonObject(emptyMap())).costMicroCents)
        assertEquals(0L, projectAiUsageToday(null).costMicroCents)
    }

    @Test
    fun costCapSpendOkBandBelowEightyPercent() {
        val spend = projectCostCapSpend(todayMicroCents = 1_000_000L, capCents = 500L)
        assertEquals(SpendLevel.Ok, spend.level)
        assertEquals("1.00", spend.spent)
        assertEquals("5.00", spend.cap)
        assertEquals(20, spend.percent)
        assertEquals(0.20f, spend.fraction, 0.0001f)
    }

    @Test
    fun costCapSpendWarnBandAtEightyPercent() {
        val spend = projectCostCapSpend(todayMicroCents = 4_200_000L, capCents = 500L)
        assertEquals(SpendLevel.Warn, spend.level)
        assertEquals("4.20", spend.spent)
        assertEquals(84, spend.percent)
    }

    @Test
    fun costCapSpendCriticalBandAtOrAboveCapAndClampsToHundred() {
        val atCap = projectCostCapSpend(todayMicroCents = 5_000_000L, capCents = 500L)
        assertEquals(SpendLevel.Critical, atCap.level)
        assertEquals(100, atCap.percent)
        assertEquals(1.0f, atCap.fraction, 0.0001f)

        val overCap = projectCostCapSpend(todayMicroCents = 50_000_000L, capCents = 500L)
        assertEquals(SpendLevel.Critical, overCap.level)
        assertEquals(100, overCap.percent)
        assertEquals(1.0f, overCap.fraction, 0.0001f)
    }

    @Test
    fun costCapSpendHandlesZeroCapWithoutDivideByZero() {
        val spend = projectCostCapSpend(todayMicroCents = 1_000_000L, capCents = 0L)
        assertEquals(SpendLevel.Ok, spend.level)
        assertEquals(0, spend.percent)
        assertEquals(0.0f, spend.fraction, 0.0001f)
        assertEquals("0.00", spend.cap)
    }

    @Test
    fun formatUsdAlwaysTwoDecimals() {
        assertEquals("0.00", formatUsd(0.0))
        assertEquals("4.20", formatUsd(4.2))
        assertEquals("12.50", formatUsd(12.5))
    }

    @Test
    fun buildSavePatchOffClearsFeatures() {
        val patch = buildSavePatch(HelixMode.Off)
        assertEquals("off", patch["ai_mode"]?.jsonPrimitive?.content)
        assertTrue(patch["ai_features"]?.jsonObject?.isEmpty() == true)
        assertEquals(2, patch.size)
    }

    @Test
    fun buildSavePatchLocalAndCloudSendOnlyMode() {
        val local = buildSavePatch(HelixMode.Local)
        assertEquals("local", local["ai_mode"]?.jsonPrimitive?.content)
        assertEquals(1, local.size)
        assertNull(local["ai_features"])

        val cloud = buildSavePatch(HelixMode.Cloud)
        assertEquals("cloud", cloud["ai_mode"]?.jsonPrimitive?.content)
        assertEquals(1, cloud.size)
    }

    @Test
    fun mapDataPreservesLoadingCacheAndFreshness() {
        val loading: Resource<Int> = Resource.Loading(cached = 7, fetchedAt = 100L, stale = true)
        val mapped = loading.mapData { it * 2 }
        assertTrue(mapped is Resource.Loading)
        val asLoading = mapped as Resource.Loading
        assertEquals(14, asLoading.cached)
        assertEquals(100L, asLoading.fetchedAt)
        assertTrue(asLoading.stale)
    }

    @Test
    fun mapDataTransformsSuccessAndError() {
        val success: Resource<Int> = Resource.Success(data = 3, fetchedAt = 1L, stale = false)
        assertEquals(6, (success.mapData { it * 2 } as Resource.Success).data)

        val boom = IllegalStateException("boom")
        val error: Resource<Int> = Resource.Error(cached = 5, fetchedAt = 2L, stale = true, error = boom)
        val mapped = error.mapData { it + 1 } as Resource.Error
        assertEquals(6, mapped.cached)
        assertEquals(boom, mapped.error)
        assertTrue(mapped.stale)
    }

    @Test
    fun recordViewOpenedEmitsSlugWithNoPii() {
        val logger = RecordingLogger()
        recordAISettingsViewOpened(logger)
        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "AISettings"), opened.second)
        assertEquals("AISettings", AISettingsViewRegistration.SLUG)
        assertEquals("ai-settings", AISettingsViewRegistration.ID)
    }
}
