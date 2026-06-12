package io.teslasync.android.featureviews.aiprovider

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderReason
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure AIProviderSection adapter + projection — the native port of everything
 * the web component (web/src/features/settings/components/AIProviderSection.tsx) derives before returning
 * JSX: the cloud/local provider + Azure-flavor option sets, the `provider === 'azure' && flavor !== 'foundry'`
 * model-label switch, the Azure sub-panel + deployment-field guards, the cents↔dollars cost-cap round-trip,
 * the validate-request body (cloud full set with the `api_key` blank→omit rule vs local mode+url), the
 * success-banner variant selection (pinned → probed → plain), the failure mapping, the validate-button
 * enablement predicate, and the PII-safe `view.opened` diagnostic. Run by the offline
 * `:android:testReleaseUnitTest` gate.
 */
class AIProviderSectionProjectionTest {
    // ── provider / flavor option sets ─────────────────────────────────────────
    @Test
    fun cloudProviderChoicesMatchWeb() {
        val values = AIProviderProjection.providerChoices(isCloud = true).map { it.value }
        assertEquals(listOf("openai", "anthropic", "azure", "google"), values)
        assertEquals("Azure AI", AIProviderProjection.cloudProviderChoices[2].label)
    }

    @Test
    fun localProviderChoicesMatchWeb() {
        val values = AIProviderProjection.providerChoices(isCloud = false).map { it.value }
        assertEquals(listOf("ollama", "lmstudio", "llama-cpp"), values)
        assertEquals("llama.cpp", AIProviderProjection.localProviderChoices[2].label)
    }

    @Test
    fun azureFlavorChoicesMatchWeb() {
        assertEquals(listOf("openai", "foundry"), AIProviderProjection.azureFlavorChoices.map { it.value })
    }

    // ── Azure sub-panel + model-label guards ──────────────────────────────────
    @Test
    fun showAzureConfigOnlyWhenCloudAzure() {
        assertTrue(AIProviderProjection.showAzureConfig(isCloud = true, provider = "azure"))
        assertFalse(AIProviderProjection.showAzureConfig(isCloud = false, provider = "azure"))
        assertFalse(AIProviderProjection.showAzureConfig(isCloud = true, provider = "openai"))
    }

    @Test
    fun showAzureDeploymentFieldsHiddenForFoundry() {
        assertTrue(AIProviderProjection.showAzureDeploymentFields(flavor = "openai"))
        assertTrue(AIProviderProjection.showAzureDeploymentFields(flavor = ""))
        assertFalse(AIProviderProjection.showAzureDeploymentFields(flavor = "foundry"))
    }

    @Test
    fun usesAzureModelLabelOnlyForAzureNonFoundry() {
        assertTrue(AIProviderProjection.usesAzureModelLabel(provider = "azure", flavor = "openai"))
        assertFalse(AIProviderProjection.usesAzureModelLabel(provider = "azure", flavor = "foundry"))
        assertFalse(AIProviderProjection.usesAzureModelLabel(provider = "openai", flavor = "openai"))
    }

    @Test
    fun azureFlavorValueDefaultsToOpenAi() {
        assertEquals("openai", AIProviderProjection.azureFlavorValue(flavor = ""))
        assertEquals("foundry", AIProviderProjection.azureFlavorValue(flavor = "foundry"))
    }

    // ── ghost-example values ──────────────────────────────────────────────────
    @Test
    fun modelExampleByMode() {
        assertEquals("gpt-4o-mini", AIProviderProjection.modelExample(isCloud = true))
        assertEquals("llama3.1:8b", AIProviderProjection.modelExample(isCloud = false))
    }

    @Test
    fun azureDeploymentExampleFallsBackToModel() {
        assertEquals("my-chat", AIProviderProjection.azureDeploymentExample(model = "my-chat"))
        assertEquals("gpt-4o-mini", AIProviderProjection.azureDeploymentExample(model = ""))
    }

    @Test
    fun azureEmbeddingExampleFallsBackToDefault() {
        assertEquals("my-embed", AIProviderProjection.azureEmbeddingExample(embeddingModel = "my-embed"))
        assertEquals("text-embedding-3-small", AIProviderProjection.azureEmbeddingExample(embeddingModel = ""))
    }

    // ── cost cap cents↔dollars round-trip (web toFixed(2) / parseFloat) ────────
    @Test
    fun costCapDisplayFormatsCents() {
        assertEquals("", AIProviderProjection.costCapDisplay(0))
        assertEquals("", AIProviderProjection.costCapDisplay(-5))
        assertEquals("0.05", AIProviderProjection.costCapDisplay(5))
        assertEquals("5.00", AIProviderProjection.costCapDisplay(500))
        assertEquals("12.34", AIProviderProjection.costCapDisplay(1234))
        assertEquals("1000.00", AIProviderProjection.costCapDisplay(100_000))
    }

    @Test
    fun parseCostCapCentsMirrorsParseFloat() {
        assertEquals(500, AIProviderProjection.parseCostCapCents("5"))
        assertEquals(500, AIProviderProjection.parseCostCapCents("5.00"))
        assertEquals(5, AIProviderProjection.parseCostCapCents("0.05"))
        assertEquals(0, AIProviderProjection.parseCostCapCents(""))
        assertEquals(0, AIProviderProjection.parseCostCapCents("abc"))
        assertEquals(0, AIProviderProjection.parseCostCapCents("-3"))
        assertEquals(501, AIProviderProjection.parseCostCapCents("5.005"))
    }

    @Test
    fun costCapRoundTrips() {
        val cents = AIProviderProjection.parseCostCapCents("5.00")
        assertEquals("5.00", AIProviderProjection.costCapDisplay(cents))
    }

    // ── validate-request body ─────────────────────────────────────────────────
    @Test
    fun buildValidateRequestCloudSendsFullConfig() {
        val draft =
            AIProviderDraft(
                provider = "azure",
                baseUrl = "https://res.openai.azure.com",
                model = "gpt-4o",
                apiKey = "sk-secret",
                apiVersion = "2024-10-21",
                flavor = "openai",
                deployment = "chat-deploy",
                embeddingModel = "text-embedding-3-small",
                embeddingDeployment = "embed-deploy",
            )
        val request = AIProviderProjection.buildValidateRequest(draft, isCloud = true)
        assertEquals("cloud", request.mode)
        assertEquals("azure", request.provider)
        assertEquals("https://res.openai.azure.com", request.baseUrl)
        assertEquals("sk-secret", request.apiKey)
        assertEquals("gpt-4o", request.model)
        assertEquals("2024-10-21", request.apiVersion)
        assertEquals("openai", request.flavor)
        assertEquals("chat-deploy", request.deployment)
        assertEquals("text-embedding-3-small", request.embeddingModel)
        assertEquals("embed-deploy", request.embeddingDeployment)
    }

    @Test
    fun buildValidateRequestCloudOmitsBlankApiKey() {
        val draft = AIProviderDraft(provider = "openai", model = "gpt-4o-mini", apiKey = "   ")
        val request = AIProviderProjection.buildValidateRequest(draft, isCloud = true)
        assertNull(request.apiKey)
        // The remaining cloud fields are still sent (as empty strings), mirroring the web JSON body.
        assertEquals("", request.apiVersion)
        assertEquals("gpt-4o-mini", request.model)
    }

    @Test
    fun buildValidateRequestLocalSendsOnlyModeProviderUrl() {
        val draft =
            AIProviderDraft(
                provider = "ollama",
                baseUrl = "http://localhost:11434",
                model = "llama3.1:8b",
                apiKey = "should-be-ignored",
                deployment = "ignored",
            )
        val request = AIProviderProjection.buildValidateRequest(draft, isCloud = false)
        assertEquals("local", request.mode)
        assertEquals("ollama", request.provider)
        assertEquals("http://localhost:11434", request.baseUrl)
        assertNull(request.apiKey)
        assertNull(request.model)
        assertNull(request.apiVersion)
        assertNull(request.flavor)
        assertNull(request.deployment)
        assertNull(request.embeddingModel)
        assertNull(request.embeddingDeployment)
    }

    // ── success-banner variant selection + failure mapping ────────────────────
    @Test
    fun bannerFromSuccessPrefersPinnedIp() {
        val result =
            ValidateAiProviderResult.Success(mode = "local", baseUrl = "http://x", pinnedIp = "127.0.0.1", probedModel = "ignored")
        val banner = AIProviderProjection.bannerFrom(result)
        assertEquals(ValidateOutcome.Ok, banner.outcome)
        assertEquals(ValidateMessage.Pinned("127.0.0.1"), banner.message)
    }

    @Test
    fun bannerFromSuccessUsesProbedWhenNoPinned() {
        val result = ValidateAiProviderResult.Success(mode = "cloud", baseUrl = "https://x", probedModel = "gpt-4o-mini")
        val banner = AIProviderProjection.bannerFrom(result)
        assertEquals(ValidateOutcome.Ok, banner.outcome)
        assertEquals(ValidateMessage.Probed("gpt-4o-mini"), banner.message)
    }

    @Test
    fun bannerFromSuccessFallsBackToReachable() {
        val result = ValidateAiProviderResult.Success(mode = "cloud", baseUrl = "https://x")
        val banner = AIProviderProjection.bannerFrom(result)
        assertEquals(ValidateMessage.Reachable, banner.message)
    }

    @Test
    fun bannerFromSuccessTreatsBlankPinnedAndProbedAsAbsent() {
        val result = ValidateAiProviderResult.Success(mode = "cloud", baseUrl = "https://x", pinnedIp = "", probedModel = "  ")
        val banner = AIProviderProjection.bannerFrom(result)
        assertEquals(ValidateMessage.Reachable, banner.message)
    }

    @Test
    fun bannerFromFailureCarriesMessage() {
        val result = ValidateAiProviderResult.Failure(reason = ValidateAiProviderReason.UNAUTHORIZED, message = "Unauthorized — bad key")
        val banner = AIProviderProjection.bannerFrom(result)
        assertEquals(ValidateOutcome.Fail, banner.outcome)
        assertEquals(ValidateMessage.Failure("Unauthorized — bad key"), banner.message)
    }

    // ── validate-button enablement ────────────────────────────────────────────
    @Test
    fun localValidateEnabledRequiresNonBlankUrl() {
        assertFalse(AIProviderProjection.localValidateEnabled(""))
        assertFalse(AIProviderProjection.localValidateEnabled("   "))
        assertTrue(AIProviderProjection.localValidateEnabled("http://localhost:11434"))
    }

    // ── PII-safe diagnostic ───────────────────────────────────────────────────
    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        AIProviderSectionDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "AIProviderSection"), record.fields)
    }

    /** Captures emitted records so the diagnostic can be asserted without a real sink. */
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
