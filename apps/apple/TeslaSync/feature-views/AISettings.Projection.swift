//
//  AISettings.Projection.swift
//  TeslaSync — P4 feature view · 0202 · AISettings (Apple)
//
//  The pure input → resolved view-state projection for the Helix (AI) settings
//  surface, split out of `AISettings.Model.swift` so each file stays focused. The
//  input snapshot mirrors the web hook outputs (`useSettings` + `useAiUsageToday` +
//  the parent query lifecycle); the projection ports the surface's render gate plus
//  the P4 leaf contract (loading / empty / error / data). Everything here is pure and
//  unit tested in isolation.
//

import Foundation

// MARK: - Input snapshot (web hook outputs)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web
/// hook outputs: the persisted mode + cost cap (`useSettings`), today's spend
/// (`useAiUsageToday`), and the parent query lifecycle. `savedMode == nil` while
/// `isLoading == false` and no error means the settings payload was absent (the
/// empty branch); otherwise the form renders.
public struct AiSettingsInput: Sendable, Equatable {
    public var savedMode: AiMode?
    public var costCapCents: Int
    public var todayMicroCents: Double
    public var usageLoading: Bool
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: AiSettingsConnection

    public init(
        savedMode: AiMode? = nil,
        costCapCents: Int = 0,
        todayMicroCents: Double = 0,
        usageLoading: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: AiSettingsConnection = .live
    ) {
        self.savedMode = savedMode
        self.costCapCents = costCapCents
        self.todayMicroCents = todayMicroCents
        self.usageLoading = usageLoading
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready settings state — `phase` selects the body and the
/// persisted inputs are carried through so the view is a pure function of this value
/// plus the model's editable `selectedMode`.
public struct AiSettingsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let savedMode: AiMode
    public let costCapCents: Int
    public let todayMicroCents: Double
    public let usageLoading: Bool

    public init(
        phase: Phase,
        savedMode: AiMode,
        costCapCents: Int,
        todayMicroCents: Double,
        usageLoading: Bool
    ) {
        self.phase = phase
        self.savedMode = savedMode
        self.costCapCents = costCapCents
        self.todayMicroCents = todayMicroCents
        self.usageLoading = usageLoading
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the surface's render gate plus the P4 leaf contract. Unit tested across
/// loading / empty / error / data.
public enum AiSettingsProjection {
    public static func resolve(_ input: AiSettingsInput) -> AiSettingsResolved {
        let phase = phase(for: input)
        return AiSettingsResolved(
            phase: phase,
            savedMode: input.savedMode ?? .off,
            costCapCents: max(0, input.costCapCents),
            todayMicroCents: input.todayMicroCents,
            usageLoading: input.usageLoading
        )
    }

    private static func phase(for input: AiSettingsInput) -> AiSettingsResolved.Phase {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return .error(message)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return .loading
        }
        // Settings resolved with no payload → friendly empty state, never a blank box.
        if input.savedMode == nil {
            return .empty
        }
        return .data
    }
}
