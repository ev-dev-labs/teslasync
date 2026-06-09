//
//  EnergyFlowWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0046 · EnergyFlowWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the locale-aware value formatters and the testable accessibility summary. The
//  view binds through `EnergyFlowModel`; no networking lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted
/// there).
public protocol EnergyFlowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogEnergyFlowTelemetry: EnergyFlowTelemetry {
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
/// cases the production source projects from `Resource<T>`.
public enum EnergyFlowLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum EnergyFlowConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `EnergyFlowSource`: the cached vehicle
/// state plus its load/connection status. The model turns this into the diagram
/// projection + render phase.
public struct EnergyFlowUpdate: Sendable, Equatable {
    public var status: EnergyFlowLoadStatus
    public var connection: EnergyFlowConnection
    public var state: EnergyFlowVehicleState?
    public var updatedAt: Date?

    public init(
        status: EnergyFlowLoadStatus = .loading,
        connection: EnergyFlowConnection = .live,
        state: EnergyFlowVehicleState? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.state = state
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` over the KMP
/// `VehiclesStore`, resolving the selected vehicle the way the web's
/// `vehicleId ?? vehicles[0].id` does); previews and tests use
/// `InMemoryEnergyFlowSource`.
@MainActor
public protocol EnergyFlowSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (EnergyFlowUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to an `EnergyFlowSource`,
/// recomputes the `EnergyFlowProjection` via `EnergyFlowBuilder`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class EnergyFlowModel {
    /// The mutually-exclusive render branches (web shell + diagram states).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: EnergyFlowConnection = .live
    public private(set) var projection: EnergyFlowProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any EnergyFlowSource
    @ObservationIgnored private let telemetry: any EnergyFlowTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any EnergyFlowSource,
        telemetry: any EnergyFlowTelemetry = OSLogEnergyFlowTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EnergyFlowWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of the vehicle state (web `refetch`). Cached values stay
    /// visible.
    public func refresh() {
        source.refresh()
    }

    /// Whether the diagram should compact to its three largest flows (web
    /// `isCompact = size.cols <= 1`).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    private func apply(_ update: EnergyFlowUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = EnergyFlowBuilder.buildProjection(update.state)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase, keeping cached content visible behind background
    /// refreshes and errors (web: the shell only shows the skeleton on the initial
    /// fetch, and the diagram's "No energy data available" empty state when the
    /// vehicle state is absent).
    static func resolvePhase(_ update: EnergyFlowUpdate) -> Phase {
        let hasState = update.state != nil
        switch update.status {
        case .loading:
            return hasState ? .content : .loading
        case .loaded, .empty:
            return hasState ? .content : .empty
        case let .failed(message):
            return hasState ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryEnergyFlowSource: EnergyFlowSource {
    public var onUpdate: (@MainActor (EnergyFlowUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EnergyFlowUpdate?

    public init(initial: EnergyFlowUpdate? = nil) {
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
    public func push(_ update: EnergyFlowUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "EnergyFlowWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration.
public enum EnergyFlowStrings {
    public static let table = "EnergyFlowWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// The localized display label for a node (web node `label`).
    public static func label(_ label: EnergyFlowLabel) -> String {
        switch label {
        case .battery: string("widget.battery", "Battery")
        case .consuming: string("widget.consuming", "Consuming")
        case .regenerating: string("widget.regenerating", "Regenerating")
        case .standby: string("widget.standby", "Standby")
        case .charger: string("widget.charger", "Charger")
        }
    }
}

// MARK: - Value formatting (locale-aware; web `AnimatedNumber` + `formattedValue`)

/// Formats node values the way the web does: the ring shows `node.value` at one
/// fraction digit (`AnimatedNumber decimals={1}`); the semantic `formattedValue`
/// is a percent (battery), a kW magnitude (motor/charger), or the standby dash.
public enum EnergyFlowFormat {
    private nonisolated(unsafe) static let oneDecimal: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 1
        return formatter
    }()

    private nonisolated(unsafe) static let integer: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter
    }()

    /// The bare ring number, e.g. `"12.3"` (web `AnimatedNumber`, one decimal, no
    /// unit) — used for every node regardless of its semantic unit.
    public static func magnitude(_ value: Double) -> String {
        oneDecimal.string(from: NSNumber(value: value)) ?? String(format: "%.1f", value)
    }

    /// The em-dash shown for a standby motor (web `formattedValue: '—'`).
    public static let dash = "—"

    /// The semantic value for a node (web `formattedValue`): `"75%"` / `"12.3 kW"`
    /// / `"—"`. Used by the accessibility summary.
    public static func accessibleValue(magnitude value: Double, unit: EnergyFlowValueUnit) -> String {
        switch unit {
        case .percent:
            let number = integer.string(from: NSNumber(value: value)) ?? String(format: "%.0f", value)
            return "\(number)%"
        case .kilowatts:
            let kilowatts = EnergyFlowStrings.string("widget.unitKw", "kW")
            return "\(magnitude(value)) \(kilowatts)"
        case .standby:
            return dash
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the flow diagram. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum EnergyFlowAccessibility {
    public static func summary(for projection: EnergyFlowProjection) -> String {
        guard projection.hasState, !projection.nodes.isEmpty else {
            return EnergyFlowStrings.string("widget.noEnergyData", "No energy data available")
        }
        let parts = projection.nodes.map { node in
            let value = EnergyFlowFormat.accessibleValue(magnitude: node.magnitude, unit: node.unit)
            return "\(EnergyFlowStrings.label(node.label)) \(value)"
        }
        return parts.joined(separator: ". ")
    }
}
