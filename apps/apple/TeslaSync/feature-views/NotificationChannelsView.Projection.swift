//
//  NotificationChannelsView.Projection.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  The pure render-state projection for NotificationChannelsView: the connectivity
//  axis, the transient toast value (web `useToast`), the coalesced input snapshot (the
//  native mirror of the `useNotificationChannels` + `useNotificationStats` query state),
//  and the resolved view-state the SwiftUI body switches over. No SwiftUI, no I/O — the
//  view is a pure function of `NotifChannelsResolved`, so every branch is unit tested.
//
//  The web component renders the stats row (or skeletons) and the channels grid
//  independently: the grid shows skeletons while loading, the cards when loaded, and a
//  friendly empty state when resolved-but-empty. On top of those web branches this
//  surface honours the P4 leaf contract — a `phase` (loading / empty / error / data)
//  and an orthogonal `connection` axis (live / stale / offline) surfaced as a freshness
//  chip + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum NotifChannelsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Toast (web `useToast`)

/// The tone of a transient toast — the port of the web `toast.success` / `toast.error`.
public enum NotifToastTone: Sendable, Equatable {
    case success
    case danger
}

/// One transient toast — the native counterpart of the web `useToast()` feedback. The
/// model publishes the latest toast; the view renders it and clears it after a delay.
public struct NotifToast: Sendable, Equatable, Identifiable {
    public let id: UUID
    public let tone: NotifToastTone
    public let message: String

    public init(tone: NotifToastTone, message: String, id: UUID = UUID()) {
        self.tone = tone
        self.message = message
        self.id = id
    }
}

// MARK: - Input snapshot (web `useNotificationChannels` + `useNotificationStats`)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web hooks'
/// query state (`channels`, `stats`, `isLoading`) plus the P4 leaf lifecycle (an error
/// message and the connectivity axis). `channels == nil` means "not loaded yet"; an
/// empty array means "loaded, no channels".
public struct NotifChannelsInput: Sendable, Equatable {
    public var channels: [NotificationChannelData]?
    public var stats: NotifChannelStats?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: NotifChannelsConnection

    public init(
        channels: [NotificationChannelData]? = nil,
        stats: NotifChannelStats? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: NotifChannelsConnection = .live
    ) {
        self.channels = channels
        self.stats = stats
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the channels grid body; `stats`
/// renders independently (skeleton when `nil`, web `stats ? … : skeletons`).
public struct NotifChannelsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let channels: [NotificationChannelData]
    public let stats: NotifChannelStats?

    public init(phase: Phase, channels: [NotificationChannelData], stats: NotifChannelStats?) {
        self.phase = phase
        self.channels = channels
        self.stats = stats
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web component's render branches plus the P4 leaf contract. Unit tested across
/// loading / empty / error / data and the stats-skeleton branch.
public enum NotifChannelsProjection {
    public static func resolve(_ input: NotifChannelsInput) -> NotifChannelsResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return NotifChannelsResolved(phase: .error(message), channels: input.channels ?? [], stats: input.stats)
        }
        // Initial fetch (web `isLoading`) or no snapshot yet — the grid shows skeletons.
        guard !input.isLoading, let channels = input.channels else {
            return NotifChannelsResolved(phase: .loading, channels: [], stats: input.stats)
        }
        // Web `!isLoading && channels.length === 0` → friendly empty state.
        let phase: NotifChannelsResolved.Phase = channels.isEmpty ? .empty : .data
        return NotifChannelsResolved(phase: phase, channels: channels, stats: input.stats)
    }
}
