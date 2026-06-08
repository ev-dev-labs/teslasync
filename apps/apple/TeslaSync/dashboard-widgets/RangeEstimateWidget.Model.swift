//
//  RangeEstimateWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0077 · RangeEstimateWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in RangeEstimateWidget.swift).
//
//  Parity target: features/dashboard/widgets/RangeEstimateWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there.
public protocol RangeEstimateTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges
/// 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogRangeEstimateTelemetry: RangeEstimateTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases the
/// production source projects from `Resource<T>`.
public enum RangeLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching`/`isStale`/`isError`.
public enum RangeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref` resolved by
/// `useUnits()` (`unitPrefs.distance`, derived from `settings.unit_of_length`).
public enum RangeDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact meters-per-unit divisor used by `convertDistanceFromSI` (NIST-grade), matching
    /// `METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT` in lib/unitConversion.ts.
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        case .feet: 0.3048
        }
    }

    /// The short symbol shown next to a value (`km` / `mi` / `ft`).
    public var symbol: String {
        rawValue
    }
}

/// The cached vehicle-state inputs this surface consumes, mirroring the subset of the web
/// `VehicleState` the widget reads (`GET /vehicles/{id}/state`). Ranges are SI/raw (METERS)
/// as delivered by the API; display conversion happens in `RangeEstimateProjector`. A non-nil
/// DTO marks "state present" (the web `state ? … : <EmptyState/>` branch); the inner range
/// fields are optional to mirror `rated_range: number | null`.
public struct RangeStateDTO: Sendable, Equatable {
    public var ratedRangeMeters: Double?
    public var idealRangeMeters: Double?

    public init(ratedRangeMeters: Double? = nil, idealRangeMeters: Double? = nil) {
        self.ratedRangeMeters = ratedRangeMeters
        self.idealRangeMeters = idealRangeMeters
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings
/// directly; the source resolves these and pushes them with each snapshot.
public struct RangeUnitPrefs: Sendable, Equatable {
    public var distance: RangeDistanceUnit
    public var localeIdentifier: String

    public init(distance: RangeDistanceUnit = .kilometers, localeIdentifier: String = "en_US") {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `RangeEstimateSource`: the cached state + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct RangeEstimateUpdate: Sendable, Equatable {
    public var status: RangeLoadStatus
    public var connection: RangeConnection
    public var isFetching: Bool
    public var state: RangeStateDTO?
    public var units: RangeUnitPrefs
    public var updatedAt: Date?

    public init(
        status: RangeLoadStatus = .loading,
        connection: RangeConnection = .live,
        isFetching: Bool = false,
        state: RangeStateDTO? = nil,
        units: RangeUnitPrefs = RangeUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.state = state
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (`StateHolderModel<LoadableState<…>>` from the KMP `VehicleStore` +
/// `SettingsStore`); previews and tests use `InMemoryRangeEstimateSource`. The view never
/// talks to the network directly.
@MainActor
public protocol RangeEstimateSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (RangeEstimateUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `RangeEstimateSource`, recomputes the
/// `RangeEstimateProjection` via `RangeEstimateProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class RangeEstimateModel {
    /// The mutually-exclusive render branches (web shell loading + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: RangeConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: RangeEstimateProjection?
    public private(set) var units = RangeUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any RangeEstimateSource
    @ObservationIgnored private let telemetry: any RangeEstimateTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any RangeEstimateSource,
        telemetry: any RangeEstimateTelemetry = OSLogRangeEstimateTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RangeEstimateSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry / refresh
    /// affordances and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the
    /// native parity of the web `DataFreshnessAuto` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: RangeEstimateUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.state.map { RangeEstimateProjector.project(state: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.state != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on
    /// the initial fetch and the empty state when there is no vehicle state; whenever state is
    /// known the values render (cached values stay visible behind refresh/transient failures so
    /// an offline or stale pod still shows the last-known range).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: RangeLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryRangeEstimateSource: RangeEstimateSource {
    public var onUpdate: (@MainActor (RangeEstimateUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RangeEstimateUpdate?

    public init(initial: RangeEstimateUpdate? = nil) {
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
    public func push(_ update: RangeEstimateUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/battery.ts → "range-estimate")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the
/// SwiftUI view so the model/adapter compile and test without SwiftUI. `RangeEstimateWidget`
/// re-exposes these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum RangeEstimateSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "RangeEstimateWidget"

    /// Canonical registry metadata (registry/battery.ts → "range-estimate").
    public static let registration = DashboardWidgetRegistration(
        id: "range-estimate",
        nameKey: "widget.rangeEstimate",
        descriptionKey: "widget.rangeEstimate.description",
        category: "battery",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 2, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "RangeEstimateWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`count` are Foundation-only
/// so the adapter's accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives
/// in the view file.
public enum RangeEstimateStrings {
    public static let table = "RangeEstimateWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
