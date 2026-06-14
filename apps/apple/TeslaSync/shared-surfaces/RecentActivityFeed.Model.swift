//
//  RecentActivityFeed.Model.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the RecentActivityFeed shared surface. The view binds through
//  `RecentActivityFeedModel`; no networking lives in the view. A source emits the coalesced inputs (the
//  controlled audit-log entries — the web props — the feed freshness, plus the parent's loading / error
//  state); the model derives the resolved view-state over them, exposes a render `phase` + the resolved
//  rows + the `connection` axis, forwards the host's click-through handler (web `<Link>` navigation),
//  and auto-refreshes once when the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 slug)

/// The diagnostics surface slug, kept here (free of SwiftUI) so the state-holder + telemetry seam are
/// verifiable without the view layer. `RecentActivityFeed.surfaceSlug` re-exports it for callers.
public enum RecentActivityFeedSurface {
    public static let slug = "RecentActivityFeed"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol RecentActivityFeedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogRecentActivityFeedTelemetry: RecentActivityFeedTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 connectivity axis)

/// The freshness of the feed the entries are read over — the native mirror of the live / stale /
/// offline axis. `live` shows neither the chip nor a stale auto-refresh; `stale` / `offline` surface the
/// freshness chip beneath the feed (the entries may be out of date) without hiding the surface.
public enum RecentActivityFeedConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (controlled entries + connectivity + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled audit-log `entries` (the web props),
/// the optional `emptyMessage` override (web `emptyMessage` prop), the feed freshness, plus the parent's
/// lifecycle (`isLoading`, an error message). The view-state is derived purely from this.
public struct RecentActivityFeedInput: Sendable, Equatable {
    public var entries: [RecentActivityFeedEntry]
    public var emptyMessage: String?
    public var connection: RecentActivityFeedConnection
    public var isLoading: Bool
    public var errorMessage: String?

    public init(
        entries: [RecentActivityFeedEntry] = [],
        emptyMessage: String? = nil,
        connection: RecentActivityFeedConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.entries = entries
        self.emptyMessage = emptyMessage
        self.connection = connection
        self.isLoading = isLoading
        self.errorMessage = errorMessage
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; for the `.content` phase the projected
/// `rows` are pre-computed so the view is a pure function of this value.
public struct RecentActivityFeedResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public let phase: Phase
    public let rows: [RecentActivityFeedRow]

    public init(phase: Phase, rows: [RecentActivityFeedRow]) {
        self.phase = phase
        self.rows = rows
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

/// Pure projection from the input snapshot (+ the render `now`) to the resolved view-state. The branch
/// priority is: a feed failure (`error`) → the initial fetch (`loading`) → the populated feed
/// (`content`, the web `Timeline`) → the friendly empty state (web `entries.length === 0`). The
/// connectivity axis does not gate the feed — it surfaces as the freshness chip beside it. Unit tested
/// across every branch.
public enum RecentActivityFeedProjection {
    public static func resolve(input: RecentActivityFeedInput, now: Date) -> RecentActivityFeedResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return RecentActivityFeedResolved(phase: .error(message), rows: [])
        }
        if input.isLoading {
            return RecentActivityFeedResolved(phase: .loading, rows: [])
        }
        if input.entries.isEmpty {
            return RecentActivityFeedResolved(phase: .empty, rows: [])
        }
        let rows = RecentActivityFeedAdapter.rows(for: input.entries, now: now)
        return RecentActivityFeedResolved(phase: .content, rows: rows)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `RecentActivityFeedSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved rows + the `connection` axis + the
/// `emptyMessage` override, forwards the host click-through handler (web `<Link>`), and auto-refreshes
/// once when the feed transitions to stale. No networking lives here — the data is owned upstream.
@MainActor
@Observable
public final class RecentActivityFeedModel {
    public private(set) var resolved = RecentActivityFeedResolved(phase: .loading, rows: [])
    public private(set) var connection: RecentActivityFeedConnection = .live
    public private(set) var emptyMessage: String?

    public var phase: RecentActivityFeedResolved.Phase {
        resolved.phase
    }

    public var rows: [RecentActivityFeedRow] {
        resolved.rows
    }

    /// Whether the host wired a click-through handler (web `<Link>` navigation). Gates whether a row's
    /// title renders as a tappable link.
    public let canNavigate: Bool

    @ObservationIgnored private let source: any RecentActivityFeedSource
    @ObservationIgnored private let telemetry: any RecentActivityFeedTelemetry
    @ObservationIgnored private let onNavigate: (@MainActor (String) -> Void)?
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any RecentActivityFeedSource,
        telemetry: any RecentActivityFeedTelemetry = OSLogRecentActivityFeedTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() },
        onNavigate: (@MainActor (String) -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        self.onNavigate = onNavigate
        canNavigate = onNavigate != nil
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RecentActivityFeedSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed. Re-arms the one-shot `view.opened` for the next `start`.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Invokes the host's click-through handler (web `<Link to={href}>`) — a no-op when none supplied.
    public func navigate(to route: String) {
        onNavigate?(route)
    }

    private func apply(_ input: RecentActivityFeedInput) {
        resolved = RecentActivityFeedProjection.resolve(input: input, now: now())
        emptyMessage = input.emptyMessage
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "RecentActivityFeed" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings. The
/// action labels + the empty-state copy reuse the web source's own keys (`activity.action.*`,
/// `activity.myActivity.empty`).
public enum RecentActivityFeedStrings {
    public static let table = "RecentActivityFeed"

    public static let string: RecentActivityFeedResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
