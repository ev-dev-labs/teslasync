//
//  LiveSignalsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0058 · LiveSignalsWidget (Apple)
//
//  The seams that keep the SwiftUI view declarative: the P1/S8 state-holder
//  (`LiveSignalsSource` → `LiveSignalsModel`), the P1/S11 telemetry contract, the
//  P1/S10 localization facade, and the testable accessibility summary. No
//  networking lives here — the production source is wired over the shared stores
//  at the composition root; previews and tests drive `InMemoryLiveSignalsSource`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted).
public protocol LiveSignalsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogLiveSignalsTelemetry: LiveSignalsTelemetry {
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
/// cases the production source projects from each query `Resource<T>`.
public enum LiveSignalsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web binds
/// these from the motor query's `isStale` / fetch state into the shell freshness.
public enum LiveSignalsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `LiveSignalsSource`: the cached SI DTO inputs
/// (web `useMotorLatest` / `useClimateLatest` / `useSecurityLatest` /
/// `useLatestTirePressure`), the resolved unit preferences (web `useUnits`), and
/// the load/connection status. The model turns this into the display projection.
public struct LiveSignalsUpdate: Sendable, Equatable {
    public var status: LiveSignalsLoadStatus
    public var connection: LiveSignalsConnection
    public var prefs: LiveSignalsUnitPrefs
    public var motor: LiveSignalsMotorInput?
    public var climate: LiveSignalsClimateInput?
    public var security: LiveSignalsSecurityInput?
    public var tires: LiveSignalsTiresInput?
    public var updatedAt: Date?

    public init(
        status: LiveSignalsLoadStatus = .loading,
        connection: LiveSignalsConnection = .live,
        prefs: LiveSignalsUnitPrefs = .metric,
        motor: LiveSignalsMotorInput? = nil,
        climate: LiveSignalsClimateInput? = nil,
        security: LiveSignalsSecurityInput? = nil,
        tires: LiveSignalsTiresInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.prefs = prefs
        self.motor = motor
        self.climate = climate
        self.security = security
        self.tires = tires
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — the `VehicleStore` (web `useVehicles`, resolving
/// the active vehicle), the motor/climate/security/tire live stores, and the
/// settings-derived unit preferences (web `useUnits`). The view never performs
/// transport; previews and tests use `InMemoryLiveSignalsSource`.
@MainActor
public protocol LiveSignalsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (LiveSignalsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `LiveSignalsSource`,
/// recomputes the `LiveSignalsProjection` via `LiveSignalsBuilder`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class LiveSignalsModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: LiveSignalsConnection = .live
    public private(set) var projection: LiveSignalsProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any LiveSignalsSource
    @ObservationIgnored private let telemetry: any LiveSignalsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LiveSignalsSource,
        telemetry: any LiveSignalsTelemetry = OSLogLiveSignalsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LiveSignalsWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached values stay visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: LiveSignalsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = LiveSignalsBuilder.buildProjection(
            motor: update.motor,
            climate: update.climate,
            security: update.security,
            tires: update.tires,
            prefs: update.prefs
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows skeleton chrome on the initial
    /// fetch and the empty state when no signal arrived; once any section has data
    /// the grid renders and cached values stay visible behind refresh/errors.
    static func resolvePhase(status: LiveSignalsLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            hasData ? .content : .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryLiveSignalsSource: LiveSignalsSource {
    public var onUpdate: (@MainActor (LiveSignalsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveSignalsUpdate?

    public init(initial: LiveSignalsUpdate? = nil) {
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
    public func push(_ update: LiveSignalsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "LiveSignalsWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum LiveSignalsStrings {
    public static let table = "LiveSignalsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// One labeled value spoken in the VoiceOver summary.
private struct LiveSignalsSpokenRow {
    let label: String
    let value: String
}

/// Builds the VoiceOver value spoken for the signal grid. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum LiveSignalsAccessibility {
    public static func summary(for projection: LiveSignalsProjection) -> String {
        let sections = [
            motorSummary(projection.motor),
            climateSummary(projection.climate),
            tiresSummary(projection.tires),
            projection.security.map(securitySummary)
        ].compactMap(\.self)
        if sections.isEmpty {
            return LiveSignalsStrings.string("widget.noSignals", "No live signal data")
        }
        return sections.joined(separator: ". ")
    }

    private static func motorSummary(_ motor: LiveSignalsMotorRows?) -> String? {
        guard let motor else { return nil }
        return sectionSummary(LiveSignalsStrings.string("widget.motor", "Motor"), [
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.torque", "Torque"), value: motor.torque),
            LiveSignalsSpokenRow(
                label: LiveSignalsStrings.string("widget.motorTemp", "Temp"),
                value: motor.temperature
            ),
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.gear", "Gear"), value: motor.gear)
        ])
    }

    private static func climateSummary(_ climate: LiveSignalsClimateRows?) -> String? {
        guard let climate else { return nil }
        return sectionSummary(LiveSignalsStrings.string("widget.climate", "Climate"), [
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.cabin", "Cabin"), value: climate.cabin),
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.outside", "Outside"), value: climate.outside),
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.hvac", "HVAC"), value: climate.hvac)
        ])
    }

    private static func tiresSummary(_ tires: LiveSignalsTireRows?) -> String? {
        guard let tires else { return nil }
        return sectionSummary(LiveSignalsStrings.string("widget.tires", "Tires"), [
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.tire.fl", "FL"), value: tires.frontLeft),
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.tire.fr", "FR"), value: tires.frontRight),
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.tire.rl", "RL"), value: tires.rearLeft),
            LiveSignalsSpokenRow(label: LiveSignalsStrings.string("widget.tire.rr", "RR"), value: tires.rearRight)
        ])
    }

    private static func sectionSummary(_ title: String, _ rows: [LiveSignalsSpokenRow]) -> String {
        let body = rows.map { "\($0.label) \($0.value)" }.joined(separator: ", ")
        return "\(title): \(body)"
    }

    private static func securitySummary(_ security: LiveSignalsSecurityRows) -> String {
        let title = LiveSignalsStrings.string("widget.security", "Security")
        let lock = security.locked
            ? LiveSignalsStrings.string("widget.locked", "Locked")
            : LiveSignalsStrings.string("widget.unlocked", "Unlocked")
        let sentry = security.sentryActive
            ? LiveSignalsStrings.string("widget.active", "Active")
            : LiveSignalsStrings.string("widget.off", "Off")
        let lockLabel = LiveSignalsStrings.string("widget.lock", "Lock")
        let sentryLabel = LiveSignalsStrings.string("widget.sentry", "Sentry")
        return "\(title): \(lockLabel) \(lock), \(sentryLabel) \(sentry)"
    }
}
