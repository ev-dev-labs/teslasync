//
//  SafetyFeaturesWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0083 · SafetyFeaturesWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). The view binds through `SafetyModel`; no networking lives in the
//  view. This file owns the seams; the pure cached → cell projection lives in
//  SafetyFeaturesWidget.Adapter.swift.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))`, which is
/// consent-gated and redacted there.
public protocol SafetyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSafetyTelemetry: SafetyTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from the `useSafety` query.
public enum SafetyLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header chip + the stale/offline banner so cached values are clearly labeled.
public enum SafetyConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SafetySource`: the cached latest safety
/// snapshot plus its load/connection status. The model turns this into the cell
/// grid + the active-feature count.
public struct SafetyUpdate: Sendable, Equatable {
    public var status: SafetyLoadStatus
    public var connection: SafetyConnection
    public var latest: SafetyLatestInput?
    public var updatedAt: Date?

    public init(
        status: SafetyLoadStatus = .loading,
        connection: SafetyConnection = .live,
        latest: SafetyLatestInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.latest = latest
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `safety/latest` query store, keyed by the
/// selected vehicle — web `vehicleId ?? vehicles?.[0]?.id`); previews and tests
/// use `InMemorySafetySource`. The view never talks to the network.
@MainActor
public protocol SafetySource: AnyObject {
    var onUpdate: (@MainActor (SafetyUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SafetySource`, recomputes
/// the `SafetyStatusCell` grid projection + the active-feature count, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SafetyModel {
    /// The mutually-exclusive render branches (web shell loading / content / error
    /// + the empty state when the source resolves with no snapshot).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SafetyConnection = .live
    public private(set) var cells: [SafetyStatusCell] = []
    public private(set) var activeCount: Int = 0
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SafetySource
    @ObservationIgnored private let telemetry: any SafetyTelemetry
    @ObservationIgnored private var started = false

    public init(source: any SafetySource, telemetry: any SafetyTelemetry = OSLogSafetyTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SafetyFeaturesWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SafetyUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        cells = SafetyCellsBuilder.build(latest: update.latest, localize: SafetyStrings.string)
        activeCount = SafetyCellsBuilder.activeCount(cells)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web shows the shell skeleton only on the
    /// initial fetch, the "No safety data" empty state when there is no snapshot,
    /// and the grid/active-count whenever a snapshot is known (cached values stay
    /// visible behind refresh/errors, with the freshness chip reflecting
    /// staleness/failure).
    public static func resolvePhase(_ update: SafetyUpdate) -> Phase {
        let hasData = update.latest != nil
        switch update.status {
        case .loading:
            return hasData ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySafetySource: SafetySource {
    public var onUpdate: (@MainActor (SafetyUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SafetyUpdate?

    public init(initial: SafetyUpdate? = nil) {
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
    public func push(_ update: SafetyUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SafetyFeaturesWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SafetyStrings {
    public static let table = "SafetyFeaturesWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
