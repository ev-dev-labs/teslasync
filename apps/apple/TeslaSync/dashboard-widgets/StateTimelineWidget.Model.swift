//
//  StateTimelineWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0096 · StateTimelineWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through this model and
//  never performs networking itself. The grid `DashboardWidgetSize` /
//  `DashboardWidgetRegistration` types are the shared dashboard primitives
//  (defined by the 0036 DigitalTwinWidget surface — reused, not redefined).
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
public protocol STWTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct STWOSLogStateTimelineTelemetry: STWTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared
/// `LoadableState` cases the production source projects from `Resource<T>`.
public enum STWLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum STWConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `STWSource`: the cached summary
/// + timeline rows plus their load/connection status. The model turns this into
/// the display projection.
public struct STWUpdate: Sendable, Equatable {
    public var status: STWLoadStatus
    public var connection: STWConnection
    public var vehicle: StateTimelineVehicleRef?
    public var summary: [StateSummaryEntry]
    public var transitions: [StateTransitionEntry]
    public var updatedAt: Date?

    public init(
        status: STWLoadStatus = .loading,
        connection: STWConnection = .live,
        vehicle: StateTimelineVehicleRef? = nil,
        summary: [StateSummaryEntry] = [],
        transitions: [StateTransitionEntry] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.summary = summary
        self.transitions = transitions
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` over the KMP
/// analytics store — the `useStateSummary` + `useTimeline` queries); previews and
/// tests use `STWInMemoryStateTimelineSource`. The view never talks to the network.
@MainActor
public protocol STWSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (STWUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `STWSource`,
/// recomputes the `STWProjection` via `StateTimelineBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class STWModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: STWConnection = .live
    public private(set) var projection = STWProjection(segments: [], stripe: [])
    public private(set) var vehicle: StateTimelineVehicleRef?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any STWSource
    @ObservationIgnored private let telemetry: any STWTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any STWSource,
        telemetry: any STWTelemetry = STWOSLogStateTimelineTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: StateTimelineWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of both queries (cached values stay visible). Wired to
    /// the retry / refresh affordances (web `summary.refetch(); timeline.refetch()`).
    public func refresh() {
        source.refresh()
    }

    /// The web collapses to dots-only at one column (`isCompact = size.cols <= 1`).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// The web adds the 24h stripe at three+ columns (`isWide = size.cols >= 3`).
    public static func isWide(for size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: STWUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = StateTimelineBuilder.project(summary: update.summary, transitions: update.transitions)
        phase = Self.resolvePhase(update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the empty state when there are no segments; whenever data is
    /// known the content renders (cached values stay visible behind refresh/errors).
    private static func resolvePhase(_ status: STWLoadStatus, hasData: Bool) -> Phase {
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
public final class STWInMemoryStateTimelineSource: STWSource {
    public var onUpdate: (@MainActor (STWUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: STWUpdate?

    public init(initial: STWUpdate? = nil) {
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
    public func push(_ update: STWUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "StateTimelineWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time so each parallel surface owns its own strings.
public enum STWStrings {
    public static let table = "StateTimelineWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// The localized per-state label (web `t('…state.<s>', seg.state)`).
    public static func stateLabel(_ segment: StateSegment) -> String {
        string(segment.localizationKey, segment.fallbackLabel)
    }

    /// The localized `{h}h {m}m` / `{m}m` duration (web `fmtDuration`), resolving
    /// the `h` / `m` suffixes through the catalog.
    public static func duration(_ totalMin: Double) -> String {
        STWFormat.duration(
            totalMin,
            hourSuffix: string("widget.stateTimeline.hr", "h"),
            minuteSuffix: string("widget.stateTimeline.min", "m")
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the distribution bar / list. Pure +
/// public so the a11y content can be unit-tested without rendering the view.
public enum STWAccessibility {
    public static func summary(for projection: STWProjection) -> String {
        projection.segments
            .map { segment in
                let label = STWStrings.stateLabel(segment)
                let pct = STWFormat.decimal(segment.pct, fractionDigits: 1)
                return "\(label) \(pct)%, \(STWStrings.duration(segment.totalMin))"
            }
            .joined(separator: ". ")
    }
}
