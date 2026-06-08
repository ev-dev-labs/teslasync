//
//  SentryEventLogWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0086 · SentryEventLogWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). The view binds through `SentryModel`; no networking lives in the view.
//
//  SwiftUI parity of features/dashboard/widgets/SentryEventLogWidget.tsx — the
//  composable "Sentry Event Log" security surface that lists recent security
//  snapshots (door / sentry / lock transitions) newest-first.
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
public protocol SentryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSentryTelemetry: SentryTelemetry {
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
/// cases the production source projects from the `useQuery` security-events query.
public enum SentryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip + the cached-data banner (web `DataFreshness` indicator).
public enum SentryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One cached security snapshot (web `SecurityEvent`). Only the fields the web
/// `SentryEventLogWidget` reads are modeled; the production source projects these
/// from the shared security-events store. `doorState` carries the raw vehicle
/// token list (web `door_state`); `nil`/empty means "no open doors".
public struct SentryEventInput: Sendable, Equatable {
    public var id: Int64?
    public var vehicleID: Int64
    public var timestamp: Date
    public var createdAt: Date?
    public var doorState: String?
    public var sentryMode: Bool?
    public var locked: Bool?

    public init(
        id: Int64? = nil,
        vehicleID: Int64,
        timestamp: Date,
        createdAt: Date? = nil,
        doorState: String? = nil,
        sentryMode: Bool? = nil,
        locked: Bool? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.timestamp = timestamp
        self.createdAt = createdAt
        self.doorState = doorState
        self.sentryMode = sentryMode
        self.locked = locked
    }

    /// Web `ev.created_at ?? ev.ts` — the timestamp the feed sorts + renders on.
    public var displayTimestamp: Date {
        createdAt ?? timestamp
    }

    /// Web `ev.id ?? \`${ev.vehicle_id}-${ev.ts}\`` — stable feed-row identity.
    public var stableID: String {
        if let id { return String(id) }
        return "\(vehicleID)-\(Int(timestamp.timeIntervalSince1970))"
    }
}

/// One coalesced snapshot pushed by a `SentrySource`: the cached events plus their
/// load/connection status. The model turns this into the feed projection.
public struct SentryUpdate: Sendable, Equatable {
    public var status: SentryLoadStatus
    public var connection: SentryConnection
    public var events: [SentryEventInput]
    public var updatedAt: Date?

    public init(
        status: SentryLoadStatus = .loading,
        connection: SentryConnection = .live,
        events: [SentryEventInput] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.events = events
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the vehicles store (web `useVehicles`,
/// `id = vehicleId ?? vehicles[0].id`) with the security-events query (web
/// `useQuery('/security?vehicle_id=&limit=')`). Previews + tests use
/// `InMemorySentrySource`. The view never talks to the network directly.
@MainActor
public protocol SentrySource: AnyObject {
    var onUpdate: (@MainActor (SentryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SentrySource`, recomputes
/// the `SentryFeedItem` projection, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over. Size-agnostic: the view applies the size-derived event
/// limit + subtitle visibility (web `eventLimit` / `isWide`) via `SentryLayout`.
@MainActor
@Observable
public final class SentryModel {
    /// The mutually-exclusive render branches (web shell loading / content / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SentryConnection = .live
    public private(set) var feedItems: [SentryFeedItem] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SentrySource
    @ObservationIgnored private let telemetry: any SentryTelemetry
    @ObservationIgnored private var started = false

    public init(source: any SentrySource, telemetry: any SentryTelemetry = OSLogSentryTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SentryEventLogWidget.surfaceSlug)
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

    private func apply(_ update: SentryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        feedItems = SentryFeedBuilder.build(events: update.events, localize: SentryStrings.string)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch (no rows yet) and the "No security events recorded" empty state when
    /// the resolved list is empty; whenever events are known the widget renders
    /// (cached rows stay visible behind refresh/errors, with the freshness chip +
    /// banner reflecting staleness/offline/failure).
    public static func resolvePhase(_ update: SentryUpdate) -> Phase {
        let hasEvents = !update.events.isEmpty
        switch update.status {
        case .loading:
            return hasEvents ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasEvents ? .content : .empty
        case let .failed(message):
            return hasEvents ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySentrySource: SentrySource {
    public var onUpdate: (@MainActor (SentryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SentryUpdate?

    public init(initial: SentryUpdate? = nil) {
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
    public func push(_ update: SentryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/security.ts → "sentry-event-log")

public extension SentryEventLogWidget {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "SentryEventLogWidget"

    /// Canonical registry metadata (registry/security.ts → "sentry-event-log").
    static let registration = DashboardWidgetRegistration(
        id: "sentry-event-log",
        nameKey: "widget.sentryEventLog",
        descriptionKey: "widget.sentryEventLog.description",
        category: "security",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SentryEventLogWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SentryStrings {
    public static let table = "SentryEventLogWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
