//
//  MaintenanceTrackerWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0061 · MaintenanceTrackerWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry registration +
//  i18n facade (P1/S10) + the testable accessibility summary.
//
//  NOTE: `DashboardWidgetSize` / `DashboardWidgetRegistration` are the canonical
//  dashboard-grid types declared once for the dashboard-widgets bundle (in
//  DigitalTwinWidget.Model.swift). This surface *references* them so it registers
//  with the same grid system — it must not redefine them (duplicate symbols).
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
public protocol MaintenanceTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogMaintenanceTelemetry: MaintenanceTelemetry {
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
public enum MaintenanceLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum MaintenanceConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `MaintenanceSource`: the cached DTO inputs +
/// the display-formatting context + their load/connection status. The model turns
/// this into the `MaintenanceProjection`.
public struct MaintenanceUpdate: Sendable, Equatable {
    public var status: MaintenanceLoadStatus
    public var connection: MaintenanceConnection
    public var maintenance: [MaintenanceItemInput]
    public var records: [ServiceRecordInput]
    public var format: MaintenanceFormatting
    public var updatedAt: Date?

    public init(
        status: MaintenanceLoadStatus = .loading,
        connection: MaintenanceConnection = .live,
        maintenance: [MaintenanceItemInput] = [],
        records: [ServiceRecordInput] = [],
        format: MaintenanceFormatting = .default,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.maintenance = maintenance
        self.records = records
        self.format = format
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `useMaintenance` / `useServiceRecords`
/// equivalents — `StateHolderModel<LoadableState<…>>` over the KMP
/// `VehicleSystemsStore`); previews and tests use `InMemoryMaintenanceSource`. The
/// view never talks to the network directly.
@MainActor
public protocol MaintenanceSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (MaintenanceUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `MaintenanceSource`,
/// recomputes the `MaintenanceProjection` via `MaintenanceProjectionBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class MaintenanceModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: MaintenanceConnection = .live
    public private(set) var projection: MaintenanceProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any MaintenanceSource
    @ObservationIgnored private let telemetry: any MaintenanceTelemetry
    @ObservationIgnored private var started = false

    public init(source: any MaintenanceSource, telemetry: any MaintenanceTelemetry = OSLogMaintenanceTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MaintenanceTrackerWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached projection stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: MaintenanceUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = MaintenanceProjectionBuilder.build(
            maintenance: update.maintenance,
            records: update.records,
            format: update.format
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when nothing resolved; whenever any data is known
    /// the content renders (cached values stay visible behind refresh/errors).
    static func resolvePhase(status: MaintenanceLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryMaintenanceSource: MaintenanceSource {
    public var onUpdate: (@MainActor (MaintenanceUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MaintenanceUpdate?

    public init(initial: MaintenanceUpdate? = nil) {
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
    public func push(_ update: MaintenanceUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "MaintenanceTrackerWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum MaintenanceStrings {
    public static let table = "MaintenanceTrackerWidget"

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

/// Maps an urgency to its localized chip label (web `urgencyLabel`).
enum MaintenanceUrgencyLabels {
    static func label(_ urgency: MaintenanceUrgency) -> String {
        switch urgency {
        case .overdue: MaintenanceStrings.string("widget.maintenance.overdue", "Overdue")
        case .soon: MaintenanceStrings.string("widget.maintenance.soon", "Soon")
        case .good: MaintenanceStrings.string("widget.maintenance.good", "Good")
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget body. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum MaintenanceAccessibility {
    public static func summary(for projection: MaintenanceProjection) -> String {
        guard projection.hasData else {
            return MaintenanceStrings.string("widget.maintenance.noData", "No maintenance data")
        }
        var parts: [String] = []
        if let next = projection.next {
            let nextLabel = MaintenanceStrings.string("widget.maintenance.nextService", "Next Service")
            parts.append("\(nextLabel): \(next.name)")
            parts.append(MaintenanceUrgencyLabels.label(next.urgency))
            let every = MaintenanceStrings.string("widget.maintenance.every", "Every")
            let months = MaintenanceStrings.string("widget.maintenance.months", "mo")
            parts.append("\(every) \(next.monthsText) \(months)")
            parts.append(next.distanceText)
            if let cost = next.costText {
                parts.append(cost)
            }
        }
        if projection.hasRecords {
            parts.append(
                MaintenanceStrings.count(
                    "widget.maintenance.recordsCount",
                    "%lld recent service records",
                    projection.timeline.count
                )
            )
        } else {
            parts.append(MaintenanceStrings.string("widget.maintenance.noRecords", "No service records yet"))
        }
        return parts.joined(separator: ". ")
    }
}
