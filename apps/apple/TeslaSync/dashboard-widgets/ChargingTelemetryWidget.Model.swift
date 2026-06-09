//
//  ChargingTelemetryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0025 · ChargingTelemetryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the locale-aware number formatter and the testable accessibility summary. The
//  view binds through `ChargingTelemetryModel`; no networking lives in the view.
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
public protocol ChargingTelemetryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogChargingTelemetryTelemetry: ChargingTelemetryTelemetry {
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
public enum ChargingTelemetryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web
/// query polls every 5s; native folds that into a live / stale / offline chip.
public enum ChargingTelemetryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargingTelemetrySource`: the cached
/// telemetry row plus its load/connection status. The model turns this into the
/// projection, the rolling power history and the render phase.
public struct ChargingTelemetryUpdate: Sendable, Equatable {
    public var status: ChargingTelemetryLoadStatus
    public var connection: ChargingTelemetryConnection
    public var snapshot: ChargingTelemetrySnapshot?
    public var updatedAt: Date?

    public init(
        status: ChargingTelemetryLoadStatus = .loading,
        connection: ChargingTelemetryConnection = .live,
        snapshot: ChargingTelemetrySnapshot? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.snapshot = snapshot
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — resolving the active vehicle (web `useVehicles`)
/// and polling `/charging-telemetry/latest` (web `useChargingTelemetryLatest`,
/// 5s) — and pushes a coalesced `ChargingTelemetryUpdate`. Previews and tests use
/// `InMemoryChargingTelemetrySource`.
@MainActor
public protocol ChargingTelemetrySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargingTelemetryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ChargingTelemetrySource`,
/// rebuilds the `ChargingTelemetryProjection` via `ChargingTelemetryBuilder`,
/// accumulates the rolling power history, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargingTelemetryModel {
    /// The mutually-exclusive render branches (web shell + content states).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    /// The rolling power-history cap (web `MAX_POWER_HISTORY`).
    public static let maxPowerHistory = 30

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargingTelemetryConnection = .live
    public private(set) var projection: ChargingTelemetryProjection = .empty
    public private(set) var powerHistory: [Double] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargingTelemetrySource
    @ObservationIgnored private let telemetry: any ChargingTelemetryTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastTimestamp: String?

    public init(
        source: any ChargingTelemetrySource,
        telemetry: any ChargingTelemetryTelemetry = OSLogChargingTelemetryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargingTelemetryWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refetch (web `refetch()`); cached values stay visible.
    public func refresh() {
        source.refresh()
    }

    /// Whether the surface should use its single-column compact layout (web
    /// `isCompact = size.cols <= 1`).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Whether the surface should show its wide extras — the efficiency stat,
    /// charger-type badge and power sparkline (web `isWide = size.cols >= 4`).
    public static func isWide(for size: DashboardWidgetSize) -> Bool {
        size.cols >= 4
    }

    private func apply(_ update: ChargingTelemetryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = ChargingTelemetryBuilder.buildProjection(update.snapshot)

        let accumulated = ChargingTelemetryBuilder.accumulatePower(
            history: powerHistory,
            snapshot: update.snapshot,
            lastTimestamp: lastTimestamp,
            maxSamples: Self.maxPowerHistory
        )
        powerHistory = accumulated.history
        lastTimestamp = accumulated.timestamp

        phase = Self.resolvePhase(update, projection: projection)
    }

    /// Resolves the render phase, keeping cached charging content visible behind
    /// background refreshes and errors. Reproduces the web shell: the skeleton
    /// only on the initial fetch, the "Not currently charging" empty state when
    /// the vehicle is not charging, and the stat grid while charging.
    static func resolvePhase(
        _ update: ChargingTelemetryUpdate,
        projection: ChargingTelemetryProjection
    ) -> Phase {
        let charging = projection.isCharging
        switch update.status {
        case .loading:
            return charging ? .content : .loading
        case .loaded, .empty:
            return charging ? .content : .empty
        case let .failed(message):
            return charging ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargingTelemetrySource: ChargingTelemetrySource {
    public var onUpdate: (@MainActor (ChargingTelemetryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingTelemetryUpdate?

    public init(initial: ChargingTelemetryUpdate? = nil) {
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
    public func push(_ update: ChargingTelemetryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargingTelemetryWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum ChargingTelemetryStrings {
    public static let table = "ChargingTelemetryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// The localized label for a stat (web `t('widget.chargingTelemetry.<kind>')`).
    public static func statLabel(_ kind: ChargingTelemetryStatKind) -> String {
        switch kind {
        case .voltage: string("widget.chargingTelemetry.voltage", "Voltage")
        case .current: string("widget.chargingTelemetry.current", "Current")
        case .power: string("widget.chargingTelemetry.power", "Power")
        case .phases: string("widget.chargingTelemetry.phases", "Phases")
        case .efficiency: string("widget.chargingTelemetry.efficiency", "Efficiency")
        }
    }

    /// The unit suffix for a stat (web literal `unit` on each `StatGridItem`).
    /// Phases carry no unit.
    public static func statUnit(_ kind: ChargingTelemetryStatKind) -> String? {
        switch kind {
        case .voltage: string("widget.chargingTelemetry.unitVolt", "V")
        case .current: string("widget.chargingTelemetry.unitAmp", "A")
        case .power: string("widget.chargingTelemetry.unitKw", "kW")
        case .efficiency: string("widget.chargingTelemetry.unitPercent", "%")
        case .phases: nil
        }
    }

    /// The display label for a charger family (web `${chargerType} Charger`).
    public static func chargerTypeName(_ type: ChargingTelemetryChargerType) -> String {
        switch type {
        case .ac: string("widget.chargingTelemetry.chargerAc", "AC")
        case .dc: string("widget.chargingTelemetry.chargerDc", "DC")
        }
    }
}

// MARK: - Number formatting (locale-aware, web `fmtNumber` / `fmtInt`)

/// Formats magnitudes the way the web `fmtNumber(value, decimals)` does:
/// locale-aware grouping with a fixed fraction-digit count.
public enum ChargingTelemetryFormat {
    /// The em dash shown for phases when zero (web `'—'`).
    public static let noValue = "—"

    /// Formats `value` with exactly `fractionDigits` fraction digits in `locale`
    /// (web `fmtNumber` / `fmtInt`). Non-finite inputs format as zero (web
    /// `safeNumber`).
    public static func number(
        _ value: Double,
        fractionDigits: Int,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: safe))
            ?? String(format: "%.\(fractionDigits)f", safe)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the charging content. Pure + public so
/// the a11y content can be unit-tested without rendering the view.
public enum ChargingTelemetryAccessibility {
    /// A spoken summary of the live charging metrics, or the not-charging copy
    /// when the vehicle is idle.
    public static func summary(
        for projection: ChargingTelemetryProjection,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        guard projection.isCharging else {
            return ChargingTelemetryStrings.string(
                "widget.chargingTelemetry.notCharging",
                "Not currently charging"
            )
        }
        let parts = projection.statKinds(wide: true).map { kind -> String in
            let label = ChargingTelemetryStrings.statLabel(kind)
            let value = projection.formattedValue(for: kind, locale: locale)
            if let unit = ChargingTelemetryStrings.statUnit(kind) {
                return "\(label) \(value) \(unit)"
            }
            return "\(label) \(value)"
        }
        return parts.joined(separator: ". ")
    }
}
