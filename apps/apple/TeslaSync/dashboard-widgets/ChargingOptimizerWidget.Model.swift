//
//  ChargingOptimizerWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0022 · ChargingOptimizerWidget (Apple)
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
public protocol ChargingOptimizerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogChargingOptimizerTelemetry: ChargingOptimizerTelemetry {
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
/// the upstream `useChargingOptimizer` query status into one value, exactly as the
/// web does (`isLoading`, `isError`, the `!data` empty gate).
public enum ChargingOptimizerLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum ChargingOptimizerConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargingOptimizerSource`: the cached
/// optimizer payload, the display-formatting context, the reference time, and the
/// load / connection status. The model turns this into the projection. A `nil`
/// `data` reproduces the web `!data` top-level empty state.
public struct ChargingOptimizerWidgetUpdate: Sendable, Equatable {
    public var status: ChargingOptimizerLoadStatus
    public var connection: ChargingOptimizerConnection
    public var data: ChargingOptimizerInput?
    public var format: ChargingOptimizerFormatting
    public var updatedAt: Date?

    public init(
        status: ChargingOptimizerLoadStatus = .loading,
        connection: ChargingOptimizerConnection = .live,
        data: ChargingOptimizerInput? = nil,
        format: ChargingOptimizerFormatting = .default,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.format = format
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — the `useVehicles` (default-vehicle resolution) +
/// `useChargingOptimizer` equivalents (`StateHolderModel<LoadableState<…>>` over
/// the KMP `ChargingStore` / `VehiclesStore`); previews and tests use
/// `InMemoryChargingOptimizerSource`. The view never talks to the network.
@MainActor
public protocol ChargingOptimizerSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargingOptimizerWidgetUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ChargingOptimizerSource`,
/// recomputes the projection via `ChargingOptimizerProjectionBuilder`, and exposes
/// a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargingOptimizerModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargingOptimizerConnection = .live
    public private(set) var projection: ChargingOptimizerProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargingOptimizerSource
    @ObservationIgnored private let telemetry: any ChargingOptimizerTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ChargingOptimizerSource,
        telemetry: any ChargingOptimizerTelemetry = OSLogChargingOptimizerTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargingOptimizerWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached projection stays visible). Wired to the
    /// web `refetch()` — the retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChargingOptimizerWidgetUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = ChargingOptimizerProjectionBuilder.build(
            data: update.data,
            format: update.format,
            localize: ChargingOptimizerStrings.string
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when the payload never resolved; whenever any
    /// payload is known the content renders (cached values stay visible behind
    /// refresh / errors).
    static func resolvePhase(status: ChargingOptimizerLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryChargingOptimizerSource: ChargingOptimizerSource {
    public var onUpdate: (@MainActor (ChargingOptimizerWidgetUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingOptimizerWidgetUpdate?

    public init(initial: ChargingOptimizerWidgetUpdate? = nil) {
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
    public func push(_ update: ChargingOptimizerWidgetUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargingOptimizerWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum ChargingOptimizerStrings {
    public static let table = "ChargingOptimizerWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget body. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum ChargingOptimizerAccessibility {
    public static func summary(for projection: ChargingOptimizerProjection) -> String {
        guard projection.hasData else {
            return ChargingOptimizerStrings.string("widget.chargingOptimizer.noData", "No optimizer data")
        }

        let optimalLabel = ChargingOptimizerStrings.string("widget.chargingOptimizer.optimalStart", "Optimal start")
        let socLabel = ChargingOptimizerStrings.string("widget.chargingOptimizer.targetSoc", "Target SOC")
        let savingsLabel = ChargingOptimizerStrings.string("widget.chargingOptimizer.savingsLabel", "Savings/mo")

        var parts: [String] = [
            "\(optimalLabel): \(projection.optimalStartText)",
            "\(socLabel): \(projection.targetSocText)",
            "\(savingsLabel): \(projection.savingsText)",
            projection.peakUsageText,
            projection.scheduleBadgeText
        ]

        if projection.hasTips {
            parts.append(ChargingOptimizerStrings.string(
                "widget.chargingOptimizer.recommendations",
                "Recommendations"
            ))
        } else {
            parts.append(ChargingOptimizerStrings.string(
                "widget.chargingOptimizer.noRecommendations",
                "No recommendations"
            ))
        }

        return parts.joined(separator: ". ")
    }
}
