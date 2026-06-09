//
//  FSMDistributionWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0052 · FSMDistributionWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model and the testable accessibility summaries. The view
//  binds through `FSMDistributionModel`; no networking lives here.
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
public protocol FSMDistributionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogFSMDistributionTelemetry: FSMDistributionTelemetry {
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
public enum FSMDistributionLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum FSMDistributionConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `FSMDistributionSource`: the per-state
/// durations + recent transitions + the scoped vehicle + load/connection status.
/// The model turns this into the rendered projection.
public struct FSMDistributionUpdate: Sendable, Equatable {
    public var status: FSMDistributionLoadStatus
    public var connection: FSMDistributionConnection
    public var vehicle: FSMVehicle?
    public var durations: [FSMStateDuration]
    public var transitions: [FSMStateTransitionDTO]
    public var updatedAt: Date?

    public init(
        status: FSMDistributionLoadStatus = .loading,
        connection: FSMDistributionConnection = .live,
        vehicle: FSMVehicle? = nil,
        durations: [FSMStateDuration] = [],
        transitions: [FSMStateTransitionDTO] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.durations = durations
        self.transitions = transitions
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useFSMStats` + `useFSMTransitions` projected from
/// the KMP FSM store, with `useVehicles` supplying the scoped id); previews and
/// tests use `InMemoryFSMDistributionSource`. The view never talks to the network.
@MainActor
public protocol FSMDistributionSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (FSMDistributionUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to an `FSMDistributionSource`,
/// recomputes the `FSMDistributionProjection` via `FSMDistributionBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class FSMDistributionModel {
    /// The mutually-exclusive render branches (web shell loading + the
    /// donut/empty split).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: FSMDistributionConnection = .live
    public private(set) var projection: FSMDistributionProjection = .empty
    public private(set) var vehicle: FSMVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any FSMDistributionSource
    @ObservationIgnored private let telemetry: any FSMDistributionTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any FSMDistributionSource,
        telemetry: any FSMDistributionTelemetry = OSLogFSMDistributionTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FSMDistributionWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances and the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Compact (current-state-only, no donut) when the widget is a single column
    /// — the web `isCompact = size.cols <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    private func apply(_ update: FSMDistributionUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = FSMDistributionBuilder.buildProjection(
            durations: update.durations,
            rows: update.transitions
        )
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No state data" empty whenever there are no
    /// segments; a cached donut stays visible behind a refresh/offline/error so a
    /// transient failure never blanks a populated widget.
    static func resolvePhase(
        status: FSMDistributionLoadStatus,
        projection: FSMDistributionProjection
    ) -> Phase {
        switch status {
        case .loading:
            projection.hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            projection.hasData ? .content : .empty
        case let .failed(message):
            projection.hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryFSMDistributionSource: FSMDistributionSource {
    public var onUpdate: (@MainActor (FSMDistributionUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FSMDistributionUpdate?

    public init(initial: FSMDistributionUpdate? = nil) {
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
    public func push(_ update: FSMDistributionUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "FSMDistributionWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum FSMDistributionStrings {
    public static let table = "FSMDistributionWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// The display label for a state — the web `t('widget.fsmDistribution.state.<state>', state)`
    /// resolved through the catalog (lowercased key), then title-cased to match the
    /// web's CSS `capitalize`. A blank state reads as the universal "—".
    public static func stateLabel(_ state: String) -> String {
        let trimmed = state.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != "—" else { return "—" }
        let resolved = string("widget.fsmDistribution.state.\(trimmed.lowercased())", trimmed)
        return resolved.capitalized
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver summaries spoken for the donut + transition rows. Pure +
/// public so the a11y content can be unit-tested without rendering the view.
public enum FSMDistributionAccessibility {
    /// Donut summary: "<State> <duration> <pct>%, …" for each segment largest-first,
    /// or the empty copy when there is no state data. The localized `h`/`m`
    /// suffixes are injected so the spoken duration is localized.
    public static func summary(
        for projection: FSMDistributionProjection,
        hourUnit: String,
        minuteUnit: String
    ) -> String {
        guard projection.hasData else {
            return FSMDistributionStrings.string("widget.fsmDistribution.noDataLong", "No state data available")
        }
        return projection.segments.map { segment in
            let label = FSMDistributionStrings.stateLabel(segment.state)
            let duration = FSMDistributionFormat.duration(
                milliseconds: segment.milliseconds,
                hourUnit: hourUnit,
                minuteUnit: minuteUnit
            )
            let percent = FSMDistributionFormat.number(segment.percent, decimals: 0)
            return "\(label) \(duration) \(percent)%"
        }.joined(separator: ", ")
    }

    /// Transition-row summary: "<from> <connector> <to>, <relative time>"
    /// (the connector is localized, web visual "→").
    public static func transitionLabel(_ item: FSMTransitionItem, now: Date) -> String {
        let from = FSMDistributionStrings.stateLabel(item.fromState)
        let connector = FSMDistributionStrings.string("widget.fsmDistribution.transitionConnector", "to")
        let toState = FSMDistributionStrings.stateLabel(item.toState)
        guard let timestamp = item.timestamp else { return "\(from) \(connector) \(toState)" }
        let time = FSMRelativeTime.string(for: timestamp, relativeTo: now)
        return "\(from) \(connector) \(toState), \(time)"
    }
}
