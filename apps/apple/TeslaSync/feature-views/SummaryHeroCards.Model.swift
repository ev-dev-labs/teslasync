//
//  SummaryHeroCards.Model.swift
//  TeslaSync — P4 feature view · 0077 · SummaryHeroCards (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) for the weekly-digest
//  "Week Summary" surface. The view binds through `SummaryHeroCardsModel` and never
//  performs networking itself: the digest snapshot + connectivity flow through an
//  injected `SummaryHeroSource` (the production app wires it to the weekly-digest
//  query; previews/tests use `InMemorySummaryHeroSource`).
//
//  The web `SummaryHeroCards` is a presentational child of `WeeklyDigestPage`; the
//  page owns loading / error / empty (`isLoading → DigestSkeleton`,
//  `error → PageContainer`, `!hasData → EmptyState`). This native surface absorbs
//  that owner state so every required state (loading / empty / error / stale /
//  offline / loaded) renders here, mirroring the established widget connection model.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the surface-open product-analytics event. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted there).
public protocol SummaryHeroTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSummaryHeroTelemetry: SummaryHeroTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity / freshness (native chrome for the required states)

/// Digest reachability + freshness, mirroring `LiveConnectionState` (ADR-013).
/// `online` = fresh; `stale` = reachable but older than the freshness window
/// (auto-refresh nudge); `offline` = unreachable (the last summary stays visible
/// behind an offline chip).
public enum SummaryHeroConnection: Sendable, Equatable {
    case online
    case stale
    case offline
}

/// Freshness policy: a summary older than `window` is "stale".
public enum SummaryHeroFreshness {
    /// Default freshness window (the weekly digest is recomputed on demand; 60s is a
    /// sensible "this snapshot may be out of date, re-pull" threshold).
    public static let window: TimeInterval = 60

    public static func isStale(updatedAt: Date?, now: Date, window: TimeInterval = window) -> Bool {
        guard let updatedAt else { return false }
        return now.timeIntervalSince(updatedAt) > window
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// One coalesced digest snapshot pushed by a source. `summary == nil && !failed`
/// is the empty state (no activity this week, web `!hasData`); `failed` is the
/// query-error state (the last `summary`, if any, stays visible behind a retry).
public struct SummaryHeroUpdate: Sendable, Equatable {
    public var summary: DigestSummary?
    public var connection: SummaryHeroConnection
    public var failed: Bool
    public var updatedAt: Date?

    public init(
        summary: DigestSummary?,
        connection: SummaryHeroConnection = .online,
        failed: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.summary = summary
        self.connection = connection
        self.failed = failed
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// weekly-digest query + the shared connectivity store; previews/tests use
/// `InMemorySummaryHeroSource`. The view never talks to the network directly.
@MainActor
public protocol SummaryHeroSource: AnyObject {
    /// Pushes digest snapshots + connectivity/freshness changes.
    var onUpdate: (@MainActor (SummaryHeroUpdate) -> Void)? { get set }
    /// Begins observing the digest feed.
    func start()
    /// Stops observing.
    func stop()
    /// Re-pulls the digest (wired to the surface refresh affordance).
    func refresh()
}

// MARK: - Surface view-model (P1/S8 state holder)

/// The surface view-model. Owns the render phase + freshness chip, subscribes to a
/// `SummaryHeroSource`, and projects the bound summary into the hero-card grid.
/// `@Observable` so SwiftUI tracks fine-grained changes.
@MainActor
@Observable
public final class SummaryHeroCardsModel {
    /// Surface render phase. `loaded`/`empty`/`failed` are overlaid with the
    /// `connection` freshness so the grid stays visible (with an offline/stale chip)
    /// while degraded, exactly like the cache-then-network `Resource` contract.
    public enum Phase: Sendable, Equatable {
        case loading
        case loaded
        case empty
        case failed
    }

    public private(set) var phase: Phase = .loading
    public private(set) var summary: DigestSummary?
    public private(set) var connection: SummaryHeroConnection = .online
    public private(set) var updatedAt: Date?

    /// Display formatting (currency symbol / precision / locale), bound from user
    /// settings in the production app (web `useFormatting`).
    public var formatting: SummaryHeroFormatting

    /// Whether the digest feed is currently unreachable (offline chip + banner; the
    /// last summary stays visible).
    public var isOffline: Bool {
        connection == .offline
    }

    /// Whether the visible summary is older than the freshness window (stale chip).
    public var isStale: Bool {
        connection == .stale
    }

    /// Whether a previously-loaded summary is available to keep on screen.
    public var hasCachedSummary: Bool {
        summary != nil
    }

    /// The projected hero-card grid for the current summary (empty when none).
    public var items: [HighlightItem] {
        guard let summary else { return [] }
        return SummaryHeroProjection.items(from: summary, formatting: formatting)
    }

    @ObservationIgnored private let source: any SummaryHeroSource
    @ObservationIgnored private let telemetry: any SummaryHeroTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SummaryHeroSource,
        telemetry: any SummaryHeroTelemetry = OSLogSummaryHeroTelemetry(),
        formatting: SummaryHeroFormatting = .standard
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SummaryHeroCards.surfaceSlug)
        source.start()
    }

    /// Stops observing the digest feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-pulls the digest (wired to the surface freshness chip / error retry).
    public func refresh() {
        source.refresh()
    }

    /// Applies a pushed snapshot. Exposed so previews/tests drive states directly.
    public func apply(_ update: SummaryHeroUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt

        if update.failed {
            if let resolved = update.summary { summary = resolved }
            phase = .failed
            return
        }
        if let resolved = update.summary {
            summary = resolved
            phase = .loaded
        } else {
            summary = nil
            phase = .empty
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory `SummaryHeroSource` for previews + unit/UI tests. Emits an optional
/// initial snapshot on `start`, lets tests drive states with `push(_:)`, and
/// re-emits a (optionally distinct) snapshot on `refresh`.
@MainActor
public final class InMemorySummaryHeroSource: SummaryHeroSource {
    public var onUpdate: (@MainActor (SummaryHeroUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SummaryHeroUpdate?
    private let refreshResult: SummaryHeroUpdate?

    public init(initial: SummaryHeroUpdate? = nil, refreshResult: SummaryHeroUpdate? = nil) {
        self.initial = initial
        self.refreshResult = refreshResult
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
        if let update = refreshResult ?? initial { onUpdate?(update) }
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: SummaryHeroUpdate) {
        onUpdate?(update)
    }
}
