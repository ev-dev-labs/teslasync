//
//  SoftwareUpdateStatusWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary.
//
//  NOTE: `DashboardWidgetSize` / `DashboardWidgetRegistration` are the canonical
//  dashboard-grid types declared once for the dashboard-widgets bundle (in
//  Sources/DashboardWidgets/DashboardWidgetInfra.swift). This surface *references*
//  them so it registers with the same grid system — it must not redefine them
//  (duplicate symbols).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol SoftwareStatusTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSoftwareStatusTelemetry: SoftwareStatusTelemetry {
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
public enum SoftwareStatusLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum SoftwareStatusConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SoftwareStatusSource`: the cached input
/// (the vehicle `software_version` + the latest update fields) + its
/// load/connection status. The model turns this into the `SoftwareStatusProjection`.
public struct SoftwareStatusSnapshot: Sendable, Equatable {
    public var status: SoftwareStatusLoadStatus
    public var connection: SoftwareStatusConnection
    /// The cached input (web `state` + `configData`); `nil` is the resolved-but-empty
    /// "No software data" state.
    public var input: SoftwareStatusInput?
    public var updatedAt: Date?

    public init(
        status: SoftwareStatusLoadStatus = .loading,
        connection: SoftwareStatusConnection = .live,
        input: SoftwareStatusInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.input = input
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `useVehicleState` + `useVehicleConfigLatest`
/// equivalents — `StateHolderModel<LoadableState<…>>` over the KMP `VehiclesStore`);
/// previews and tests use `InMemorySoftwareStatusSource`. The view never talks to
/// the network directly.
@MainActor
public protocol SoftwareStatusSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SoftwareStatusSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SoftwareStatusSource`,
/// recomputes the `SoftwareStatusProjection` via `SoftwareStatusProjectionBuilder`,
/// and exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SoftwareStatusModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SoftwareStatusConnection = .live
    public private(set) var projection: SoftwareStatusProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SoftwareStatusSource
    @ObservationIgnored private let telemetry: any SoftwareStatusTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SoftwareStatusSource,
        telemetry: any SoftwareStatusTelemetry = OSLogSoftwareStatusTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] snapshot in self?.apply(snapshot) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SoftwareUpdateStatusWidget.surfaceSlug)
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

    private func apply(_ snapshot: SoftwareStatusSnapshot) {
        connection = snapshot.connection
        updatedAt = snapshot.updatedAt
        projection = SoftwareStatusProjectionBuilder.build(input: snapshot.input)
        phase = Self.resolvePhase(status: snapshot.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when no `state` resolved; whenever a vehicle state
    /// is present the content renders (cached values stay visible behind
    /// refresh/errors).
    static func resolvePhase(status: SoftwareStatusLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemorySoftwareStatusSource: SoftwareStatusSource {
    public var onUpdate: (@MainActor (SoftwareStatusSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SoftwareStatusSnapshot?

    public init(initial: SoftwareStatusSnapshot? = nil) {
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
    public func push(_ snapshot: SoftwareStatusSnapshot) {
        onUpdate?(snapshot)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SoftwareUpdateStatusWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SoftwareStatusStrings {
    public static let table = "SoftwareUpdateStatusWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `SoftwareStatusText` (key + web fallback) through the facade.
    public static func resolve(_ ref: SoftwareStatusText) -> String {
        string(ref.key, ref.fallback)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget body. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum SoftwareStatusAccessibility {
    public static func summary(for projection: SoftwareStatusProjection) -> String {
        guard projection.hasData else {
            return SoftwareStatusStrings.string("widget.noSoftwareData", "No software data")
        }
        var parts: [String] = [SoftwareStatusStrings.resolve(projection.statusBadge.label)]

        let versionLabel = SoftwareStatusStrings.string("widget.currentVersion", "Current Version")
        parts.append("\(versionLabel): \(projection.currentVersion)")

        if let updateVersion = projection.updateVersion {
            let updateLabel = SoftwareStatusStrings.string("widget.updateAvailable", "Update")
            parts.append("\(updateLabel): \(updateVersion)")
        }

        if let progress = projection.progress {
            let label = SoftwareStatusStrings.resolve(progress.label)
            parts.append("\(label): \(progress.percentText)")
        } else if projection.stage == .ready {
            parts.append(SoftwareStatusStrings.string("widget.readyToInstall", "Ready to install"))
        } else if projection.stage == .upToDate {
            parts.append(SoftwareStatusStrings.string("widget.upToDate", "Up to date"))
        }

        return parts.joined(separator: ". ")
    }
}
