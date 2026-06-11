//
//  EnergyFlowAnimatedWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0045 · EnergyFlowAnimatedWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the locale-aware value formatters and the testable accessibility summaries.
//  The view binds through `EnergyFlowAnimatedModel`; no networking lives in the
//  view.
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
public protocol EnergyFlowAnimatedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogEnergyFlowAnimatedTelemetry: EnergyFlowAnimatedTelemetry {
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
public enum EnergyFlowAnimatedLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum EnergyFlowAnimatedConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `EnergyFlowAnimatedSource`: the cached
/// vehicle state plus its load/connection status. The model turns this into the
/// diagram projection, the compact summary, and the render phase.
public struct EnergyFlowAnimatedUpdate: Sendable, Equatable {
    public var status: EnergyFlowAnimatedLoadStatus
    public var connection: EnergyFlowAnimatedConnection
    public var state: EnergyFlowAnimatedVehicleState?
    public var updatedAt: Date?

    public init(
        status: EnergyFlowAnimatedLoadStatus = .loading,
        connection: EnergyFlowAnimatedConnection = .live,
        state: EnergyFlowAnimatedVehicleState? = nil,
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
/// `InMemoryEnergyFlowAnimatedSource`.
@MainActor
public protocol EnergyFlowAnimatedSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (EnergyFlowAnimatedUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to an
/// `EnergyFlowAnimatedSource`, recomputes the projection + compact summary via
/// `EnergyFlowAnimatedBuilder`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class EnergyFlowAnimatedModel {
    /// The mutually-exclusive render branches (web shell + diagram states).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: EnergyFlowAnimatedConnection = .live
    public private(set) var projection: EnergyFlowAnimatedProjection = .empty
    public private(set) var compactSummary: EnergyFlowAnimatedCompactSummary = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any EnergyFlowAnimatedSource
    @ObservationIgnored private let telemetry: any EnergyFlowAnimatedTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any EnergyFlowAnimatedSource,
        telemetry: any EnergyFlowAnimatedTelemetry = OSLogEnergyFlowAnimatedTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EnergyFlowAnimatedWidget.surfaceSlug)
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

    /// Whether the surface renders the compact 1-column layout (web
    /// `isCompact = size.cols < 2`).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols < 2
    }

    private func apply(_ update: EnergyFlowAnimatedUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = EnergyFlowAnimatedBuilder.buildProjection(update.state)
        compactSummary = EnergyFlowAnimatedBuilder.compactSummary(update.state)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase, keeping cached content visible behind background
    /// refreshes and errors (web: the shell only shows the skeleton on the initial
    /// fetch, and the "No energy data available" empty state when the vehicle state
    /// is absent).
    static func resolvePhase(_ update: EnergyFlowAnimatedUpdate) -> Phase {
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
public final class InMemoryEnergyFlowAnimatedSource: EnergyFlowAnimatedSource {
    public var onUpdate: (@MainActor (EnergyFlowAnimatedUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EnergyFlowAnimatedUpdate?

    public init(initial: EnergyFlowAnimatedUpdate? = nil) {
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
    public func push(_ update: EnergyFlowAnimatedUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "EnergyFlowAnimatedWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum EnergyFlowAnimatedStrings {
    public static let table = "EnergyFlowAnimatedWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// The localized display label for a node (web node `label`).
    public static func label(_ label: EnergyFlowAnimatedLabel) -> String {
        switch label {
        case .battery: string("widget.energyFlowAnimated.battery", "Battery")
        case .drive: string("widget.energyFlowAnimated.drive", "Drive")
        case .regen: string("widget.energyFlowAnimated.regen", "Regen")
        case .idle: string("widget.energyFlowAnimated.idle", "Idle")
        case .charger: string("widget.energyFlowAnimated.charger", "Charger")
        }
    }

    /// The localized label for a compact chip (web `CompactView` rows have icons,
    /// not text; VoiceOver names them via the parity node labels).
    public static func chipLabel(_ kind: EnergyFlowAnimatedCompactChip.Kind) -> String {
        switch kind {
        case .charging: string("widget.energyFlowAnimated.charger", "Charger")
        case .consuming: string("widget.energyFlowAnimated.drive", "Drive")
        case .regen: string("widget.energyFlowAnimated.regen", "Regen")
        }
    }
}

// MARK: - Value formatting (locale-aware; web `AnimatedNumber` + `fmtNumber`)

/// Formats node values the way the web does: the ring shows `node.value` at one
/// fraction digit (`AnimatedNumber decimals={1}`); the semantic value is a percent
/// (battery), a kW magnitude at a node-specific precision (drive one decimal,
/// charger zero), or the standby dash.
public enum EnergyFlowAnimatedFormat {
    private static let oneDecimal: NumberFormatter = decimalFormatter(min: 1, max: 1)
    private static let integer: NumberFormatter = decimalFormatter(min: 0, max: 0)

    private static func decimalFormatter(min: Int, max: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = min
        formatter.maximumFractionDigits = max
        return formatter
    }

    /// The bare ring number, e.g. `"12.3"` (web `AnimatedNumber`, one decimal, no
    /// unit) — used for every node regardless of its semantic unit.
    public static func magnitude(_ value: Double) -> String {
        oneDecimal.string(from: NSNumber(value: value)) ?? String(format: "%.1f", value)
    }

    /// A whole percentage, e.g. `"72%"` (web `${batteryLevel}%`).
    public static func percent(_ value: Double) -> String {
        let number = integer.string(from: NSNumber(value: value)) ?? String(format: "%.0f", value)
        return "\(number)%"
    }

    /// A kW magnitude at the given precision, e.g. `"18.4 kW"` / `"11 kW"` (web
    /// `${fmtNumber(value, decimals)} kW`).
    public static func kilowatts(_ value: Double, decimals: Int) -> String {
        let formatted: String = if decimals <= 0 {
            integer.string(from: NSNumber(value: value)) ?? String(format: "%.0f", value)
        } else {
            magnitude(value)
        }
        let unit = EnergyFlowAnimatedStrings.string("widget.unitKw", "kW")
        return "\(formatted) \(unit)"
    }

    /// The em-dash shown for an idle drive / unplugged charger (web `'—'`).
    public static let dash = "—"

    /// The semantic value for a node (web `formattedValue`): `"72%"` / `"18.4 kW"`
    /// / `"11 kW"` / `"—"`. Used by the accessibility summaries.
    public static func accessibleValue(magnitude value: Double, unit: EnergyFlowAnimatedValueUnit) -> String {
        switch unit {
        case .percent:
            percent(value)
        case let .kilowatts(decimals):
            kilowatts(value, decimals: decimals)
        case .standby:
            dash
        }
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver values spoken for the diagram and the compact layout. Pure
/// + public so the a11y content can be unit-tested without rendering the view.
public enum EnergyFlowAnimatedAccessibility {
    /// The per-node value summary for the full diagram, e.g.
    /// `"Battery 72%. Drive 18.4 kW. Charger 11 kW"`.
    public static func summary(for projection: EnergyFlowAnimatedProjection) -> String {
        guard projection.hasState, !projection.nodes.isEmpty else {
            return EnergyFlowAnimatedStrings.string("widget.energyFlowAnimated.noData", "No energy data available")
        }
        let parts = projection.nodes.map { node in
            let value = EnergyFlowAnimatedFormat.accessibleValue(magnitude: node.magnitude, unit: node.unit)
            return "\(EnergyFlowAnimatedStrings.label(node.label)) \(value)"
        }
        return parts.joined(separator: ". ")
    }

    /// The compact-layout summary, e.g. `"Battery 72%. Charger 11.0 kW"` or, when
    /// nothing is moving, `"Battery 80%. Idle"`.
    public static func compactSummary(for summary: EnergyFlowAnimatedCompactSummary) -> String {
        let percent = EnergyFlowAnimatedFormat.percent(summary.batteryLevel)
        let battery = "\(EnergyFlowAnimatedStrings.label(.battery)) \(percent)"
        guard !summary.isIdle else {
            return "\(battery). \(EnergyFlowAnimatedStrings.label(.idle))"
        }
        let chips = summary.chips.map { chip in
            let value = EnergyFlowAnimatedFormat.kilowatts(chip.valueKw, decimals: 1)
            return "\(EnergyFlowAnimatedStrings.chipLabel(chip.kind)) \(value)"
        }
        return ([battery] + chips).joined(separator: ". ")
    }
}
