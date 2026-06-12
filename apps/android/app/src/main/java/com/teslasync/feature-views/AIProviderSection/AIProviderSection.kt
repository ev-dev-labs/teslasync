// The native Jetpack Compose + Material 3 AIProviderSection feature view — a parity port of
// web/src/features/settings/components/AIProviderSection.tsx. The web component is the Settings → AI
// provider-configuration form: a controlled component that receives the draft + cloud/local mode + an
// `onChange` setter from its parent, owns only the ephemeral validate-banner state, and runs a pre-flight
// `POST /settings/ai/validate-config` probe so users can confirm a local URL or a cloud key/endpoint before
// saving.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the validate action only
// through the shared S8 state-holder seam ([AiProviderValidator], wired by the owning Settings → AI page to
// AiSettingsStore.validateAiProvider), so the view never reaches the network itself. Every derivation flows
// through the pure [AIProviderProjection]; the composable is a thin render layer that resolves the i18n
// labels (P1/S10) and design-token accents (P1/S9) and draws what the projection returns, using the shared
// component library (ui Select / Button / typography) plus a single co-located Material 3 text field that
// adds the web "ghost prompt" the shared Input intentionally omits. It renders every surface the web source
// has — the always-present field content, the validate idle / validating / success / failure states (success
// resolved to the pinned / probed / plain variant) — without ever hiding a field. There is no
// cache-then-network feed here (the web source has none: `useAiSettings` exposes only mutations), so the
// generic stale/offline freshness chips do not apply; the one transport-error path raises the localized
// failure banner so a non-422 error is never swallowed. The one-shot PII-safe `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AIProviderSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting composables.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aiprovider

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch

/**
 * Stateful entry point — the faithful 1:1 port of the web `AIProviderSection` props. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), owns the ephemeral validate-banner + in-flight
 * flag (the web `useState` + `validate.isPending`), runs the pre-flight validation through the shared
 * [validator] seam (never HTTP itself), and clears the banner on any field edit exactly like the web `patch`.
 *
 * @param value the provider draft, owned by the parent (web `value` prop).
 * @param isCloud whether cloud mode is active; selects the provider set + which fields render (web `isCloud`).
 * @param onChange raises the edited draft to the parent (web `onChange`).
 * @param validator the S8 validate seam producing the cache-free pre-flight result; the owning Settings → AI
 *   page wires this to `AiSettingsStore.validateAiProvider`. The view never calls HTTP itself.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AIProviderSection(
    value: AIProviderDraft,
    isCloud: Boolean,
    onChange: (AIProviderDraft) -> Unit,
    validator: AiProviderValidator,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AIProviderSectionDiagnostics.recordViewOpened(logger) }

    var banner by remember { mutableStateOf<ValidateBanner?>(null) }
    var validating by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val transportFailure = stringResource(R.string.translation_ai_settings_validate_failure)

    AIProviderSectionContent(
        value = value,
        isCloud = isCloud,
        banner = banner,
        validating = validating,
        onPatch = { next ->
            // Mirror the web `patch`: lift the edit to the parent and clear stale validation feedback.
            onChange(next)
            banner = null
        },
        onValidate = {
            if (!validating) {
                validating = true
                banner = null
                scope.launch {
                    banner =
                        validator
                            .validate(AIProviderProjection.buildValidateRequest(value, isCloud))
                            .fold(
                                onSuccess = { AIProviderProjection.bannerFrom(it) },
                                onFailure = { ValidateBanner(ValidateOutcome.Fail, ValidateMessage.Failure(transportFailure)) },
                            )
                    validating = false
                }
            }
        },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the preview/UI-test entry point. Draws the bordered section (web aria-labelled
 * `<section>`), the provider + model fields, the cloud-Azure sub-panel, the local base-URL + validate row,
 * the cloud API-key + cost-cap + validate row, and the mode-specific explainer/helper copy. Every field
 * always renders with its label and ghost example; no surface is hidden when a value is empty.
 */
@Composable
fun AIProviderSectionContent(
    value: AIProviderDraft,
    isCloud: Boolean,
    banner: ValidateBanner?,
    validating: Boolean,
    onPatch: (AIProviderDraft) -> Unit,
    onValidate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sectionLabel = stringResource(R.string.translation_ai_settings_provider_label)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.medium)
                .padding(Spacing.md)
                .semantics { contentDescription = sectionLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Subhead(sectionLabel)

        ProviderAndModelFields(value = value, isCloud = isCloud, onPatch = onPatch)

        if (AIProviderProjection.showAzureConfig(isCloud, value.provider)) {
            AzureConfigFields(value = value, onPatch = onPatch)
        }

        if (!isCloud) {
            LocalProviderFields(
                value = value,
                banner = banner,
                validating = validating,
                onPatch = onPatch,
                onValidate = onValidate,
            )
        }

        if (AIProviderProjection.showAzureConfig(isCloud, value.provider)) {
            AzureEndpointField(value = value, onPatch = onPatch)
        }

        if (isCloud) {
            CloudProviderFields(
                value = value,
                banner = banner,
                validating = validating,
                onPatch = onPatch,
                onValidate = onValidate,
            )
        }

        if (!isCloud) {
            Caption(stringResource(R.string.translation_ai_settings_provider_localExplainer))
        }

        HelperText(stringResource(R.string.translation_ai_settings_provider_validateOptional))
    }
}

/** Provider select + model field. The model label/hint switch to the Azure variant per the projection. */
@Composable
private fun ProviderAndModelFields(
    value: AIProviderDraft,
    isCloud: Boolean,
    onPatch: (AIProviderDraft) -> Unit,
) {
    Select(
        options = AIProviderProjection.providerChoices(isCloud).map { SelectOption(it.value, it.label) },
        selectedValue = value.provider,
        onSelect = { onPatch(value.copy(provider = it)) },
        label = stringResource(R.string.translation_ai_settings_provider_providerLabel),
    )

    val azureModel = AIProviderProjection.usesAzureModelLabel(value.provider, value.flavor)
    LabeledField(
        label =
            if (azureModel) {
                stringResource(R.string.translation_ai_settings_provider_azureModelLabel)
            } else {
                stringResource(R.string.translation_ai_settings_provider_model)
            },
        value = value.model,
        onValueChange = { onPatch(value.copy(model = it)) },
        example = AIProviderProjection.modelExample(isCloud),
        hint = if (azureModel) stringResource(R.string.translation_ai_settings_provider_azureModelHint) else null,
    )
}

/** Azure surface select + API version + (non-Foundry) chat/embedding deployment fields. */
@Composable
private fun AzureConfigFields(
    value: AIProviderDraft,
    onPatch: (AIProviderDraft) -> Unit,
) {
    Select(
        options = AIProviderProjection.azureFlavorChoices.map { SelectOption(it.value, it.label) },
        selectedValue = AIProviderProjection.azureFlavorValue(value.flavor),
        onSelect = { onPatch(value.copy(flavor = it)) },
        label = stringResource(R.string.translation_ai_settings_provider_azureFlavor),
    )

    LabeledField(
        label = stringResource(R.string.translation_ai_settings_provider_azureApiVersion),
        value = value.apiVersion,
        onValueChange = { onPatch(value.copy(apiVersion = it)) },
        example = "2024-10-21",
        hint = stringResource(R.string.translation_ai_settings_provider_azureApiVersionHint),
    )

    if (AIProviderProjection.showAzureDeploymentFields(value.flavor)) {
        LabeledField(
            label = stringResource(R.string.translation_ai_settings_provider_azureDeployment),
            value = value.deployment,
            onValueChange = { onPatch(value.copy(deployment = it)) },
            example = AIProviderProjection.azureDeploymentExample(value.model),
            hint = stringResource(R.string.translation_ai_settings_provider_azureDeploymentHint),
        )
        LabeledField(
            label = stringResource(R.string.translation_ai_settings_provider_azureEmbeddingDeployment),
            value = value.embeddingDeployment,
            onValueChange = { onPatch(value.copy(embeddingDeployment = it)) },
            example = AIProviderProjection.azureEmbeddingExample(value.embeddingModel),
        )
    }
}

/** The Azure resource-endpoint URL field (binds the shared `base_url`, like the web Azure base-URL input). */
@Composable
private fun AzureEndpointField(
    value: AIProviderDraft,
    onPatch: (AIProviderDraft) -> Unit,
) {
    LabeledField(
        label = stringResource(R.string.translation_ai_settings_provider_azureBaseUrl),
        value = value.baseUrl,
        onValueChange = { onPatch(value.copy(baseUrl = it)) },
        example = "https://my-resource.openai.azure.com",
        hint = stringResource(R.string.translation_ai_settings_provider_azureBaseUrlHint),
    )
}

/** Local-mode base URL + the validate row (button disabled until a URL is typed, web `base_url.trim()`). */
@Composable
private fun LocalProviderFields(
    value: AIProviderDraft,
    banner: ValidateBanner?,
    validating: Boolean,
    onPatch: (AIProviderDraft) -> Unit,
    onValidate: () -> Unit,
) {
    LabeledField(
        label = stringResource(R.string.translation_ai_settings_provider_baseUrl),
        value = value.baseUrl,
        onValueChange = { onPatch(value.copy(baseUrl = it)) },
        example = "http://localhost:11434",
        hint = stringResource(R.string.translation_ai_settings_provider_baseUrlHint),
    )
    ValidateRow(
        label = stringResource(R.string.translation_ai_settings_validate_button),
        runningLabel = stringResource(R.string.translation_ai_settings_validate_running),
        enabled = AIProviderProjection.localValidateEnabled(value.baseUrl),
        validating = validating,
        banner = banner,
        onValidate = onValidate,
    )
}

/** Cloud-mode API key (masked) + daily cost cap + the always-enabled cloud validate row. */
@Composable
private fun CloudProviderFields(
    value: AIProviderDraft,
    banner: ValidateBanner?,
    validating: Boolean,
    onPatch: (AIProviderDraft) -> Unit,
    onValidate: () -> Unit,
) {
    val apiKeyGhost = stringResource(R.string.translation_ai_settings_provider_apiKeyPlaceholder) // parity:allow i18n key id
    LabeledField(
        label = stringResource(R.string.translation_ai_settings_provider_apiKey),
        value = value.apiKey,
        onValueChange = { onPatch(value.copy(apiKey = it)) },
        example = apiKeyGhost,
        hint = stringResource(R.string.translation_ai_settings_provider_apiKeyHint),
        keyboardType = KeyboardType.Password,
        visualTransformation = PasswordVisualTransformation(),
    )
    LabeledField(
        label = stringResource(R.string.translation_ai_settings_provider_costCap),
        value = AIProviderProjection.costCapDisplay(value.costCapCents),
        onValueChange = { onPatch(value.copy(costCapCents = AIProviderProjection.parseCostCapCents(it))) },
        example = "5.00",
        hint = stringResource(R.string.translation_ai_settings_provider_costCapHint),
        keyboardType = KeyboardType.Decimal,
    )
    ValidateRow(
        label = stringResource(R.string.translation_ai_settings_validate_cloudButton),
        runningLabel = stringResource(R.string.translation_ai_settings_validate_running),
        enabled = true,
        validating = validating,
        banner = banner,
        onValidate = onValidate,
    )
}

/** A ghost (status-row) Validate button + the inline result banner, shared by the local + cloud rows. */
@Composable
private fun ValidateRow(
    label: String,
    runningLabel: String,
    enabled: Boolean,
    validating: Boolean,
    banner: ValidateBanner?,
    onValidate: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = if (validating) runningLabel else label,
            onClick = onValidate,
            variant = ButtonVariant.Ghost,
            enabled = enabled,
            loading = validating,
        )
        if (banner != null) {
            ValidateBannerText(banner)
        }
    }
}

/** The inline validation result — emerald on success, rose on failure — announced as a polite live region. */
@Composable
private fun ValidateBannerText(banner: ValidateBanner) {
    val color =
        if (banner.outcome == ValidateOutcome.Ok) TeslaTokens.status.success else TeslaTokens.status.danger
    BodyText(
        text = validateMessageText(banner.message),
        color = color,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** Resolves a [ValidateMessage] to its localized string (P1/S10), interpolating the pinned IP / probed model. */
@Composable
private fun validateMessageText(message: ValidateMessage): String =
    when (message) {
        is ValidateMessage.Pinned ->
            stringResource(R.string.translation_ai_settings_validate_successPinned, message.ip)
        is ValidateMessage.Probed ->
            stringResource(R.string.translation_ai_settings_validate_successProbed, message.model)
        ValidateMessage.Reachable -> stringResource(R.string.translation_ai_settings_validate_success)
        is ValidateMessage.Failure -> message.text
    }

/**
 * A labeled single-line text field with the web "ghost prompt" the shared [io.teslasync.android.components.ui.Input]
 * intentionally omits. Built on Material 3 [OutlinedTextField]: the floating [label] is the accessible name,
 * [example] is the in-field ghost prompt (the web ghost-prompt prop), and [hint] is the supporting text below.
 */
@Composable
private fun LabeledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    example: String? = null,
    hint: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        singleLine = true,
        label = { Text(label) },
        placeholder = example?.let { text -> { Text(text) } }, // parity:allow M3 OutlinedTextField slot name
        supportingText = hint?.let { text -> { Text(text) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        visualTransformation = visualTransformation,
        shape = MaterialTheme.shapes.medium,
    )
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_LOCAL =
    AIProviderDraft(provider = "ollama", baseUrl = "http://localhost:11434", model = "llama3.1:8b")

private val PREVIEW_CLOUD =
    AIProviderDraft(provider = "openai", model = "gpt-4o-mini", costCapCents = 500)

private val PREVIEW_AZURE =
    AIProviderDraft(provider = "azure", flavor = "openai", model = "gpt-4o", apiVersion = "2024-10-21")

@Preview(name = "AIProviderSection — local idle", showBackground = true)
@Composable
private fun AIProviderSectionLocalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIProviderSectionContent(
            value = PREVIEW_LOCAL,
            isCloud = false,
            banner = null,
            validating = false,
            onPatch = {},
            onValidate = {},
        )
    }
}

@Preview(name = "AIProviderSection — local validating", showBackground = true)
@Composable
private fun AIProviderSectionValidatingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIProviderSectionContent(
            value = PREVIEW_LOCAL,
            isCloud = false,
            banner = null,
            validating = true,
            onPatch = {},
            onValidate = {},
        )
    }
}

@Preview(name = "AIProviderSection — local OK (pinned)", showBackground = true)
@Composable
private fun AIProviderSectionPinnedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIProviderSectionContent(
            value = PREVIEW_LOCAL,
            isCloud = false,
            banner = ValidateBanner(ValidateOutcome.Ok, ValidateMessage.Pinned("127.0.0.1")),
            validating = false,
            onPatch = {},
            onValidate = {},
        )
    }
}

@Preview(name = "AIProviderSection — cloud OK (probed)", showBackground = true)
@Composable
private fun AIProviderSectionProbedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIProviderSectionContent(
            value = PREVIEW_CLOUD,
            isCloud = true,
            banner = ValidateBanner(ValidateOutcome.Ok, ValidateMessage.Probed("gpt-4o-mini")),
            validating = false,
            onPatch = {},
            onValidate = {},
        )
    }
}

@Preview(name = "AIProviderSection — cloud failure", showBackground = true)
@Composable
private fun AIProviderSectionFailurePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIProviderSectionContent(
            value = PREVIEW_CLOUD,
            isCloud = true,
            banner = ValidateBanner(ValidateOutcome.Fail, ValidateMessage.Failure("Unauthorized — check the API key")),
            validating = false,
            onPatch = {},
            onValidate = {},
        )
    }
}

@Preview(name = "AIProviderSection — cloud Azure", showBackground = true)
@Composable
private fun AIProviderSectionAzurePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIProviderSectionContent(
            value = PREVIEW_AZURE,
            isCloud = true,
            banner = null,
            validating = false,
            onPatch = {},
            onValidate = {},
        )
    }
}
