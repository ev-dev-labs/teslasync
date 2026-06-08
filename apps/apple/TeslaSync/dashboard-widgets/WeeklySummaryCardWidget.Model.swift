//
//  WeeklySummaryCardWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0117 · WeeklySummaryCardWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). Vendor-agnostic and SwiftUI-free so the projection/model logic
//  compiles and runs on a plain host (the surface view layers SwiftUI chrome on
//  top in WeeklySummaryCardWidget.swift).
//
//  Parity target: features/dashboard/widgets/WeeklySummaryCardWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol WeeklySummaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogWeeklySummaryTelemetry: WeeklySummaryTelemetry {
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
public enum WeeklyLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013)
/// and the web `DataFreshness` chip the `WidgetShell` renders from
/// `isStale` / `isFetching`.
public enum WeeklyConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `WeeklySummarySource`: the cached digest +
/// display prefs plus their load/connection status. The model turns this into
/// the projection.
public struct WeeklySummaryUpdate: Sendable, Equatable {
    public var status: WeeklyLoadStatus
    public var connection: WeeklyConnection
    public var isFetching: Bool
    public var digest: WeeklySummaryCardWidgetDigestDTO?
    public var units: WeeklyUnitPrefs
    public var vehicle: WeeklyVehicleRef?
    public var updatedAt: Date?

    public init(
        status: WeeklyLoadStatus = .loading,
        connection: WeeklyConnection = .live,
        isFetching: Bool = false,
        digest: WeeklySummaryCardWidgetDigestDTO? = nil,
        units: WeeklyUnitPrefs = WeeklyUnitPrefs(),
        vehicle: WeeklyVehicleRef? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.digest = digest
        self.units = units
        self.vehicle = vehicle
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP
/// `AnalyticsStore` + `VehicleStore` + `SettingsStore`); previews and tests use
/// `InMemoryWeeklySummarySource`. The view never talks to the network directly.
@MainActor
public protocol WeeklySummarySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (WeeklySummaryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `WeeklySummarySource`,
/// recomputes the `WeeklySummaryProjection` via `WeeklySummaryBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class WeeklySummaryModel {
    /// The mutually-exclusive render branches (web shell loading / error + body
    /// empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: WeeklyConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: WeeklySummaryProjection?
    public private(set) var units = WeeklyUnitPrefs()
    public private(set) var vehicle: WeeklyVehicleRef?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any WeeklySummarySource
    @ObservationIgnored private let telemetry: any WeeklySummaryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any WeeklySummarySource,
        telemetry: any WeeklySummaryTelemetry = OSLogWeeklySummaryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WeeklySummarySurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry
    /// / refresh affordances and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being
    /// fetched — the native parity of the web `WidgetShell` self-refresh on a
    /// stale query.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: WeeklySummaryUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = WeeklySummaryBuilder.project(update.digest, units: update.units)
        phase = Self.resolvePhase(status: update.status, hasData: update.digest != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton
    /// shows only on the initial fetch and the empty state when there is no
    /// digest; whenever a digest is known the grid renders (cached values stay
    /// visible behind refresh/transient failures so an offline or stale pod still
    /// shows last week's numbers).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the
    /// freshness/phase logic be unit-tested from a non-isolated context under
    /// Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: WeeklyLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryWeeklySummarySource: WeeklySummarySource {
    public var onUpdate: (@MainActor (WeeklySummaryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WeeklySummaryUpdate?

    public init(initial: WeeklySummaryUpdate? = nil) {
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
    public func push(_ update: WeeklySummaryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Dashboard grid primitives (web `WidgetSize` / `WidgetDef`)

// MARK: - Registry metadata (canonical: registry/analytics.ts → "weekly-summary-card")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out
/// of the SwiftUI view so the model/adapter compile and test without SwiftUI.
/// `WeeklySummaryCardWidget` re-exposes these as `surfaceSlug` / `registration`
/// for API parity with the other surfaces.
public enum WeeklySummarySurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WeeklySummaryCardWidget"

    /// Canonical registry metadata (registry/analytics.ts → "weekly-summary-card").
    public static let registration = DashboardWidgetRegistration(
        id: "weekly-summary-card",
        nameKey: "widget.weeklySummary",
        descriptionKey: "widget.weeklySummary.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "WeeklySummaryCardWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time. `string` is Foundation-only so the adapter's accessibility summary can
/// use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum WeeklySummaryStrings {
    public static let table = "WeeklySummaryCardWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
