//
//  AcDcStatsPanel.Model.swift
//  TeslaSync — P4 feature view · 0096 · AcDcStatsPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the AC-vs-DC charging stats panel. The view binds through
//  `AcDcStatsModel`; no networking lives in the view. The web source
//  (AcDcStatsPanel.tsx) is a pure presentational leaf fed a computed `breakdown`
//  prop by its parent (the Charging page), so the input snapshot here carries that
//  breakdown (plus the parent's loading / error / connectivity state) rather than
//  issuing HTTP itself.
//
//  States: the web leaf's own branches are data-driven (the energy-split segments,
//  the count-filtered rows, the free-charging footer) plus the empty render the web
//  `DataTable` shows when no type has sessions. On top of those, this surface honours
//  the P4 leaf contract (the same one FlagsTable/0031 ships): a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness chip
//  + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol AcDcStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogAcDcStatsTelemetry: AcDcStatsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum AcDcConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the Charging page)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// props (`breakdown`) plus the parent surface's lifecycle (`isLoading`, an error
/// message, and connectivity). The breakdown's values are unit-free numbers carried
/// verbatim from upstream, so no SI conversion applies at this layer.
public struct AcDcStatsInput: Sendable, Equatable {
    public var breakdown: AcDcBreakdown?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: AcDcConnection

    public init(
        breakdown: AcDcBreakdown? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: AcDcConnection = .live
    ) {
        self.breakdown = breakdown
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render
/// branches. `phase` selects the body; the split fractions, segment flags, rows, and
/// free-footer flag are pre-computed so the view is a pure function of this value.
public struct AcDcStatsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let breakdown: AcDcBreakdown
    public let rows: [AcDcTableRow]
    public let acFraction: Double
    public let dcFraction: Double
    public let showACSegment: Bool
    public let showDCSegment: Bool
    public let showFreeFooter: Bool

    public init(
        phase: Phase,
        breakdown: AcDcBreakdown,
        rows: [AcDcTableRow],
        acFraction: Double,
        dcFraction: Double,
        showACSegment: Bool,
        showDCSegment: Bool,
        showFreeFooter: Bool
    ) {
        self.phase = phase
        self.breakdown = breakdown
        self.rows = rows
        self.acFraction = acFraction
        self.dcFraction = dcFraction
        self.showACSegment = showACSegment
        self.showDCSegment = showDCSegment
        self.showFreeFooter = showFreeFooter
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit
/// tested across loading / empty / error / data and the segment / footer flags.
public enum AcDcStatsProjection {
    private static let emptyBreakdown = AcDcBreakdown(
        ac: AcDcBucket(),
        dc: AcDcBucket(),
        total: AcDcBreakdownTotal()
    )

    public static func resolve(_ input: AcDcStatsInput) -> AcDcStatsResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return resolved(.error(message), breakdown: input.breakdown ?? emptyBreakdown, rows: [])
        }
        // Initial fetch (web parent `isLoading`) or no snapshot yet.
        guard !input.isLoading, let breakdown = input.breakdown else {
            return resolved(.loading, breakdown: input.breakdown ?? emptyBreakdown, rows: [])
        }
        let rows = AcDcRows.rows(for: breakdown)
        // Web `DataTable` empty render: no charge type has any session.
        guard !rows.isEmpty else {
            return resolved(.empty, breakdown: breakdown, rows: [])
        }
        return resolved(.data, breakdown: breakdown, rows: rows)
    }

    private static func resolved(
        _ phase: AcDcStatsResolved.Phase,
        breakdown: AcDcBreakdown,
        rows: [AcDcTableRow]
    ) -> AcDcStatsResolved {
        let split = AcDcSplit.fractions(
            ac: breakdown.ac.energy,
            dc: breakdown.dc.energy,
            total: breakdown.total.energy
        )
        return AcDcStatsResolved(
            phase: phase,
            breakdown: breakdown,
            rows: rows,
            acFraction: split.ac,
            dcFraction: split.dc,
            showACSegment: breakdown.ac.energy > 0,
            showDCSegment: breakdown.dc.energy > 0,
            showFreeFooter: breakdown.total.freeCount > 0
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// Charging page's resolved charging-stats query; previews and tests use
/// `InMemoryAcDcStatsSource`. The view never talks to the network directly.
@MainActor
public protocol AcDcStatsSource: AnyObject {
    var onUpdate: (@MainActor (AcDcStatsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to an `AcDcStatsSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and
/// the `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class AcDcStatsModel {
    public private(set) var resolved: AcDcStatsResolved = AcDcStatsProjection.resolve(AcDcStatsInput(isLoading: true))
    public private(set) var connection: AcDcConnection = .live

    public var phase: AcDcStatsResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any AcDcStatsSource
    @ObservationIgnored private let telemetry: any AcDcStatsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any AcDcStatsSource,
        telemetry: any AcDcStatsTelemetry = OSLogAcDcStatsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AcDcStatsPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: AcDcStatsInput) {
        resolved = AcDcStatsProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryAcDcStatsSource: AcDcStatsSource {
    public var onUpdate: (@MainActor (AcDcStatsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AcDcStatsInput?

    public init(initial: AcDcStatsInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: AcDcStatsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "AcDcStatsPanel" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum AcDcStrings {
    public static let table = "AcDcStatsPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
