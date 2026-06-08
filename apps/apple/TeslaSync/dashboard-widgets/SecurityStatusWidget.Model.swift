//
//  SecurityStatusWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0085 · SecurityStatusWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). The view binds through `SecurityModel`; no networking lives in the
//  view. This file owns the seams; the pure cached → cell projection lives in
//  SecurityStatusWidget.Adapter.swift.
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
public protocol SecurityTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSecurityTelemetry: SecurityTelemetry {
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
public enum SecurityLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header chip + the stale/offline banner so cached values are clearly labeled.
public enum SecurityConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One door/window signal value as the API delivers it. The backend serializes
/// raw `signal.SignalValue` (`interface{}`), so a single field can arrive as a
/// native boolean OR a string enum (web `string | boolean | null`). The adapter
/// type-narrows over these cases exactly like the web `typeof` checks.
public enum SecuritySignalValue: Sendable, Equatable {
    case boolean(Bool)
    case text(String)
    case absent
}

/// The cached "latest security event" projection the P1/S8 store hands the model
/// (web `SecurityEvent`). `locked`/`sentryMode` are already null-coalesced to the
/// web's falsy default (`value ?? false`); `doorState` + the four window fields
/// keep their raw union so the cell builder can reproduce the web parsing.
public struct SecurityLatestInput: Sendable, Equatable {
    public var locked: Bool
    public var sentryMode: Bool
    public var doorState: SecuritySignalValue
    public var frontDriverWindow: SecuritySignalValue
    public var frontPassengerWindow: SecuritySignalValue
    public var rearDriverWindow: SecuritySignalValue
    public var rearPassengerWindow: SecuritySignalValue

    public init(
        locked: Bool,
        sentryMode: Bool,
        doorState: SecuritySignalValue = .absent,
        frontDriverWindow: SecuritySignalValue = .absent,
        frontPassengerWindow: SecuritySignalValue = .absent,
        rearDriverWindow: SecuritySignalValue = .absent,
        rearPassengerWindow: SecuritySignalValue = .absent
    ) {
        self.locked = locked
        self.sentryMode = sentryMode
        self.doorState = doorState
        self.frontDriverWindow = frontDriverWindow
        self.frontPassengerWindow = frontPassengerWindow
        self.rearDriverWindow = rearDriverWindow
        self.rearPassengerWindow = rearPassengerWindow
    }

    /// The four window fields in web order (fd, fp, rd, rp) — the order the web
    /// `windows` array is built in, kept stable for the open-window count.
    public var windows: [SecuritySignalValue] {
        [frontDriverWindow, frontPassengerWindow, rearDriverWindow, rearPassengerWindow]
    }
}

/// One coalesced snapshot pushed by a `SecuritySource`: the cached latest event
/// plus its load/connection status. The model turns this into the cell grid.
public struct SecurityUpdate: Sendable, Equatable {
    public var status: SecurityLoadStatus
    public var connection: SecurityConnection
    public var latest: SecurityLatestInput?
    public var updatedAt: Date?

    public init(
        status: SecurityLoadStatus = .loading,
        connection: SecurityConnection = .live,
        latest: SecurityLatestInput? = nil,
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
/// tests use `InMemorySecuritySource`. The view never talks to the network.
@MainActor
public protocol SecuritySource: AnyObject {
    var onUpdate: (@MainActor (SecurityUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SecuritySource`,
/// recomputes the `SecurityStatusCell` grid projection, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SecurityModel {
    /// The mutually-exclusive render branches (web shell loading / content + the
    /// grid's own empty state when the source resolves with no event).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SecurityConnection = .live
    public private(set) var cells: [SecurityStatusCell] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SecuritySource
    @ObservationIgnored private let telemetry: any SecurityTelemetry
    @ObservationIgnored private var started = false

    public init(source: any SecuritySource, telemetry: any SecurityTelemetry = OSLogSecurityTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SecurityStatusWidget.surfaceSlug)
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

    private func apply(_ update: SecurityUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        cells = SecurityCellsBuilder.build(latest: update.latest, localize: SecurityStrings.string)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the grid's "No security data" empty state when there is no event;
    /// whenever an event is known the widget renders (cached values stay visible
    /// behind refresh/errors, with the freshness chip reflecting staleness/failure).
    public static func resolvePhase(_ update: SecurityUpdate) -> Phase {
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
public final class InMemorySecuritySource: SecuritySource {
    public var onUpdate: (@MainActor (SecurityUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SecurityUpdate?

    public init(initial: SecurityUpdate? = nil) {
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
    public func push(_ update: SecurityUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SecurityStatusWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SecurityStrings {
    public static let table = "SecurityStatusWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
