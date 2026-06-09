//
//  AIProviderSection.Validate.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  The pure validate model for the AI provider configuration surface — the SwiftUI
//  parity of the web `runValidate()` flow. The web component posts to
//  `/settings/ai/validate-config` (outside `/ai/*`, so users can verify a provider
//  before saving): cloud mode sends the full configuration for a 1-token chat probe;
//  local mode sends only `mode` + `base_url` for the loopback/RFC1918 pin. This file
//  reproduces that request construction, the success/failure result shape, and the
//  banner-text mapping — all pure so they are unit tested without a network.
//

import Foundation

// MARK: - Validate request (web `validate.mutateAsync(...)` payload)

/// The two probe modes the validator accepts for this surface (the web `mode` field;
/// `off` is never sent from here because the section is hidden when Helix is off).
public enum AiProviderValidateMode: String, Sendable, Equatable {
    case local
    case cloud
}

/// The request body posted to `/settings/ai/validate-config` — the native mirror of
/// the web `ValidateAiProviderRequest`. Cloud mode carries the extended set; local
/// mode carries only `mode` + `provider` + `base_url`. `apiKey` is `nil` when the
/// user left the field blank so the backend keeps its saved (encrypted) key.
public struct AiProviderValidateRequest: Sendable, Equatable {
    public let mode: AiProviderValidateMode
    public let provider: String
    public let baseURL: String
    public let apiKey: String?
    public let model: String
    public let apiVersion: String
    public let flavor: String
    public let deployment: String
    public let embeddingModel: String
    public let embeddingDeployment: String

    public init(
        mode: AiProviderValidateMode,
        provider: String,
        baseURL: String,
        apiKey: String? = nil,
        model: String = "",
        apiVersion: String = "",
        flavor: String = "",
        deployment: String = "",
        embeddingModel: String = "",
        embeddingDeployment: String = ""
    ) {
        self.mode = mode
        self.provider = provider
        self.baseURL = baseURL
        self.apiKey = apiKey
        self.model = model
        self.apiVersion = apiVersion
        self.flavor = flavor
        self.deployment = deployment
        self.embeddingModel = embeddingModel
        self.embeddingDeployment = embeddingDeployment
    }

    /// Builds the request from the live draft exactly as the web `runValidate()` does.
    /// Cloud forwards the full config (omitting an empty `api_key`); local forwards
    /// only the provider-agnostic `mode` + `base_url`.
    public static func build(isCloud: Bool, draft: AiProviderDraft) -> AiProviderValidateRequest {
        guard isCloud else {
            return AiProviderValidateRequest(mode: .local, provider: draft.provider, baseURL: draft.baseURL)
        }
        let trimmedKey = draft.apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return AiProviderValidateRequest(
            mode: .cloud,
            provider: draft.provider,
            baseURL: draft.baseURL,
            apiKey: trimmedKey.isEmpty ? nil : draft.apiKey,
            model: draft.model,
            apiVersion: draft.apiVersion,
            flavor: draft.flavor,
            deployment: draft.deployment,
            embeddingModel: draft.embeddingModel,
            embeddingDeployment: draft.embeddingDeployment
        )
    }

    /// The ordered wire payload (snake_case keys) the seam serialises — mirrors the
    /// web object so the exact set of keys per mode is asserted in tests. An absent
    /// `api_key` is omitted entirely (cloud) rather than sent empty.
    public func payload() -> [(key: String, value: String)] {
        switch mode {
        case .local:
            return [
                ("mode", mode.rawValue),
                ("provider", provider),
                ("base_url", baseURL)
            ]
        case .cloud:
            var body: [(key: String, value: String)] = [
                ("mode", mode.rawValue),
                ("provider", provider),
                ("base_url", baseURL)
            ]
            if let apiKey { body.append(("api_key", apiKey)) }
            body.append(contentsOf: [
                ("model", model),
                ("api_version", apiVersion),
                ("flavor", flavor),
                ("deployment", deployment),
                ("embedding_model", embeddingModel),
                ("embedding_deployment", embeddingDeployment)
            ])
            return body
        }
    }
}

// MARK: - Validate result (web discriminated `ValidateAiProviderResult`)

/// The validator outcome — the native mirror of the web success/failure union. A
/// success may carry the `pinned_ip` the local validator resolved or the
/// `probed_model` the cloud probe exercised; a failure carries the backend's
/// human-readable message verbatim.
public enum AiProviderValidateResult: Sendable, Equatable {
    case ok(pinnedIP: String?, probedModel: String?)
    case failure(message: String)
}

// MARK: - Validate banner (web inline `<span role="status">`)

/// Whether the validate banner reports success or failure (drives its tone).
public enum AiProviderValidateBannerKind: Sendable, Equatable {
    case ok
    case fail
}

/// The resolved validate banner — the kind + the already-localised message the inline
/// status span renders.
public struct AiProviderValidateBanner: Sendable, Equatable {
    public let kind: AiProviderValidateBannerKind
    public let message: String

    public init(kind: AiProviderValidateBannerKind, message: String) {
        self.kind = kind
        self.message = message
    }
}

/// Maps a validate result to its banner — the native port of the web message
/// selection: `pinned_ip` → "OK — pinned to {ip}", else `probed_model` → "OK —
/// {model} reachable", else the generic "OK — provider reachable"; a failure passes
/// the backend message through. The localiser is injected so the mapping is pure and
/// unit tested with deterministic strings.
public enum AiProviderValidateBannerFactory {
    public typealias Localizer = (_ key: String, _ fallback: String) -> String

    public static func make(
        from result: AiProviderValidateResult,
        localize: Localizer
    ) -> AiProviderValidateBanner {
        switch result {
        case let .ok(pinnedIP, probedModel):
            if let ip = pinnedIP, !ip.isEmpty {
                let format = localize("ai.settings.validate.successPinned", "OK — pinned to %@")
                return AiProviderValidateBanner(kind: .ok, message: String(format: format, ip))
            }
            if let probed = probedModel, !probed.isEmpty {
                let format = localize("ai.settings.validate.successProbed", "OK — %@ reachable")
                return AiProviderValidateBanner(kind: .ok, message: String(format: format, probed))
            }
            let generic = localize("ai.settings.validate.success", "OK — provider reachable")
            return AiProviderValidateBanner(kind: .ok, message: generic)
        case let .failure(message):
            return AiProviderValidateBanner(kind: .fail, message: message)
        }
    }
}
