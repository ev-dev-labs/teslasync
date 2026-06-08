//
//  WarrantyStatusWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0113 · WarrantyStatusWidget (Apple)
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
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol WarrantyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogWarrantyTelemetry: WarrantyTelemetry {
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
public enum WarrantyLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum WarrantyConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `WarrantySource`: the cached warranty DTO +
/// the display-formatting context + their load/connection status. The model turns
/// this into the `WarrantyProjection`.
public struct WarrantyUpdate: Sendable, Equatable {
    public var status: WarrantyLoadStatus
    public var connection: WarrantyConnection
    /// The untyped warranty envelope's `data` object (web `envelope?.data ?? null`);
    /// `nil` is the resolved-but-empty state.
    public var data: WarrantyDataInput?
    public var format: WarrantyFormatting
    public var updatedAt: Date?

    public init(
        status: WarrantyLoadStatus = .loading,
        connection: WarrantyConnection = .live,
        data: WarrantyDataInput? = nil,
        format: WarrantyFormatting = .default,
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
/// shared P1/S8 state holders (the `useWarrantyDetails` equivalent —
/// `StateHolderModel<LoadableState<…>>` over the KMP `VehiclesStore`); previews and
/// tests use `InMemoryWarrantySource`. The view never talks to the network directly.
@MainActor
public protocol WarrantySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (WarrantyUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `WarrantySource`, recomputes
/// the `WarrantyProjection` via `WarrantyProjectionBuilder`, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class WarrantyModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: WarrantyConnection = .live
    public private(set) var projection: WarrantyProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any WarrantySource
    @ObservationIgnored private let telemetry: any WarrantyTelemetry
    @ObservationIgnored private var started = false

    public init(source: any WarrantySource, telemetry: any WarrantyTelemetry = OSLogWarrantyTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WarrantyStatusWidget.surfaceSlug)
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

    private func apply(_ update: WarrantyUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = WarrantyProjectionBuilder.build(data: update.data, format: update.format)
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when no `data` object resolved; whenever the
    /// envelope carries data the content renders (cached values stay visible behind
    /// refresh/errors).
    static func resolvePhase(status: WarrantyLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryWarrantySource: WarrantySource {
    public var onUpdate: (@MainActor (WarrantyUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WarrantyUpdate?

    public init(initial: WarrantyUpdate? = nil) {
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
    public func push(_ update: WarrantyUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "WarrantyStatusWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum WarrantyStrings {
    public static let table = "WarrantyStatusWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves a `WarrantyText` (key + web fallback) through the facade.
    public static func resolve(_ ref: WarrantyText) -> String {
        string(ref.key, ref.fallback)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget body. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum WarrantyAccessibility {
    public static func summary(for projection: WarrantyProjection) -> String {
        guard projection.hasData else {
            return WarrantyStrings.string("widget.warranty.noData", "No warranty data")
        }
        var parts: [String] = []

        let status = WarrantyStrings.resolve(projection.statusBadge.label)
        let daysLeft = WarrantyStrings.string("widget.warranty.daysLeft", "days left")
        parts.append("\(status), \(projection.headlineText) \(daysLeft)")

        if let mileage = projection.mileageMetric {
            let label = WarrantyStrings.resolve(mileage.label)
            parts.append("\(label): \(mileage.valueText) \(unitText(mileage.unit))")
        }

        for entry in projection.entries where entry.badge != nil {
            let label = WarrantyStrings.resolve(entry.label)
            let badge = entry.badge.map { WarrantyStrings.resolve($0.label) } ?? ""
            parts.append("\(label) \(badge)")
        }

        return parts.joined(separator: ". ")
    }

    /// Resolves a metric's trailing unit to spoken text.
    static func unitText(_ unit: WarrantyUnitLabel) -> String {
        switch unit {
        case let .symbol(symbol): symbol
        case let .localized(ref): WarrantyStrings.resolve(ref)
        }
    }
}
