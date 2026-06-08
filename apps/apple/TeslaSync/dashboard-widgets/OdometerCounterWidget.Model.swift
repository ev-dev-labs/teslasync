//
//  OdometerCounterWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0070 · OdometerCounterWidget (Apple)
//
//  The state-holder seam (P1/S8), telemetry seam (P1/S11), dashboard registry
//  types, the P1/S10 localization facade, and the surface's `@Observable` model.
//  The view binds through `OdometerSource` and never performs networking itself.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for a surface.
/// The default implementation logs via `os.Logger`; the production app injects an
/// adapter that forwards to the shared core `Telemetry.track(.screenView(…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol OdometerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogOdometerTelemetry: OdometerTelemetry {
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
public enum OdometerLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum OdometerConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `OdometerSource`: the cached inputs plus
/// their load/connection status. The model turns this into the projection + phase.
public struct OdometerUpdate: Sendable, Equatable {
    public var status: OdometerLoadStatus
    public var connection: OdometerConnection
    public var input: OdometerInput
    public var updatedAt: Date?

    public init(
        status: OdometerLoadStatus = .loading,
        connection: OdometerConnection = .live,
        input: OdometerInput = OdometerInput(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.input = input
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP
/// `VehicleStore` + `DrivingStore`, plus the units preference); previews and tests
/// use `InMemoryOdometerSource`. The view never talks to the network directly.
@MainActor
public protocol OdometerSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (OdometerUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryOdometerSource: OdometerSource {
    public var onUpdate: (@MainActor (OdometerUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: OdometerUpdate?

    public init(initial: OdometerUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: OdometerUpdate) {
        onUpdate?(update)
    }
}

// MARK: - View model

/// The widget's observable view-model. Subscribes to an `OdometerSource`, rebuilds
/// the `OdometerProjection` via `OdometerProjectionBuilder`, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over. Cached values stay visible
/// behind refresh/errors, matching the web shell.
@MainActor
@Observable
public final class OdometerCounterModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown,
    /// plus a no-data error branch with retry per the prompt's state matrix).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: OdometerConnection = .live
    public private(set) var projection: OdometerProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any OdometerSource
    @ObservationIgnored private let telemetry: any OdometerTelemetry
    @ObservationIgnored private let localeIdentifier: String
    @ObservationIgnored private var started = false

    public init(
        source: any OdometerSource,
        telemetry: any OdometerTelemetry = OSLogOdometerTelemetry(),
        localeIdentifier: String = Locale.current.identifier
    ) {
        self.source = source
        self.telemetry = telemetry
        self.localeIdentifier = localeIdentifier
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: OdometerCounterWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: OdometerUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = OdometerProjectionBuilder.build(from: update.input, localeIdentifier: localeIdentifier)
        phase = Self.resolvePhase(update.status, projection: projection)
    }

    /// Resolves the render phase. Whenever a reading is known the content renders
    /// (cached values survive refresh/errors, matching the web shell). With no
    /// reading: skeleton on the initial fetch, the empty state once loaded, and a
    /// retryable error when the fetch failed outright.
    static func resolvePhase(_ status: OdometerLoadStatus, projection: OdometerProjection) -> Phase {
        if projection.hasOdometer {
            return .content
        }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .empty, .loaded:
            return .empty
        }
    }
}

// MARK: - Registry metadata (canonical: registry/vehicle.ts → "odometer-counter")

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "OdometerCounterWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum OdometerStrings {
    public static let table = "OdometerCounterWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver label for the odometer readout. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum OdometerAccessibility {
    /// The spoken label for the content readout, e.g. "Total Odometer: 12,345 km".
    public static func readoutLabel(for projection: OdometerProjection) -> String {
        let title = OdometerStrings.string("widget.odometer.total", "Total Odometer")
        return "\(title): \(projection.odometerWithUnit)"
    }

    /// The spoken label for the empty state (web `EmptyState` message).
    public static func emptyLabel() -> String {
        OdometerStrings.string("widget.odometer.noData", "No odometer data")
    }
}
