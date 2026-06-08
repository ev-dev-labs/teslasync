//
//  SpeedProfileWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0095 · SpeedProfileWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through this model and
//  never performs networking itself. The grid `DashboardWidgetSize` /
//  `DashboardWidgetRegistration` types are the shared dashboard primitives
//  (defined once for the dashboard-widgets group — referenced, not redefined).
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol SpeedProfileTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogSpeedProfileTelemetry: SpeedProfileTelemetry {
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
public enum SpeedProfileLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum SpeedProfileConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SpeedProfileSource`: the cached DTO inputs
/// plus their load/connection status and the active speed preference. The model
/// turns this into the display projection.
public struct SpeedProfileUpdate: Sendable, Equatable {
    public var status: SpeedProfileLoadStatus
    public var connection: SpeedProfileConnection
    public var vehicle: SpeedProfileVehicleRef?
    public var input: SpeedProfileInput?
    public var unitLabel: String
    public var updatedAt: Date?

    public init(
        status: SpeedProfileLoadStatus = .loading,
        connection: SpeedProfileConnection = .live,
        vehicle: SpeedProfileVehicleRef? = nil,
        input: SpeedProfileInput? = nil,
        unitLabel: String = "km/h",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.input = input
        self.unitLabel = unitLabel
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP
/// analytics store + the units preference); previews and tests use
/// `InMemorySpeedProfileSource`. The view never talks to the network directly.
@MainActor
public protocol SpeedProfileSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SpeedProfileUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SpeedProfileSource`,
/// recomputes the `SpeedProfileProjection` via `SpeedProfileBuilder`, and exposes
/// a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SpeedProfileModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SpeedProfileConnection = .live
    public private(set) var projection: SpeedProfileProjection?
    public private(set) var unit: SpeedDisplayUnit = .kilometersPerHour
    public private(set) var vehicle: SpeedProfileVehicleRef?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SpeedProfileSource
    @ObservationIgnored private let telemetry: any SpeedProfileTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SpeedProfileSource,
        telemetry: any SpeedProfileTelemetry = OSLogSpeedProfileTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SpeedProfileWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry /
    /// refresh affordances.
    public func refresh() {
        source.refresh()
    }

    /// The web collapses to summary-only stats at one column (`isCompact =
    /// size.cols <= 1`). Kept for source fidelity even though the registry min is
    /// two columns (so the grid never clamps below the standard layout).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    private func apply(_ update: SpeedProfileUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        unit = SpeedDisplayUnit.fromLabel(update.unitLabel)
        projection = SpeedProfileBuilder.project(update.input, unit: unit)
        phase = Self.resolvePhase(update, hasData: projection?.hasData ?? false)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the empty state when there is no usable data; whenever a usable
    /// snapshot is known the chart renders (cached values stay visible behind
    /// refresh / errors).
    private static func resolvePhase(_ update: SpeedProfileUpdate, hasData: Bool) -> Phase {
        switch update.status {
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
public final class InMemorySpeedProfileSource: SpeedProfileSource {
    public var onUpdate: (@MainActor (SpeedProfileUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SpeedProfileUpdate?

    public init(initial: SpeedProfileUpdate? = nil) {
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
    public func push(_ update: SpeedProfileUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SpeedProfileWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time so
/// each parallel surface owns its own strings.
public enum SpeedProfileStrings {
    public static let table = "SpeedProfileWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the stat row + chart. Pure + public so
/// the a11y content can be unit-tested without rendering the view.
public enum SpeedProfileAccessibility {
    /// The spoken summary: Most Common bucket, Peak Frequency, and Sweet Spot,
    /// each labelled with the web stat label and the active speed unit.
    public static func summary(for projection: SpeedProfileProjection) -> String {
        let unit = projection.unit.symbol
        let parts = [
            "\(SpeedProfileStrings.string("widget.speedProfile.mostCommon", "Most Common")) "
                + "\(projection.peakBucket) \(unit)",
            "\(SpeedProfileStrings.string("widget.speedProfile.peakFreq", "Peak Freq")) "
                + SpeedProfileNumberFormat.percent(projection.peakFrequency),
            "\(SpeedProfileStrings.string("widget.speedProfile.sweetSpot", "Sweet Spot")) "
                + "\(projection.sweetSpot) \(unit)"
        ]
        return parts.joined(separator: ". ")
    }
}
