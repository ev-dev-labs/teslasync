//
//  AIProviderSection.Views.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  The presentational body composed by `AIProviderSection`: the resolved provider
//  form (the parity of the web source's regions — provider/model grid, the Azure
//  surface block, the local Base URL + validate, the Azure resource endpoint, the
//  cloud API key + cost cap + validate, the local explainer, and the validate-
//  optional helper), plus the P4 leaf loading / empty / error chrome. All consume the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Form body (web non-loading render)

/// The resolved provider form — the web source's regions in order, gated by the
/// model's field-visibility decisions, wrapped in the shared fade-in (web `FadeIn`).
struct AiProviderForm: View {
    @Bindable var model: AiProviderModel

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                AiProviderFieldPair { providerSelect } second: { modelField }
                if model.showsAzureBlock { azureBlock }
                if model.showsLocalBaseURL { localBaseURLBlock }
                if model.showsAzureBaseURL { azureBaseURLField }
                if model.showsCloudFields { cloudFields }
                if model.showsLocalExplainer { localExplainer }
                helperText
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Provider + model

private extension AiProviderForm {
    var providerSelect: some View {
        AiProviderPickerField(
            label: AiProviderStrings.string("ai.settings.provider.providerLabel", "Provider"),
            selection: $model.draft.provider,
            options: model.providerOptions.map { AiProviderPickerOption(value: $0.value, title: $0.title) }
        )
    }

    var modelField: some View {
        AiProviderTextField(
            label: modelLabel,
            prompt: model.modelPrompt,
            hint: modelHint,
            text: $model.draft.model
        )
    }

    var modelLabel: String {
        model.modelUsesAzureIdentifier
            ? AiProviderStrings.string("ai.settings.provider.azureModelLabel", "Model identifier (e.g. gpt-4o-mini)")
            : AiProviderStrings.string("ai.settings.provider.model", "Model")
    }

    var modelHint: String? {
        guard model.modelUsesAzureIdentifier else { return nil }
        return AiProviderStrings.string(
            "ai.settings.provider.azureModelHint",
            "Used for cost tracking. Leave Deployment blank if your Azure deployment is named the same."
        )
    }
}

// MARK: - Azure surface block (web `provider === 'azure'` grid)

private extension AiProviderForm {
    var azureBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AiProviderFieldPair { azureFlavorSelect } second: { azureApiVersionField }
            if model.showsAzureDeployments {
                AiProviderFieldPair { azureDeploymentField } second: { azureEmbeddingField }
            }
        }
    }

    var azureFlavorSelect: some View {
        AiProviderPickerField(
            label: AiProviderStrings.string("ai.settings.provider.azureFlavor", "Azure surface"),
            selection: $model.azureFlavor,
            options: AiAzureFlavor.options.map {
                AiProviderPickerOption(value: $0.value, title: AiProviderStrings.string($0.labelKey, $0.labelFallback))
            }
        )
    }

    var azureApiVersionField: some View {
        AiProviderTextField(
            label: AiProviderStrings.string("ai.settings.provider.azureApiVersion", "API version"),
            prompt: "2024-10-21",
            hint: AiProviderStrings.string(
                "ai.settings.provider.azureApiVersionHint",
                "Leave blank to use the adapter default."
            ),
            text: $model.draft.apiVersion
        )
    }

    var azureDeploymentField: some View {
        AiProviderTextField(
            label: AiProviderStrings.string("ai.settings.provider.azureDeployment", "Chat deployment name"),
            prompt: model.azureDeploymentPrompt,
            hint: AiProviderStrings.string(
                "ai.settings.provider.azureDeploymentHint",
                "Leave blank to reuse the Model field."
            ),
            text: $model.draft.deployment
        )
    }

    var azureEmbeddingField: some View {
        AiProviderTextField(
            label: AiProviderStrings.string(
                "ai.settings.provider.azureEmbeddingDeployment",
                "Embedding deployment name (optional)"
            ),
            prompt: model.azureEmbeddingPrompt,
            text: $model.draft.embeddingDeployment
        )
    }
}

// MARK: - Base URLs + validate

private extension AiProviderForm {
    var localBaseURLBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            AiProviderTextField(
                label: AiProviderStrings.string("ai.settings.provider.baseUrl", "Base URL"),
                prompt: "http://localhost:11434",
                hint: AiProviderStrings.string(
                    "ai.settings.provider.baseUrlHint",
                    "Must resolve to a private network address (loopback, RFC1918, link-local, or ULA)."
                ),
                text: $model.draft.baseURL
            )
            AiProviderValidateRow(
                title: validateTitle(cloud: false),
                disabled: model.localValidateDisabled,
                banner: model.banner,
                onValidate: { Task { await model.runValidate() } }
            )
        }
    }

    var azureBaseURLField: some View {
        AiProviderTextField(
            label: AiProviderStrings.string("ai.settings.provider.azureBaseUrl", "Resource endpoint URL"),
            prompt: "https://my-resource.openai.azure.com",
            hint: AiProviderStrings.string(
                "ai.settings.provider.azureBaseUrlHint",
                "The Azure OpenAI resource endpoint or Azure AI Foundry endpoint."
            ),
            text: $model.draft.baseURL
        )
    }

    func validateTitle(cloud: Bool) -> String {
        if model.isValidating {
            return AiProviderStrings.string("ai.settings.validate.running", "Validating…")
        }
        return cloud
            ? AiProviderStrings.string("ai.settings.validate.cloudButton", "Validate connection")
            : AiProviderStrings.string("ai.settings.validate.button", "Validate")
    }
}

// MARK: - Cloud fields (API key + cost cap + validate)

private extension AiProviderForm {
    var cloudFields: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            AiProviderSecureField(
                label: AiProviderStrings.string("ai.settings.provider.apiKey", "API key"),
                prompt: AiProviderStrings.string(
                    "ai.settings.provider.apiKeyPlaceholder", // parity:allow web i18n key name, verbatim
                    "sk-…  (leave blank to keep current)"
                ),
                hint: AiProviderStrings.string(
                    "ai.settings.provider.apiKeyHint",
                    "Stored encrypted. Never displayed once saved."
                ),
                text: $model.draft.apiKey
            )
            AiProviderTextField(
                label: AiProviderStrings.string("ai.settings.provider.costCap", "Daily cost cap (USD)"),
                prompt: "5.00",
                hint: AiProviderStrings.string(
                    "ai.settings.provider.costCapHint",
                    "Daily cap on cloud spending. 0 disables the cap."
                ),
                isNumber: true,
                text: $model.costCapText
            )
            AiProviderValidateRow(
                title: validateTitle(cloud: true),
                disabled: model.cloudValidateDisabled,
                banner: model.banner,
                onValidate: { Task { await model.runValidate() } }
            )
        }
    }
}

// MARK: - Local explainer + helper text

private extension AiProviderForm {
    var localExplainer: some View {
        Text(verbatim: AiProviderStrings.string(
            "ai.settings.provider.localExplainer",
            "Local-only mode never sends data outside your network. The validator pins the "
                + "resolved IP at save time to defend against later DNS rebinding."
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var helperText: some View {
        Text(verbatim: AiProviderStrings.string(
            "ai.settings.provider.validateOptional",
            "Validation is optional but recommended — it catches mis-typed URLs and confirms the model is reachable."
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: skeleton field rows so the panel keeps its shape while
/// the provider config resolves.
struct AiProviderLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 80, height: 10)
                    TSSkeleton(height: 36, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AiProviderStrings.string(
            "ai.settings.provider.loadingA11y",
            "Loading provider configuration"
        )))
    }
}

/// The empty render (config resolved with no payload): a friendly state, never blank.
struct AiProviderEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: AiProviderStrings.string(
                    "ai.settings.provider.empty",
                    "Provider configuration is unavailable right now."
                ))
            } icon: {
                Image(systemName: "slider.horizontal.3")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct AiProviderErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: AiProviderStrings.string(
                "ai.settings.provider.errorTitle",
                "Couldn't load provider configuration"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: AiProviderStrings.string("ai.settings.provider.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: AiProviderStrings.string("ai.settings.provider.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
