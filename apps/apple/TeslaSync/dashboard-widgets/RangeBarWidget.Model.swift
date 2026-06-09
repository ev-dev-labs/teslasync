//
//  RangeBarWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0076 · RangeBarWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in RangeBarWidget.swift).
//
//  Parity target: features/dashboard/widgets/RangeBarWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there.
public protocol RangeBarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges
/// 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogRangeBarTelemetry: RangeBarTelemetry {
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
public enum RangeBarLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching`/`isStale`/`isError`.
public enum RangeBarConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref` resolved by
/// `useUnits()` (`unitPrefs.distance`, derived from `settings.unit_of_length`).
public enum RangeBarDistanceUnit: String, Sendable, Equatable, CaseIterable {
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
/// as delivered by the API; display conversion happens in `RangeBarProjector`. A non-nil
/// DTO marks "state present"; the web `hasData` additionally requires a positive rated or
/// ideal range, so the inner fields are optional to mirror `rated_range: number | null`.
public struct RangeBarStateDTO: Sendable, Equatable {
    public var ratedRangeMeters: Double?
    public var idealRangeMeters: Double?

    public init(ratedRangeMeters: Double? = nil, idealRangeMeters: Double? = nil) {
        self.ratedRangeMeters = ratedRangeMeters
        self.idealRangeMeters = idealRangeMeters
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings
/// directly; the source resolves these and pushes them with each snapshot.
public struct RangeBarUnitPrefs: Sendable, Equatable {
    public var distance: RangeBarDistanceUnit
    public var localeIdentifier: String

    public init(distance: RangeBarDistanceUnit = .kilometers, localeIdentifier: String = "en_US") {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `RangeBarSource`: the cached state + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct RangeBarUpdate: Sendable, Equatable {
    public var status: RangeBarLoadStatus
    public var connection: RangeBarConnection
    public var isFetching: Bool
    public var state: RangeBarStateDTO?
    public var units: RangeBarUnitPrefs
    public var updatedAt: Date?

    public init(
        status: RangeBarLoadStatus = .loading,
        connection: RangeBarConnection = .live,
        isFetching: Bool = false,
        state: RangeBarStateDTO? = nil,
        units: RangeBarUnitPrefs = RangeBarUnitPrefs(),
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
/// `SettingsStore`); previews and tests use `InMemoryRangeBarSource`. The view never talks to
/// the network directly.
@MainActor
public protocol RangeBarSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (RangeBarUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `RangeBarSource`, recomputes the
/// `RangeBarProjection` via `RangeBarProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class RangeBarModel {
    /// The mutually-exclusive render branches (web shell loading + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: RangeBarConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: RangeBarProjection?
    public private(set) var units = RangeBarUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any RangeBarSource
    @ObservationIgnored private let telemetry: any RangeBarTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any RangeBarSource,
        telemetry: any RangeBarTelemetry = OSLogRangeBarTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RangeBarSurface.slug)
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

    private func apply(_ update: RangeBarUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        let renderable = update.state.map { RangeBarProjector.hasData(state: $0) } ?? false
        projection = renderable
            ? update.state.map { RangeBarProjector.project(state: $0, units: update.units) }
            : nil
        phase = Self.resolvePhase(status: update.status, hasData: renderable)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on
    /// the initial fetch and the empty state whenever there is no positive range to show
    /// (`hasData = state != null && (rated > 0 || ideal > 0)`); whenever a range is known the
    /// bars render (cached values stay visible behind refresh/transient failures so an offline
    /// or stale pod still shows the last-known range).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: RangeBarLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryRangeBarSource: RangeBarSource {
    public var onUpdate: (@MainActor (RangeBarUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RangeBarUpdate?

    public init(initial: RangeBarUpdate? = nil) {
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
    public func push(_ update: RangeBarUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/battery.ts → "range-bar")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the
/// SwiftUI view so the model/adapter compile and test without SwiftUI. `RangeBarWidget`
/// re-exposes these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum RangeBarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "RangeBarWidget"

    /// Canonical registry metadata (registry/battery.ts → "range-bar").
    public static let registration = DashboardWidgetRegistration(
        id: "range-bar",
        nameKey: "widget.rangeBar.name",
        descriptionKey: "widget.rangeBar.description",
        category: "battery",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "RangeBarWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`count` are Foundation-only
/// so the adapter's accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives
/// in the view file.
public enum RangeBarStrings {
    public static let table = "RangeBarWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
