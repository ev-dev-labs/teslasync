//
//  RecentDrivesListWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0078 · RecentDrivesListWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in RecentDrivesListWidget.swift).
//
//  Parity target: features/dashboard/widgets/RecentDrivesListWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there.
public protocol RDListTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the
/// composition root.
public struct RDListOSLogRecentDrivesTelemetry: RDListTelemetry {
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
/// cases the production source projects from `Resource<[Drive]>`.
public enum RDListLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the
/// web `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale`.
public enum RDListConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`) resolved by `useUnits()`.
public enum RecentDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact meters-per-unit divisor used by `convertDistanceFromSI` (NIST-grade),
    /// matching `lib/unitConversion.ts` (`METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT`).
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

/// One cached drive row this surface consumes, mirroring the subset of the web `Drive`
/// DTO the widget reads (`GET /drives?vehicle_id=…&limit=…`). All fields are SI/raw as
/// delivered by the API; display conversion happens in `RecentDrivesProjector`.
public struct RecentDriveDTO: Sendable, Equatable, Identifiable {
    public var id: Int
    public var distanceM: Double
    public var durationS: Double
    public var startSocPct: Double?
    public var endSocPct: Double?
    public var startAddress: String?
    public var endAddress: String?
    public var startTimestamp: Date?

    public init(
        id: Int,
        distanceM: Double = 0,
        durationS: Double = 0,
        startSocPct: Double? = nil,
        endSocPct: Double? = nil,
        startAddress: String? = nil,
        endAddress: String? = nil,
        startTimestamp: Date? = nil
    ) {
        self.id = id
        self.distanceM = distanceM
        self.durationS = durationS
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.startTimestamp = startTimestamp
    }
}

/// The user's display preferences, mirroring `useUnits()` + `useDateFormat()`. The view
/// never reads settings directly; the source resolves these and pushes them per snapshot.
public struct RecentDrivesUnitPrefs: Sendable, Equatable {
    public var distance: RecentDistanceUnit
    public var localeIdentifier: String
    public var timeZoneIdentifier: String

    public init(
        distance: RecentDistanceUnit = .kilometers,
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String = "UTC"
    ) {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }
}

/// One coalesced snapshot pushed by a `RDListSource`: the cached drives + display
/// prefs plus their load/connection status. The model turns this into the projection.
public struct RDListUpdate: Sendable, Equatable {
    public var status: RDListLoadStatus
    public var connection: RDListConnection
    public var isFetching: Bool
    public var drives: [RecentDriveDTO]?
    public var units: RecentDrivesUnitPrefs
    public var updatedAt: Date?

    public init(
        status: RDListLoadStatus = .loading,
        connection: RDListConnection = .live,
        isFetching: Bool = false,
        drives: [RecentDriveDTO]? = nil,
        units: RecentDrivesUnitPrefs = RecentDrivesUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.drives = drives
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (`StateHolderModel<LoadableState<[Drive]>>` from the KMP `DrivingStore` +
/// `VehicleStore` + `SettingsStore`); previews and tests use `RDListInMemoryRecentDrivesSource`.
/// The view never talks to the network directly.
@MainActor
public protocol RDListSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (RDListUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `RDListSource`, exposes the
/// cached drives + display prefs and a render `Phase` + freshness for SwiftUI to switch over.
/// The size-dependent projection (limit + address columns) is computed by the view via
/// `RecentDrivesProjector`, mirroring the web `useMemo` derive from `drives` + `size`.
@MainActor
@Observable
public final class RDListModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / list).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: RDListConnection = .live
    public private(set) var isFetching = false
    public private(set) var drives: [RecentDriveDTO] = []
    public private(set) var units = RecentDrivesUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any RDListSource
    @ObservationIgnored private let telemetry: any RDListTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any RDListSource,
        telemetry: any RDListTelemetry = RDListOSLogRecentDrivesTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RDListSurface.slug)
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

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the
    /// native parity of the web `DataFreshnessAuto` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: RDListUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        drives = update.drives ?? []
        phase = Self.resolvePhase(status: update.status, hasRows: !(update.drives ?? []).isEmpty)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on
    /// the initial fetch and the empty state when there are no drives; whenever rows are known
    /// the list renders (cached rows stay visible behind refresh/transient failures so an
    /// offline or stale pod still shows the last-known drives).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: RDListLoadStatus,
        hasRows: Bool
    ) -> Phase {
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
public final class RDListInMemoryRecentDrivesSource: RDListSource {
    public var onUpdate: (@MainActor (RDListUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RDListUpdate?

    public init(initial: RDListUpdate? = nil) {
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
    public func push(_ update: RDListUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/driving.ts → "recent-drives-list")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the
/// SwiftUI view so the model/adapter compile and test without SwiftUI. `RecentDrivesListWidget`
/// re-exposes these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum RDListSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "RecentDrivesListWidget"

    /// Canonical registry metadata (registry/driving.ts → "recent-drives-list").
    public static let registration = DashboardWidgetRegistration(
        id: "recent-drives-list",
        nameKey: "widget.recentDrivesList",
        descriptionKey: "widget.recentDrivesList.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "RecentDrivesListWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the
/// adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` helper lives in the
/// view file.
public enum RDListStrings {
    public static let table = "RecentDrivesListWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }
}
