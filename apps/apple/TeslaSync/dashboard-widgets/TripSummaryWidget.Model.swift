//
//  TripSummaryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0103 · TripSummaryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in TripSummaryWidget.swift).
//
//  Parity target: features/dashboard/widgets/TripSummaryWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted.
public protocol TripSummaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event. Bridges
/// 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogTripSummaryTelemetry: TripSummaryTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases the
/// production source projects from `Resource<[Trip]>`.
public enum TripSummaryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale`.
public enum TripSummaryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`) resolved by `useUnits()`.
public enum TripDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact meters-per-unit divisor used by `convertDistanceFromSI` (NIST-grade), matching
    /// `lib/unitConversion.ts` (`METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT`).
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

/// One cached trip this surface consumes, mirroring the subset of the web `Trip` DTO the widget
/// reads (`GET /trips?vehicle_id=…&limit=5`): name, start/end date, total distance (SI meters),
/// drive + charge counts. Display conversion happens in `TripSummaryProjector`.
public struct TripSummaryDTO: Sendable, Equatable, Identifiable {
    public var id: Int
    public var name: String?
    public var startDate: Date?
    public var endDate: Date?
    public var totalDistanceM: Double
    public var driveCount: Int
    public var chargeCount: Int

    public init(
        id: Int,
        name: String? = nil,
        startDate: Date? = nil,
        endDate: Date? = nil,
        totalDistanceM: Double = 0,
        driveCount: Int = 0,
        chargeCount: Int = 0
    ) {
        self.id = id
        self.name = name
        self.startDate = startDate
        self.endDate = endDate
        self.totalDistanceM = totalDistanceM
        self.driveCount = driveCount
        self.chargeCount = chargeCount
    }
}

/// The user's display preferences, mirroring `useUnits()` + `useDateFormat()`. The view never
/// reads settings directly; the source resolves these and pushes them per snapshot.
public struct TripSummaryUnitPrefs: Sendable, Equatable {
    public var distance: TripDistanceUnit
    public var localeIdentifier: String
    public var timeZoneIdentifier: String

    public init(
        distance: TripDistanceUnit = .kilometers,
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String = "UTC"
    ) {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }
}

/// One coalesced snapshot pushed by a `TripSummarySource`: the cached trips + display prefs plus
/// their load/connection status. The model turns this into the projection.
public struct TripSummaryUpdate: Sendable, Equatable {
    public var status: TripSummaryLoadStatus
    public var connection: TripSummaryConnection
    public var isFetching: Bool
    public var trips: [TripSummaryDTO]?
    public var units: TripSummaryUnitPrefs
    public var updatedAt: Date?

    public init(
        status: TripSummaryLoadStatus = .loading,
        connection: TripSummaryConnection = .live,
        isFetching: Bool = false,
        trips: [TripSummaryDTO]? = nil,
        units: TripSummaryUnitPrefs = TripSummaryUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.trips = trips
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (`StateHolderModel<LoadableState<[Trip]>>` from the KMP `TripsStore` +
/// `VehicleStore` + `SettingsStore`); previews and tests use `InMemoryTripSummarySource`. The
/// view never talks to the network directly.
@MainActor
public protocol TripSummarySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (TripSummaryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `TripSummarySource`, exposes the cached
/// trips + display prefs and a render `Phase` + freshness for SwiftUI to switch over. The
/// size-dependent projection (compact vs wide) is computed by the view via `TripSummaryProjector`,
/// mirroring the web `useMemo` derive from `trips` + `size`.
@MainActor
@Observable
public final class TripSummaryModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / content).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: TripSummaryConnection = .live
    public private(set) var isFetching = false
    public private(set) var trips: [TripSummaryDTO] = []
    public private(set) var units = TripSummaryUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TripSummarySource
    @ObservationIgnored private let telemetry: any TripSummaryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TripSummarySource,
        telemetry: any TripSummaryTelemetry = OSLogTripSummaryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TripSummarySurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached rows stay visible). Wired to the retry / refresh
    /// affordances and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web `DataFreshnessAuto` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: TripSummaryUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        trips = update.trips ?? []
        phase = Self.resolvePhase(status: update.status, hasRows: !(update.trips ?? []).isEmpty)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there are no trips; whenever rows are known the
    /// content renders (cached rows stay visible behind refresh / transient failures so an offline
    /// or stale pod still shows the last-known trips).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: TripSummaryLoadStatus, hasRows: Bool) -> Phase {
        switch status {
        case .loading:
            hasRows ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasRows ? .content : .empty
        case let .failed(message):
            hasRows ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTripSummarySource: TripSummarySource {
    public var onUpdate: (@MainActor (TripSummaryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TripSummaryUpdate?

    public init(initial: TripSummaryUpdate? = nil) {
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
    public func push(_ update: TripSummaryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/driving.ts → "trip-summary")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `TripSummaryWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum TripSummarySurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "TripSummaryWidget"

    /// The number of trips the production source fetches (web `useTrips({ limit: 5 })`).
    public static let fetchLimit = 5

    /// Canonical registry metadata (registry/driving.ts → "trip-summary").
    public static let registration = DashboardWidgetRegistration(
        id: "trip-summary",
        nameKey: "widget.tripSummary",
        descriptionKey: "widget.tripSummary.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "TripSummaryWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the
/// adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` helper lives in the
/// view file.
public enum TripSummaryStrings {
    public static let table = "TripSummaryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }
}
