//
//  AIProviderSection.Adapter.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  The testable projection core for the AI provider configuration surface — the
//  SwiftUI parity of features/settings/components/AIProviderSection.tsx. Everything
//  here is pure and dependency-free (no store, no SwiftUI, no rendered view) so the
//  provider catalogue, the field-visibility layout decisions, the cost-cap
//  cents↔dollars arithmetic, and the validate-button gating are all unit tested in
//  isolation. The web component is a controlled form; these helpers reproduce its
//  conditional-render logic verbatim so the view stays declarative.
//

import Foundation

// MARK: - Provider catalogue (web `<Select>` option arrays)

/// One selectable provider — the native mirror of a web `<Select>` option. The
/// `value` is the wire identifier (`openai`, `ollama`, …); the `title` is the brand
/// proper noun rendered verbatim, exactly as the web hardcodes it (brand names are
/// data, not translatable UI copy).
public struct AiProviderOption: Identifiable, Equatable, Sendable {
    public let value: String
    public let title: String

    public var id: String {
        value
    }

    public init(value: String, title: String) {
        self.value = value
        self.title = title
    }
}

/// The provider option catalogue, split by mode exactly as the web source does:
/// cloud → OpenAI / Anthropic / Azure AI / Google; local → Ollama / LM Studio /
/// llama.cpp. Order is preserved so the picker matches the web dropdown.
public enum AiProviderCatalog {
    public static let cloud: [AiProviderOption] = [
        AiProviderOption(value: "openai", title: "OpenAI"),
        AiProviderOption(value: "anthropic", title: "Anthropic"),
        AiProviderOption(value: "azure", title: "Azure AI"),
        AiProviderOption(value: "google", title: "Google")
    ]

    public static let local: [AiProviderOption] = [
        AiProviderOption(value: "ollama", title: "Ollama"),
        AiProviderOption(value: "lmstudio", title: "LM Studio"),
        AiProviderOption(value: "llama-cpp", title: "llama.cpp")
    ]

    /// The option list for the current mode (web `isCloud ? [...] : [...]`).
    public static func options(isCloud: Bool) -> [AiProviderOption] {
        isCloud ? cloud : local
    }
}

// MARK: - Azure surface flavor (web Azure `<Select>` option arrays)

/// One Azure-surface flavor option. The descriptive labels are hardcoded inline in
/// the web `<Select>`; here they are carried as i18n keys + their web English
/// fallback so the view resolves them through the P1/S10 facade (no literals in
/// Swift).
public struct AiAzureFlavorOption: Identifiable, Equatable, Sendable {
    public let value: String
    public let labelKey: String
    public let labelFallback: String

    public var id: String {
        value
    }

    public init(value: String, labelKey: String, labelFallback: String) {
        self.value = value
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }
}

/// The Azure-surface flavor catalogue — `openai` (Azure OpenAI Service,
/// deployment-name routing) and `foundry` (Azure AI Foundry / Inference,
/// model-in-body routing), in the web order.
public enum AiAzureFlavor {
    public static let openai = "openai"
    public static let foundry = "foundry"

    public static let options: [AiAzureFlavorOption] = [
        AiAzureFlavorOption(
            value: openai,
            labelKey: "ai.settings.provider.azureFlavor.openai",
            labelFallback: "Azure OpenAI Service (gpt-4o, gpt-4-turbo, …)"
        ),
        AiAzureFlavorOption(
            value: foundry,
            labelKey: "ai.settings.provider.azureFlavor.foundry",
            labelFallback: "Azure AI Foundry / Inference (multi-vendor)"
        )
    ]

    /// The effective flavor — the web `value.flavor || 'openai'` default applied so a
    /// never-set flavor routes through the Azure OpenAI Service surface.
    public static func effective(_ flavor: String) -> String {
        flavor.isEmpty ? openai : flavor
    }
}

// MARK: - Field-visibility layout (web conditional-render guards)

/// The provider identifier the web source special-cases.
private let azureProvider = "azure"

/// Pure reproduction of the web source's conditional-render decisions. Each function
/// maps a `(isCloud, provider, flavor)` slice to a render gate, so the view never
/// reinvents the branching and the rules are asserted in isolation.
public enum AiProviderLayout {
    /// Model label/hint swap to the Azure identifier variant (web
    /// `provider === 'azure' && flavor !== 'foundry'`).
    public static func modelUsesAzureIdentifier(provider: String, flavor: String) -> Bool {
        provider == azureProvider && AiAzureFlavor.effective(flavor) != AiAzureFlavor.foundry
    }

    /// The Azure flavor + api-version + deployment block (web
    /// `isCloud && provider === 'azure'`).
    public static func showsAzureBlock(isCloud: Bool, provider: String) -> Bool {
        isCloud && provider == azureProvider
    }

    /// The chat + embedding deployment inputs inside the Azure block (web
    /// `flavor !== 'foundry'`).
    public static func showsAzureDeployments(flavor: String) -> Bool {
        AiAzureFlavor.effective(flavor) != AiAzureFlavor.foundry
    }

    /// The local Base URL input + inline validate (web `!isCloud`).
    public static func showsLocalBaseURL(isCloud: Bool) -> Bool {
        !isCloud
    }

    /// The Azure resource-endpoint URL input (web `isCloud && provider === 'azure'`).
    public static func showsAzureBaseURL(isCloud: Bool, provider: String) -> Bool {
        isCloud && provider == azureProvider
    }

    /// The cloud-only fields: API key + cost cap + cloud validate (web `isCloud`).
    public static func showsCloudFields(isCloud: Bool) -> Bool {
        isCloud
    }

    /// The local-only privacy explainer caption (web `!isCloud`).
    public static func showsLocalExplainer(isCloud: Bool) -> Bool {
        !isCloud
    }

    /// The model field prompt (web `isCloud ? 'gpt-4o-mini' : 'llama3.1:8b'`).
    public static func modelPrompt(isCloud: Bool) -> String {
        isCloud ? "gpt-4o-mini" : "llama3.1:8b"
    }

    /// The Azure chat-deployment prompt (web `value.model || 'gpt-4o-mini'`).
    public static func azureDeploymentPrompt(model: String) -> String {
        model.isEmpty ? "gpt-4o-mini" : model
    }

    /// The Azure embedding-deployment prompt (web
    /// `value.embedding_model || 'text-embedding-3-small'`).
    public static func azureEmbeddingPrompt(embeddingModel: String) -> String {
        embeddingModel.isEmpty ? "text-embedding-3-small" : embeddingModel
    }
}

// MARK: - Validate-button gating (web `disabled={…}`)

/// The enablement rules for the two validate buttons, kept pure so the gate is
/// asserted without rendering.
public enum AiProviderValidateGate {
    /// Local validate is disabled while a probe is in flight or the Base URL is blank
    /// (web `validate.isPending || value.base_url.trim().length === 0`).
    public static func localDisabled(isValidating: Bool, baseURL: String) -> Bool {
        isValidating || baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Cloud validate is disabled only while a probe is in flight — an empty API key
    /// is allowed because the backend falls back to the saved key (web
    /// `disabled={validate.isPending}`).
    public static func cloudDisabled(isValidating: Bool) -> Bool {
        isValidating
    }
}

// MARK: - Cost-cap field conversion (web cents↔dollars at the input boundary)

/// Pure cents↔dollars conversion for the "Daily cost cap (USD)" input. The draft
/// stores whole cents (the wire shape); the field renders + parses dollars, matching
/// the web `Input type="number"` round-trip exactly.
public enum AiCostCapField {
    /// The invariant POSIX locale, matching the web `toFixed(2)` `.`-separator output.
    public static let posix = Locale(identifier: "en_US_POSIX")

    /// The field's displayed value (web
    /// `cost_cap_cents > 0 ? (cents / 100).toFixed(2) : ''`).
    public static func display(cents: Int, locale: Locale = AiCostCapField.posix) -> String {
        guard cents > 0 else { return "" }
        return fixed2(Double(cents) / 100, locale: locale)
    }

    /// Parses the edited dollar text back to whole cents (web
    /// `const dollars = parseFloat(text); Number.isFinite(dollars) ? max(0,
    /// round(dollars * 100)) : 0`). Non-numeric / empty input clears the cap to 0.
    public static func cents(fromDollars text: String) -> Int {
        guard let dollars = parseLeadingDouble(text), dollars.isFinite else { return 0 }
        return max(0, Int((dollars * 100).rounded()))
    }

    /// Native port of `value.toFixed(2)`: two fixed fraction digits, half-away
    /// rounding, no grouping, invariant separator.
    public static func fixed2(_ value: Double, locale: Locale = AiCostCapField.posix) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        formatter.roundingMode = .halfUp
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? "0.00"
    }

    /// Mirrors JS `parseFloat` leniency: parse the leading numeric run and ignore any
    /// trailing junk (`"5.00 USD"` → 5.0), returning `nil` only when no number leads.
    private static func parseLeadingDouble(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let direct = Double(trimmed) { return direct }
        var prefix = ""
        for char in trimmed {
            if char.isNumber || char == "." || char == "-" || char == "+" {
                prefix.append(char)
            } else {
                break
            }
        }
        return Double(prefix)
    }
}
