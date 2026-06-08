//
//  SubscriptionsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0097 · SubscriptionsWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary.
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
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))`, which is
/// consent-gated and redacted there.
public protocol SubscriptionsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSubscriptionsTelemetry: SubscriptionsTelemetry {
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
public enum SubscriptionsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum SubscriptionsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SubscriptionsSource`: the cached envelope
/// + the display-formatting context + the reference time + load/connection
/// status. The model turns this into the `SubscriptionsProjection`.
public struct SubscriptionsUpdate: Sendable, Equatable {
    public var status: SubscriptionsLoadStatus
    public var connection: SubscriptionsConnection
    public var data: [String: SubscriptionsValue]?
    public var format: SubscriptionsFormatting
    public var now: Date
    public var updatedAt: Date?

    public init(
        status: SubscriptionsLoadStatus = .loading,
        connection: SubscriptionsConnection = .live,
        data: [String: SubscriptionsValue]? = nil,
        format: SubscriptionsFormatting = .default,
        now: Date = Date(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.format = format
        self.now = now
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `useVehicleSubscriptions` / `useVehicles`
/// equivalents — `StateHolderModel<LoadableState<…>>` over the KMP `VehiclesStore`);
/// previews and tests use `InMemorySubscriptionsSource`. The view never talks to
/// the network directly.
@MainActor
public protocol SubscriptionsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SubscriptionsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SubscriptionsSource`,
/// recomputes the `SubscriptionsProjection` via `SubscriptionsProjectionBuilder`,
/// and exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SubscriptionsModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SubscriptionsConnection = .live
    public private(set) var projection: SubscriptionsProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SubscriptionsSource
    @ObservationIgnored private let telemetry: any SubscriptionsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SubscriptionsSource,
        telemetry: any SubscriptionsTelemetry = OSLogSubscriptionsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SubscriptionsWidget.surfaceSlug)
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

    private func apply(_ update: SubscriptionsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = SubscriptionsProjectionBuilder.build(
            data: update.data,
            now: update.now,
            format: update.format,
            localize: SubscriptionsStrings.string
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when nothing resolved; whenever any data is known
    /// the content renders (cached values stay visible behind refresh/errors).
    static func resolvePhase(status: SubscriptionsLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemorySubscriptionsSource: SubscriptionsSource {
    public var onUpdate: (@MainActor (SubscriptionsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SubscriptionsUpdate?

    public init(initial: SubscriptionsUpdate? = nil) {
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
    public func push(_ update: SubscriptionsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SubscriptionsWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SubscriptionsStrings {
    public static let table = "SubscriptionsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// The localized status label for a subscription (web badge text).
    static func statusLabel(active: Bool) -> String {
        active
            ? string("widget.subscriptions.active", "Active")
            : string("widget.subscriptions.expired", "Expired")
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget body. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum SubscriptionsAccessibility {
    public static func summary(for projection: SubscriptionsProjection) -> String {
        guard projection.hasData else {
            return SubscriptionsStrings.string("widget.subscriptions.noData", "No subscriptions")
        }
        var parts: [String] = [
            SubscriptionsStrings.count(
                "widget.subscriptions.activeOfTotal",
                "%lld active",
                projection.activeCount
            )
        ]
        for row in projection.rows {
            parts.append("\(row.name): \(SubscriptionsStrings.statusLabel(active: row.active))")
        }
        return parts.joined(separator: ". ")
    }
}
