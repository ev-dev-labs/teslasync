//
//  RecentlyViewedWidget.Model.swift
//  TeslaSync — P4 feature view · 0131 · RecentlyViewedWidget (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the dashboard "Recently Viewed" widget. The view binds through `RecentlyViewedModel`;
//  no store access lives in the view.
//
//  The web source (RecentlyViewedWidget.tsx) reads the client-side `recentPages` store via
//  `useRecentPages` (a synchronous, subscribe-on-change local store) and renders either the
//  empty hint or the entry list. The native source carries that same snapshot — the recents
//  plus an `isLoading` (pre-first-read), an optional `errorMessage` (a corrupt persisted
//  store), and a `freshness` (the P4 states contract's stale / offline chrome over an
//  offline-first local store, where the cached recents always stay visible). The projection
//  is the same one the web render performs.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept here (not on the
/// SwiftUI view) so the model + tests reference it without importing SwiftUI.
public enum RecentlyViewedDiagnostics {
    public static let surface = "RecentlyViewedWidget"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core
/// `Telemetry.track(.screenView(screen:…))`, which is consent-gated and redacted there.
public protocol RecentlyViewedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event. The
/// slug is a static, non-identifying constant; no path, title, or id is ever recorded.
public struct OSLogRecentlyViewedTelemetry: RecentlyViewedTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "RecentlyViewedWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time so each parallel surface owns its own
/// strings without editing the shared catalog.
public enum RecentlyViewedStrings {
    public static let table = "RecentlyViewedWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Freshness (the P4 states contract over an offline-first local store)

/// The cached-recents freshness state. The web store is synchronous + offline-first, so it
/// has no connection concept; these are the native P4 states-contract overlays. `stale`
/// shows a refreshing chip + triggers one auto-refresh; `offline` shows an offline chip; in
/// both cases the cached recents stay fully visible (never hidden).
public enum RecentlyViewedFreshness: Sendable, Equatable {
    case fresh
    case stale
    case offline
}

// MARK: - Render phase (web empty / list + native loading / error)

/// The mutually-exclusive render branches for the body — the native mirror of the web
/// `entries.length === 0 ? <hint> : <list>` choice, with the native loading skeleton (before
/// the first store read) and the error branch (a corrupt persisted store) the P4 states
/// contract requires.
public enum RecentlyViewedPhase: Sendable, Equatable {
    case loading
    case data
    case empty
    case error(String)
}

// MARK: - Input snapshot (web store read + native chrome inputs)

/// One coalesced snapshot of the widget's inputs — the web `useRecentPages` result (the
/// `entries`) plus the native chrome inputs: `isLoading` (pre-first-read skeleton),
/// `errorMessage` (a failed / corrupt store read), `freshness`, the display `limit` (web
/// `RECENT_PAGES_DISPLAY_LIMIT`, overridable like the web `limit` prop), and an `updatedAt`.
public struct RecentlyViewedInput: Sendable, Equatable {
    public var entries: [RecentlyViewedEntry]
    public var isLoading: Bool
    public var errorMessage: String?
    public var freshness: RecentlyViewedFreshness
    public var limit: Int
    public var updatedAt: Date?

    public init(
        entries: [RecentlyViewedEntry] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        freshness: RecentlyViewedFreshness = .fresh,
        limit: Int = RecentlyViewedAdapter.defaultLimit,
        updatedAt: Date? = nil
    ) {
        self.entries = entries
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.freshness = freshness
        self.limit = limit
        self.updatedAt = updatedAt
    }
}

// MARK: - Resolved render state (the web render branches)

/// The resolved, view-ready state — the body `phase`, the projected rows (rendered whenever
/// there are any, independent of the loading/error branch so cached recents stay visible
/// while refreshing), and the `freshness` overlay.
public struct RecentlyViewedResolved: Sendable, Equatable {
    public let phase: RecentlyViewedPhase
    public let rows: [RecentlyViewedRow]
    public let freshness: RecentlyViewedFreshness

    public init(
        phase: RecentlyViewedPhase,
        rows: [RecentlyViewedRow],
        freshness: RecentlyViewedFreshness
    ) {
        self.phase = phase
        self.rows = rows
        self.freshness = freshness
    }
}

/// Pure projection from the input snapshot to the resolved view-state. The body `phase`
/// follows the web `entries.length ? list : hint` choice with the native `loading` (takes
/// precedence) and `error` (a non-empty `errorMessage` when not loading) branches slotted in.
/// The `freshness` overlay is projected independently. Unit-tested across every branch.
public enum RecentlyViewedProjection {
    public static func resolve(_ input: RecentlyViewedInput) -> RecentlyViewedResolved {
        let rows = RecentlyViewedAdapter.rows(from: input.entries, limit: input.limit)
        let phase: RecentlyViewedPhase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else {
            rows.isEmpty ? .empty : .data
        }
        return RecentlyViewedResolved(phase: phase, rows: rows, freshness: input.freshness)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the App-Group
/// recents store (the native analogue of the web `recentPages` local store), pushing a fresh
/// snapshot whenever the store changes (web `subscribeRecentPages`); previews + tests use
/// `InMemoryRecentlyViewedSource`. The view never reads the store directly.
@MainActor
public protocol RecentlyViewedSource: AnyObject {
    var onUpdate: (@MainActor (RecentlyViewedInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `RecentlyViewedSource`, recomputes the
/// resolved projection, and exposes a render `phase` + the rows + the freshness overlay for
/// SwiftUI to switch over. Emits the `view.opened` diagnostics event once on first start.
@MainActor
@Observable
public final class RecentlyViewedModel {
    public private(set) var phase: RecentlyViewedPhase = .loading
    public private(set) var rows: [RecentlyViewedRow] = []
    public private(set) var freshness: RecentlyViewedFreshness = .fresh
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any RecentlyViewedSource
    @ObservationIgnored private let telemetry: any RecentlyViewedTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any RecentlyViewedSource,
        telemetry: any RecentlyViewedTelemetry = OSLogRecentlyViewedTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RecentlyViewedDiagnostics.surface)
        source.start()
    }

    /// Stops observing the upstream store.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-reads the recents (wired to the error-state retry + the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: RecentlyViewedInput) {
        let resolved = RecentlyViewedProjection.resolve(input)
        phase = resolved.phase
        rows = resolved.rows
        freshness = resolved.freshness
        updatedAt = input.updatedAt
        handleAutoRefresh(for: resolved.freshness)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// fresh again so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for freshness: RecentlyViewedFreshness) {
        switch freshness {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .fresh:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory source (previews + unit/UI tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryRecentlyViewedSource: RecentlyViewedSource {
    public var onUpdate: (@MainActor (RecentlyViewedInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RecentlyViewedInput?

    public init(initial: RecentlyViewedInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: RecentlyViewedInput) {
        onUpdate?(input)
    }
}
