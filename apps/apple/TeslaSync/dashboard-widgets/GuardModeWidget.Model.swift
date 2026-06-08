//
//  GuardModeWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0054 · GuardModeWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). The view binds through `GuardModel`; no networking lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol GuardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogGuardTelemetry: GuardTelemetry {
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
/// cases the production source projects from the guard `Resource<T>` queries.
public enum GuardLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum GuardConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// Cached guard config inputs (web `GuardConfig`). Nullable `sensitivity` mirrors
/// the web `config?.sensitivity ?? '—'` fallback handled in the projection.
public struct GuardConfigInput: Sendable, Equatable {
    public var enabled: Bool
    public var sensitivity: String?
    public var autoPanic: Bool

    public init(enabled: Bool, sensitivity: String? = nil, autoPanic: Bool = false) {
        self.enabled = enabled
        self.sensitivity = sensitivity
        self.autoPanic = autoPanic
    }
}

/// One cached guard event (web `GuardEvent`). `acknowledgedAt == nil` is the
/// derived "unacknowledged" state (web `isGuardEventAcknowledged`).
public struct GuardEventInput: Sendable, Equatable, Identifiable {
    public var id: Int64
    public var eventType: String
    public var timestamp: Date
    public var acknowledgedAt: Date?

    public init(id: Int64, eventType: String, timestamp: Date, acknowledgedAt: Date? = nil) {
        self.id = id
        self.eventType = eventType
        self.timestamp = timestamp
        self.acknowledgedAt = acknowledgedAt
    }
}

/// One coalesced snapshot pushed by a `GuardSource`: the cached config + events
/// plus their load/connection status. The model turns this into the projection.
public struct GuardUpdate: Sendable, Equatable {
    public var status: GuardLoadStatus
    public var connection: GuardConnection
    public var config: GuardConfigInput?
    public var events: [GuardEventInput]
    public var updatedAt: Date?

    public init(
        status: GuardLoadStatus = .loading,
        connection: GuardConnection = .live,
        config: GuardConfigInput? = nil,
        events: [GuardEventInput] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.config = config
        self.events = events
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the guard config + events stores); previews and
/// tests use `InMemoryGuardSource`. The view never talks to the network directly.
@MainActor
public protocol GuardSource: AnyObject {
    var onUpdate: (@MainActor (GuardUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `GuardSource`, recomputes
/// the `GuardStatus` + `GuardFeedItem` projections, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class GuardModel {
    /// The mutually-exclusive render branches (web shell loading / content / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: GuardConnection = .live
    public private(set) var status: GuardStatus = .empty
    public private(set) var feedItems: [GuardFeedItem] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any GuardSource
    @ObservationIgnored private let telemetry: any GuardTelemetry
    @ObservationIgnored private var started = false

    public init(source: any GuardSource, telemetry: any GuardTelemetry = OSLogGuardTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GuardModeWidget.surfaceSlug)
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

    private func apply(_ update: GuardUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        status = GuardStatus.project(config: update.config, eventCount: update.events.count)
        feedItems = GuardFeedBuilder.build(events: update.events, localize: GuardStrings.string)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the "No guard data" empty state when there is no config; whenever
    /// a config is known the widget renders (cached values stay visible behind
    /// refresh/errors, with the freshness chip reflecting staleness/failure).
    public static func resolvePhase(_ update: GuardUpdate) -> Phase {
        let hasConfig = update.config != nil
        switch update.status {
        case .loading:
            return hasConfig ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasConfig ? .content : .empty
        case let .failed(message):
            return hasConfig ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryGuardSource: GuardSource {
    public var onUpdate: (@MainActor (GuardUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GuardUpdate?

    public init(initial: GuardUpdate? = nil) {
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
    public func push(_ update: GuardUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "GuardModeWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum GuardStrings {
    public static let table = "GuardModeWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
