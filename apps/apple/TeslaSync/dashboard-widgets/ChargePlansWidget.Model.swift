//
//  ChargePlansWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0018 · ChargePlansWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary.
//
//  NOTE: `DashboardWidgetSize` / `DashboardWidgetRegistration` are the canonical
//  dashboard-grid types declared once for the dashboard-widgets bundle (in
//  DashboardWidgetInfra.swift). This surface *references* them so it registers
//  with the same grid system — it must not redefine them (duplicate symbols).
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
public protocol ChargePlansTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogChargePlansTelemetry: ChargePlansTelemetry {
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
/// cases the production source projects from `Resource<T>`. The source coalesces
/// the two upstream queries (`useChargePlans` + `useRatePlans`) into one status,
/// exactly as the web does (`isLoading = plansLoading || ratesLoading`, etc.).
public enum ChargePlansLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum ChargePlansConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargePlansSource`: the cached plan + rate
/// DTOs, the display-formatting context, the reference time, and the
/// load/connection status. The model turns this into the `ChargePlansProjection`.
public struct ChargePlansUpdate: Sendable, Equatable {
    public var status: ChargePlansLoadStatus
    public var connection: ChargePlansConnection
    public var plans: [ChargePlanInput]
    public var rates: [RatePlanInput]
    public var format: ChargePlansFormatting
    public var updatedAt: Date?

    public init(
        status: ChargePlansLoadStatus = .loading,
        connection: ChargePlansConnection = .live,
        plans: [ChargePlanInput] = [],
        rates: [RatePlanInput] = [],
        format: ChargePlansFormatting = .default,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.plans = plans
        self.rates = rates
        self.format = format
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — the `useVehicles` (default-vehicle resolution) +
/// `useChargePlans` + `useRatePlans` equivalents
/// (`StateHolderModel<LoadableState<…>>` over the KMP `ChargingStore` /
/// `VehiclesStore`); previews and tests use `InMemoryChargePlansSource`. The view
/// never talks to the network directly.
@MainActor
public protocol ChargePlansSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargePlansUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ChargePlansSource`,
/// recomputes the `ChargePlansProjection` via `ChargePlansProjectionBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargePlansModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargePlansConnection = .live
    public private(set) var projection: ChargePlansProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargePlansSource
    @ObservationIgnored private let telemetry: any ChargePlansTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ChargePlansSource,
        telemetry: any ChargePlansTelemetry = OSLogChargePlansTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargePlansWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached projection stays visible). Wired to the
    /// web `handleRefresh` (`refetchPlans()` + `refetchRates()`) — the retry /
    /// refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChargePlansUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = ChargePlansProjectionBuilder.build(
            plans: update.plans,
            rates: update.rates,
            format: update.format,
            localize: ChargePlansStrings.string
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when nothing resolved; whenever any data is known
    /// the content renders (cached values stay visible behind refresh/errors).
    static func resolvePhase(status: ChargePlansLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargePlansSource: ChargePlansSource {
    public var onUpdate: (@MainActor (ChargePlansUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargePlansUpdate?

    public init(initial: ChargePlansUpdate? = nil) {
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
    public func push(_ update: ChargePlansUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargePlansWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum ChargePlansStrings {
    public static let table = "ChargePlansWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget body. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum ChargePlansAccessibility {
    public static func summary(for projection: ChargePlansProjection) -> String {
        guard projection.hasData else {
            return ChargePlansStrings.string("widget.chargePlans.noData", "No charge plans or rate data")
        }

        var parts: [String] = []

        if let active = projection.active {
            let socLabel = ChargePlansStrings.string("widget.chargePlans.targetSoc", "Target SOC")
            let statusLabel = ChargePlansStrings.string("widget.chargePlans.status", "Status")
            let departureLabel = ChargePlansStrings.string("widget.chargePlans.departure", "Departure")
            parts.append("\(socLabel): \(active.targetSocText)")
            parts.append("\(statusLabel): \(active.statusText)")
            parts.append("\(departureLabel): \(active.departureText)")
        } else {
            parts.append(ChargePlansStrings.string("widget.chargePlans.noPlans", "No charge plans"))
        }

        if projection.hasRates {
            parts.append(ChargePlansStrings.count(
                "widget.chargePlans.rateCount",
                "%lld rate plans",
                projection.rateRows.count
            ))
        }

        return parts.joined(separator: ". ")
    }
}
