//
//  AIProviderSection.Projection.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  The pure input → resolved view-state projection for the AI provider configuration
//  surface, split out of `AIProviderSection.Model.swift` so each file stays focused.
//  The web component is a controlled, always-rendered form; on top of it this surface
//  honours the P4 leaf contract — a `phase` (loading / empty / error / data) fed by
//  the parent settings query and an orthogonal `connection` axis carried through.
//  Everything here is pure and unit tested in isolation.
//

import Foundation

// MARK: - Input snapshot (web hook outputs + parent props)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web
/// parent-owned props (`value: AIProviderDraft`, `isCloud`) plus the parent query
/// lifecycle. `savedDraft == nil` while not loading and with no error means the
/// provider config was absent (the empty branch); otherwise the form renders.
public struct AiProviderInput: Sendable, Equatable {
    public var savedDraft: AiProviderDraft?
    public var isCloud: Bool
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: AiProviderConnection

    public init(
        savedDraft: AiProviderDraft? = nil,
        isCloud: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: AiProviderConnection = .live
    ) {
        self.savedDraft = savedDraft
        self.isCloud = isCloud
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (P4 leaf contract)

/// The resolved, view-ready provider state — `phase` selects the body, the resolved
/// `draft` is the hydration seed, and `isCloud` selects the cloud/local field set.
public struct AiProviderResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let draft: AiProviderDraft
    public let isCloud: Bool

    public init(phase: Phase, draft: AiProviderDraft, isCloud: Bool) {
        self.phase = phase
        self.draft = draft
        self.isCloud = isCloud
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the P4 leaf contract. Unit tested across loading / empty / error / data.
public enum AiProviderProjection {
    public static func resolve(_ input: AiProviderInput) -> AiProviderResolved {
        AiProviderResolved(
            phase: phase(for: input),
            draft: input.savedDraft ?? .empty,
            isCloud: input.isCloud
        )
    }

    private static func phase(for input: AiProviderInput) -> AiProviderResolved.Phase {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return .error(message)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return .loading
        }
        // Provider config resolved with no payload → friendly empty state.
        if input.savedDraft == nil {
            return .empty
        }
        return .data
    }
}
