//
//  AchievementUnlockedToast.Model.swift
//  TeslaSync — P4 shared surface · 0111 · AchievementUnlockedToast (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the achievement-unlocked celebration toast. The view binds through
//  `AchievementUnlockedToastModel`; no networking lives in the view. The web data owner is
//  `useAchievementUnlocks` (an SSE-backed, newest-first, id-de-duped, 25-bounded queue + a
//  `dismiss(id)`); the native model keeps the same contract: a source emits coalesced snapshots of the
//  queue plus the feed's load / connectivity status, the model recomputes the resolved projection and
//  the render phase, forwards `dismiss(id)`, and auto-refreshes once when the feed goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol AchievementUnlockedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAchievementUnlockedTelemetry: AchievementUnlockedTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound unlock feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum AchievementUnlockedConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Load status (web TanStack `isLoading` / `isError`)

/// The load lifecycle for the unlock feed, mirroring the shared `LoadableState` cases the production
/// source projects from the SSE subscription's connection state.
public enum AchievementUnlockedLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

// MARK: - Input snapshot (coalesced source push)

/// One coalesced snapshot of the surface's inputs — the queued unlock events (the web
/// `useAchievementUnlocks` `recent`) plus the feed's load / connectivity lifecycle. The model
/// normalises the events (de-dupe + bound), derives the resolved projection over it, and tracks the
/// `connection` axis for the freshness chip.
public struct AchievementUnlockedUpdate: Sendable, Equatable {
    public var status: AchievementUnlockedLoadStatus
    public var connection: AchievementUnlockedConnection
    public var isFetching: Bool
    public var events: [AchievementUnlockedEventData]
    public var updatedAt: Date?

    public init(
        status: AchievementUnlockedLoadStatus = .loading,
        connection: AchievementUnlockedConnection = .live,
        isFetching: Bool = false,
        events: [AchievementUnlockedEventData] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.events = events
        self.updatedAt = updatedAt
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; `events` is the de-duped, bounded,
/// newest-first queue the stack renders one toast per. A pure value so the view is a function of it and
/// snapshot tests assert it directly.
public struct AchievementUnlockedResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let events: [AchievementUnlockedEventData]

    public init(phase: Phase, events: [AchievementUnlockedEventData]) {
        self.phase = phase
        self.events = events
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the coalesced snapshot to the resolved view-state — the native port of the web
/// surface's control flow plus the P4 leaf contract: a feed failure surfaces as `error` (unless cached
/// toasts are still present, which stay visible behind a transient failure); the initial fetch with no
/// toasts is `loading`; an idle, connected feed with no toasts is the friendly `empty` (the native
/// improvement over the web stack rendering nothing); any queued unlock renders the `data` stack.
/// Unit tested across every branch.
public enum AchievementUnlockedProjection {
    public static func resolve(
        status: AchievementUnlockedLoadStatus,
        events: [AchievementUnlockedEventData],
        connection _: AchievementUnlockedConnection
    ) -> AchievementUnlockedResolved {
        let queue = AchievementUnlockedQueue.normalize(events)
        let hasToasts = !queue.isEmpty

        switch status {
        case .loading:
            return AchievementUnlockedResolved(phase: hasToasts ? .data : .loading, events: queue)
        case .empty:
            return AchievementUnlockedResolved(phase: hasToasts ? .data : .empty, events: queue)
        case .loaded:
            return AchievementUnlockedResolved(phase: hasToasts ? .data : .empty, events: queue)
        case let .failed(message):
            return AchievementUnlockedResolved(phase: hasToasts ? .data : .error(message), events: queue)
        }
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `AchievementUnlockedSource`, recomputes the
/// resolved projection + render `phase`, exposes the `connection` axis, forwards `dismiss(id)` (web
/// `useAchievementUnlocks.dismiss`), and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class AchievementUnlockedToastModel {
    public private(set) var resolved = AchievementUnlockedResolved(phase: .loading, events: [])
    public private(set) var connection: AchievementUnlockedConnection = .live
    public private(set) var isFetching = false
    public private(set) var updatedAt: Date?

    public var phase: AchievementUnlockedResolved.Phase {
        resolved.phase
    }

    /// The de-duped, bounded, newest-first queue the stack renders one toast per.
    public var events: [AchievementUnlockedEventData] {
        resolved.events
    }

    @ObservationIgnored private let source: any AchievementUnlockedSource
    @ObservationIgnored private let telemetry: any AchievementUnlockedTelemetry
    @ObservationIgnored private let onView: (@MainActor (AchievementUnlockedEventData) -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastConnection: AchievementUnlockedConnection = .live

    public init(
        source: any AchievementUnlockedSource,
        telemetry: any AchievementUnlockedTelemetry = OSLogAchievementUnlockedTelemetry(),
        onView: (@MainActor (AchievementUnlockedEventData) -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onView = onView
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AchievementUnlockedToastStack.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the feed has gone stale but is not already fetching — the native parity of
    /// the web freshness self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    /// Dismisses the toast for an unlock — the web `useAchievementUnlocks.dismiss(achievementId)`.
    /// Removes it from the queue immediately so a re-render does not re-show an acknowledged unlock,
    /// then notifies the source so the upstream owner drops it too.
    public func dismiss(id: String) {
        let next = AchievementUnlockedQueue.removing(id: id, from: resolved.events)
        resolved = AchievementUnlockedProjection.resolve(
            status: .loaded,
            events: next,
            connection: connection
        )
        source.dismiss(id: id)
    }

    /// Invokes the parent's navigation handler for an unlock's "View" affordance (web `handleView`:
    /// dismiss then navigate). Dismisses first so the celebrated toast clears, then hands the embedder
    /// the event to route to `/lifetime?achievement=<id>`.
    public func view(_ event: AchievementUnlockedEventData) {
        dismiss(id: event.id)
        onView?(event)
    }

    private func apply(_ update: AchievementUnlockedUpdate) {
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        resolved = AchievementUnlockedProjection.resolve(
            status: update.status,
            events: update.events,
            connection: update.connection
        )
        let previous = lastConnection
        connection = update.connection
        lastConnection = update.connection
        if update.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "AchievementUnlockedToast" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum AchievementUnlockedStrings {
    public static let table = "AchievementUnlockedToast"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
