//
//  VehicleSpecsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0109 · VehicleSpecsWidget (Apple)
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
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol SpecsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSpecsTelemetry: SpecsTelemetry {
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
public enum SpecsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum SpecsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `VehicleSpecsSource`: the raw specs /
/// options / config envelopes + the localized labels + their load/connection
/// status. The model turns this into the `SpecsProjection`.
public struct VehicleSpecsUpdate: Sendable, Equatable {
    public var status: SpecsLoadStatus
    public var connection: SpecsConnection
    public var specs: RawVehicleSpecs?
    public var config: RawVehicleConfig?
    public var options: [SpecOption]?
    public var labels: SpecsLabels
    public var updatedAt: Date?

    public init(
        status: SpecsLoadStatus = .loading,
        connection: SpecsConnection = .live,
        specs: RawVehicleSpecs? = nil,
        config: RawVehicleConfig? = nil,
        options: [SpecOption]? = nil,
        labels: SpecsLabels = .default,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.specs = specs
        self.config = config
        self.options = options
        self.labels = labels
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `useVehicleSpecs` / `useVehicleOptions` /
/// `useVehicleConfigLatest` equivalents — `StateHolderModel<LoadableState<…>>`
/// over the KMP `VehicleStore`); previews and tests use `InMemorySpecsSource`.
/// The view never talks to the network directly.
@MainActor
public protocol VehicleSpecsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (VehicleSpecsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `VehicleSpecsSource`,
/// recomputes the `SpecsProjection` via `SpecsProjectionBuilder`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class VehicleSpecsModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SpecsConnection = .live
    public private(set) var projection: SpecsProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VehicleSpecsSource
    @ObservationIgnored private let telemetry: any SpecsTelemetry
    @ObservationIgnored private var started = false

    public init(source: any VehicleSpecsSource, telemetry: any SpecsTelemetry = OSLogSpecsTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleSpecsWidget.surfaceSlug)
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

    private func apply(_ update: VehicleSpecsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = SpecsProjectionBuilder.build(
            specs: update.specs,
            config: update.config,
            options: update.options,
            labels: update.labels
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when nothing resolved; whenever any data is known
    /// the content renders (cached values stay visible behind refresh/errors).
    static func resolvePhase(status: SpecsLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemorySpecsSource: VehicleSpecsSource {
    public var onUpdate: (@MainActor (VehicleSpecsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleSpecsUpdate?

    public init(initial: VehicleSpecsUpdate? = nil) {
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
    public func push(_ update: VehicleSpecsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "VehicleSpecsWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SpecsStrings {
    public static let table = "VehicleSpecsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// Builds the localized label context the projection threads from the catalog.
    public static func labels() -> SpecsLabels {
        SpecsLabels(
            model: string("widget.specs.model", "Model"),
            trim: string("widget.specs.trim", "Trim"),
            paint: string("widget.specs.paint", "Paint Color"),
            wheels: string("widget.specs.wheels", "Wheels"),
            interior: string("widget.specs.interior", "Interior"),
            auxBattery: string("widget.specs.auxBattery", "Aux Battery"),
            carVersion: string("widget.specs.carVersion", "Car Version"),
            option: string("widget.specs.option", "Option")
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget body. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum SpecsAccessibility {
    public static func summary(for projection: SpecsProjection) -> String {
        let fixed = projection.entries.filter { $0.badge == nil }
        let optionCount = projection.entries.count(where: { $0.badge != nil })

        var parts = fixed
            .filter { $0.value != SpecsProjectionConstants.dash }
            .map { "\($0.label): \($0.value)" }

        if optionCount > 0 {
            parts.append(SpecsStrings.count("widget.specs.optionsCount", "%lld options", optionCount))
        }

        guard !parts.isEmpty else {
            return SpecsStrings.string("widget.specs.noData", "No specs available")
        }
        return parts.joined(separator: ". ")
    }
}
