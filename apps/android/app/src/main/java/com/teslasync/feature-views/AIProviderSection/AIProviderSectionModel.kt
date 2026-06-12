// Pure, framework-free model + projection for the AIProviderSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/AIProviderSection.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// AIProviderSection is the Settings → AI provider-configuration form. It is a *controlled* component: the
// owning settings page owns the draft ([AIProviderDraft]) and the cloud/local mode, passing them down with a
// single `onChange` setter; this surface owns only the ephemeral validate-banner state and the pre-flight
// `POST /settings/ai/validate-config` call. So — exactly like the web source — there is no cache-then-network
// query feed here: the one asynchronous action is the imperative validate mutation
// (`useValidateAiProvider` → the shared [io.teslasync.shared.core.presentation.aisettings.AiSettingsStore]
// `validateAiProvider`, bound through the S8 seam in AIProviderSectionSource). Because there is no fetched
// feed, the prompt's generic stale/offline freshness surfaces do not apply (the web source has none either);
// the surfaces this form does render are: the always-present field content, the idle / validating /
// success / failure validate states, and the transport-error failure the View raises for a non-422 error.
//
// Every render decision the web component computes inline — the provider/flavor option sets, the
// `provider === 'azure' && flavor !== 'foundry'` model-label switch, the Azure sub-panel guard, the
// cents↔dollars cost-cap mapping, the validate-request body (cloud full set vs local mode+url, with the
// `api_key` blank→omit rule), the button-enablement predicates, and the success-banner variant selection
// (pinned → probed → plain) — is reproduced here as a pure function so the View only resolves i18n
// (P1/S10) + design tokens (P1/S9) and draws what the projection returns.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AIProviderSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aiprovider

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderRequest
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderResult
import kotlin.math.roundToInt

/**
 * Local in-memory shape for the provider form — the native mirror of the web `AIProviderDraft`. Holds the
 * server's `ai_provider_config` fields plus the sibling cost cap so the parent can pass a single setter.
 * Kotlin uses camelCase for the field names; the SI/wire mapping back to the snake_case request body is
 * done in [AIProviderProjection.buildValidateRequest].
 *
 * @property provider provider id (`openai`/`anthropic`/`azure`/`google` in cloud, `ollama`/`lmstudio`/
 *   `llama-cpp` in local).
 * @property baseUrl provider base URL (local Ollama-style URL, or the Azure resource endpoint).
 * @property model model identifier used for routing / cost tracking.
 * @property apiKey lives in memory only; an empty string means "no change on save" and is omitted from the
 *   validate body so the backend falls back to the saved (encrypted) key.
 * @property costCapCents daily cap in cents; `0` means unset.
 * @property apiVersion Azure-only API-version query parameter.
 * @property flavor Azure-only surface selector (`openai` = Azure OpenAI Service, `foundry` = Azure AI
 *   Foundry / Inference).
 * @property deployment Azure-only chat deployment name; blank → the adapter falls back to [model].
 * @property embeddingModel embedding model identifier (used by the RAG worker).
 * @property embeddingDeployment Azure-only embedding deployment name.
 */
data class AIProviderDraft(
    val provider: String = "",
    val baseUrl: String = "",
    val model: String = "",
    val apiKey: String = "",
    val costCapCents: Int = 0,
    val apiVersion: String = "",
    val flavor: String = "",
    val deployment: String = "",
    val embeddingModel: String = "",
    val embeddingDeployment: String = "",
)

/**
 * One selectable provider/flavor option — a stable [value] and a display [label]. The labels are vendor
 * brand names / product-surface descriptors that the web source renders verbatim (never through `t()`), so
 * they are carried as literals here for faithful parity rather than routed through the i18n catalog.
 */
data class ProviderChoice(
    val value: String,
    val label: String,
)

/** Whether a completed validation succeeded or was rejected — drives the banner's accent color. */
enum class ValidateOutcome { Ok, Fail }

/**
 * The render-ready validate-banner message, kept i18n-free so the projection stays framework-free: the View
 * resolves each case to a localized string (P1/S10). [Failure] carries the server-provided human message
 * verbatim (the web `result.message`), which is already localized server-side and not a client catalog key.
 */
sealed interface ValidateMessage {
    /** Local validator pinned a resolved private IP — web `successPinned` ("OK — pinned to {{ip}}"). */
    data class Pinned(
        val ip: String,
    ) : ValidateMessage

    /** Cloud probe exercised a concrete model — web `successProbed` ("OK — {{model}} reachable"). */
    data class Probed(
        val model: String,
    ) : ValidateMessage

    /** Plain success with no pinned IP or probed model — web `success` ("OK — provider reachable"). */
    data object Reachable : ValidateMessage

    /** A rejection or transport failure carrying the message to display (web `result.message`). */
    data class Failure(
        val text: String,
    ) : ValidateMessage
}

/** The fully projected validate banner shown after a validation completes; `null` means no banner. */
data class ValidateBanner(
    val outcome: ValidateOutcome,
    val message: ValidateMessage,
)

/**
 * Pure projection from the [AIProviderDraft] + cloud/local mode + validation result to everything the web
 * component computes inline. Stateless and framework-free; the single source of truth for the surface's
 * render decisions so they are verified once, off-device.
 */
object AIProviderProjection {
    /** Cloud provider choices (web cloud `options`). Labels are vendor brand names, rendered verbatim. */
    val cloudProviderChoices: List<ProviderChoice> =
        listOf(
            ProviderChoice("openai", "OpenAI"),
            ProviderChoice("anthropic", "Anthropic"),
            ProviderChoice("azure", "Azure AI"),
            ProviderChoice("google", "Google"),
        )

    /** Local provider choices (web local `options`). Labels are product brand names, rendered verbatim. */
    val localProviderChoices: List<ProviderChoice> =
        listOf(
            ProviderChoice("ollama", "Ollama"),
            ProviderChoice("lmstudio", "LM Studio"),
            ProviderChoice("llama-cpp", "llama.cpp"),
        )

    /** The Azure surface choices (web Azure-flavor `options`). Descriptors rendered verbatim like the web. */
    val azureFlavorChoices: List<ProviderChoice> =
        listOf(
            ProviderChoice("openai", "Azure OpenAI Service (gpt-4o, gpt-4-turbo, …)"),
            ProviderChoice("foundry", "Azure AI Foundry / Inference (multi-vendor)"),
        )

    /** The provider choices for the active [isCloud] mode (web `isCloud ? cloud : local`). */
    fun providerChoices(isCloud: Boolean): List<ProviderChoice> = if (isCloud) cloudProviderChoices else localProviderChoices

    /**
     * Whether the Azure sub-panel (surface + api-version + deployment fields) and the Azure resource-endpoint
     * URL are shown — web `isCloud && value.provider === 'azure'`.
     */
    fun showAzureConfig(
        isCloud: Boolean,
        provider: String,
    ): Boolean = isCloud && provider == AZURE

    /**
     * Whether the Azure deployment-name fields (chat + embedding) are shown — web `value.flavor !== 'foundry'`
     * within the Azure sub-panel (the Foundry surface routes the model in the body, so it has no deployment).
     */
    fun showAzureDeploymentFields(flavor: String): Boolean = flavor != FOUNDRY

    /**
     * Whether the Model field uses the Azure "model identifier" label + cost-tracking hint, rather than the
     * plain "Model" label — web `value.provider === 'azure' && value.flavor !== 'foundry'`.
     */
    fun usesAzureModelLabel(
        provider: String,
        flavor: String,
    ): Boolean = provider == AZURE && flavor != FOUNDRY

    /** The Azure-surface select value, defaulting blank → `openai` (web `value.flavor || 'openai'`). */
    fun azureFlavorValue(flavor: String): String = flavor.ifBlank { OPENAI }

    /** Model-field example (ghost prompt) — web `isCloud ? 'gpt-4o-mini' : 'llama3.1:8b'`. */
    fun modelExample(isCloud: Boolean): String = if (isCloud) "gpt-4o-mini" else "llama3.1:8b"

    /** Azure chat-deployment example (ghost prompt) — web `value.model || 'gpt-4o-mini'`. */
    fun azureDeploymentExample(model: String): String = model.ifBlank { "gpt-4o-mini" }

    /** Azure embedding-deployment example (ghost prompt) — web `value.embedding_model || 'text-embedding-3-small'`. */
    fun azureEmbeddingExample(embeddingModel: String): String = embeddingModel.ifBlank { "text-embedding-3-small" }

    /**
     * The cost-cap field's display string — web `cost_cap_cents > 0 ? (cents / 100).toFixed(2) : ''`. Uses
     * exact integer arithmetic (no float rounding, no locale grouping) so it round-trips with
     * [parseCostCapCents]: 500 → "5.00", 5 → "0.05", 100000 → "1000.00", 0 → "".
     */
    fun costCapDisplay(cents: Int): String {
        if (cents <= 0) return ""
        val whole = cents / CENTS_PER_UNIT
        val frac = cents % CENTS_PER_UNIT
        return "$whole.${frac.toString().padStart(2, '0')}"
    }

    /**
     * Parses a dollars string back to cents — web `const dollars = parseFloat(v); isFinite ? max(0,
     * round(dollars * 100)) : 0`. A non-numeric or empty value yields `0`; negatives clamp to `0`.
     */
    fun parseCostCapCents(input: String): Int {
        val dollars = input.trim().toDoubleOrNull() // parity:allow stdlib parser; "toDo" substring false positive
        if (dollars == null || !dollars.isFinite()) return 0
        return (dollars * CENTS_PER_UNIT).roundToInt().coerceAtLeast(0)
    }

    /**
     * Builds the `POST /settings/ai/validate-config` request body for the active mode — the verbatim port of
     * the web `validate.mutateAsync(...)` payload.
     *
     * Local mode sends only `mode`/`provider`/`base_url` (the validator is provider-agnostic there). Cloud
     * mode sends the full configuration so the backend can build a real adapter and run a 1-token probe;
     * `api_key` is omitted (null) when the user did not type one so the backend falls back to the saved
     * (encrypted) key rather than clobbering it with "", while the remaining fields are sent as-is (empty
     * strings included) exactly as the web `JSON.stringify` body does.
     */
    fun buildValidateRequest(
        draft: AIProviderDraft,
        isCloud: Boolean,
    ): ValidateAiProviderRequest =
        if (isCloud) {
            ValidateAiProviderRequest(
                mode = MODE_CLOUD,
                provider = draft.provider,
                baseUrl = draft.baseUrl,
                apiKey = draft.apiKey.takeIf { it.trim().isNotEmpty() },
                model = draft.model,
                apiVersion = draft.apiVersion,
                flavor = draft.flavor,
                deployment = draft.deployment,
                embeddingModel = draft.embeddingModel,
                embeddingDeployment = draft.embeddingDeployment,
            )
        } else {
            ValidateAiProviderRequest(
                mode = MODE_LOCAL,
                provider = draft.provider,
                baseUrl = draft.baseUrl,
            )
        }

    /**
     * Maps a completed [ValidateAiProviderResult] to the render-ready [ValidateBanner] — web's
     * `result.ok ? (pinned_ip ? successPinned : probed_model ? successProbed : success) : { fail, message }`.
     * Blank `pinnedIp`/`probedModel` are treated as absent to mirror JS truthiness (empty string is falsy).
     */
    fun bannerFrom(result: ValidateAiProviderResult): ValidateBanner =
        when (result) {
            is ValidateAiProviderResult.Success -> {
                val pinned = result.pinnedIp?.takeIf { it.isNotBlank() }
                val probed = result.probedModel?.takeIf { it.isNotBlank() }
                val message =
                    when {
                        pinned != null -> ValidateMessage.Pinned(pinned)
                        probed != null -> ValidateMessage.Probed(probed)
                        else -> ValidateMessage.Reachable
                    }
                ValidateBanner(ValidateOutcome.Ok, message)
            }

            is ValidateAiProviderResult.Failure -> ValidateBanner(ValidateOutcome.Fail, ValidateMessage.Failure(result.message))
        }

    /**
     * Whether the local Validate button is enabled — web `!validate.isPending && base_url.trim().length > 0`.
     * (The button's spinner/disabled state while pending is driven separately by the loading flag.)
     */
    fun localValidateEnabled(baseUrl: String): Boolean = baseUrl.trim().isNotEmpty()

    private const val AZURE = "azure"
    private const val FOUNDRY = "foundry"
    private const val OPENAI = "openai"
    private const val MODE_CLOUD = "cloud"
    private const val MODE_LOCAL = "local"
    private const val CENTS_PER_UNIT = 100
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * provider URL, API key, model, or any other field — so a diagnostics line can never leak provider
 * configuration or secrets.
 */
object AIProviderSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "AIProviderSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
