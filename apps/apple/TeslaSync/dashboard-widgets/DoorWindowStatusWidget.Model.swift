//
//  DoorWindowStatusWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0037 · DoorWindowStatusWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). The view binds through `DoorWindowModel`; no networking lives in the
//  view. This file owns the seams; the pure cached → projection logic lives in
//  DoorWindowStatusWidget.Adapter.swift.
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
public protocol DoorWindowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogDoorWindowTelemetry: DoorWindowTelemetry {
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
/// cases the production source projects from the `useSecurityLatest` query.
public enum DoorWindowLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header chip + the stale/offline banner so cached values are clearly labeled.
public enum DoorWindowConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One door/window signal value as the API delivers it. The backend serializes
/// raw `signal.SignalValue` (`interface{}`), so a single field can arrive as a
/// native boolean OR a string enum (web `string | boolean | null`). The adapter
/// type-narrows over these cases exactly like the web `typeof` checks.
public enum DoorWindowSignalValue: Sendable, Equatable {
    case boolean(Bool)
    case text(String)
    case absent
}

/// The cached "latest security event" projection the P1/S8 store hands the model
/// (web `SecurityEvent`). `doorState` + the four window fields keep their raw
/// union so the adapter can reproduce the web parsing. Field order matches the
/// web `windows` array (`fd, fp, rd, rp`).
public struct DoorWindowLatestInput: Sendable, Equatable {
    public var doorState: DoorWindowSignalValue
    public var frontDriverWindow: DoorWindowSignalValue
    public var frontPassengerWindow: DoorWindowSignalValue
    public var rearDriverWindow: DoorWindowSignalValue
    public var rearPassengerWindow: DoorWindowSignalValue

    public init(
        doorState: DoorWindowSignalValue = .absent,
        frontDriverWindow: DoorWindowSignalValue = .absent,
        frontPassengerWindow: DoorWindowSignalValue = .absent,
        rearDriverWindow: DoorWindowSignalValue = .absent,
        rearPassengerWindow: DoorWindowSignalValue = .absent
    ) {
        self.doorState = doorState
        self.frontDriverWindow = frontDriverWindow
        self.frontPassengerWindow = frontPassengerWindow
        self.rearDriverWindow = rearDriverWindow
        self.rearPassengerWindow = rearPassengerWindow
    }
}

/// One coalesced snapshot pushed by a `DoorWindowSource`: the cached latest event
/// plus its load/connection status. The model turns this into the cell grids.
public struct DoorWindowUpdate: Sendable, Equatable {
    public var status: DoorWindowLoadStatus
    public var connection: DoorWindowConnection
    public var latest: DoorWindowLatestInput?
    public var updatedAt: Date?

    public init(
        status: DoorWindowLoadStatus = .loading,
        connection: DoorWindowConnection = .live,
        latest: DoorWindowLatestInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.latest = latest
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `security/latest` query store); previews and
/// tests use `InMemoryDoorWindowSource`. The view never talks to the network.
@MainActor
public protocol DoorWindowSource: AnyObject {
    var onUpdate: (@MainActor (DoorWindowUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `DoorWindowSource`,
/// recomputes the `DoorWindowProjection` (door cells, window cells, open counts),
/// and exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DoorWindowModel {
    /// The mutually-exclusive render branches (web shell loading / content + the
    /// grid's own empty state when the source resolves with no event).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DoorWindowConnection = .live
    public private(set) var projection: DoorWindowProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DoorWindowSource
    @ObservationIgnored private let telemetry: any DoorWindowTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DoorWindowSource,
        telemetry: any DoorWindowTelemetry = OSLogDoorWindowTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DoorWindowStatusWidget.surfaceSlug)
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

    private func apply(_ update: DoorWindowUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = DoorWindowCellsBuilder.build(latest: update.latest, localize: DoorWindowStrings.string)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the grid's "No door/window data" empty state when there is no
    /// event; whenever an event is known the widget renders (cached values stay
    /// visible behind refresh/errors, with the freshness chip reflecting
    /// staleness/failure).
    public static func resolvePhase(_ update: DoorWindowUpdate) -> Phase {
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
public final class InMemoryDoorWindowSource: DoorWindowSource {
    public var onUpdate: (@MainActor (DoorWindowUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DoorWindowUpdate?

    public init(initial: DoorWindowUpdate? = nil) {
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
    public func push(_ update: DoorWindowUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "DoorWindowStatusWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time.
public enum DoorWindowStrings {
    public static let table = "DoorWindowStatusWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
