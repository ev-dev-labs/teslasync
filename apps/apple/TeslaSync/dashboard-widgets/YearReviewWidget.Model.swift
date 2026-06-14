//
//  YearReviewWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0118 · YearReviewWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in YearReviewWidget.swift).
//
//  Parity target: features/dashboard/widgets/YearReviewWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted there.
public protocol YearReviewTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to
/// the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogYearReviewTelemetry: YearReviewTelemetry {
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
/// production source projects from `Resource<T>` (web `isLoading` / `isError` / data present).
public enum YearReviewLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip / `isStale` flag the `WidgetShell` renders.
public enum YearReviewConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`) resolved by `useUnits()`.
public enum YearReviewDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact meters-per-unit divisor used by `convertDistanceFromSI` (NIST-grade, lib/unitConversion.ts).
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

/// The user's speed display preference. Mirrors the web `SpeedUnitPref` (`'km/h' | 'mph'`)
/// resolved by `useUnits()`.
public enum YearReviewSpeedUnit: String, Sendable, Equatable, CaseIterable {
    case kilometersPerHour = "km/h"
    case milesPerHour = "mph"

    /// The short symbol shown next to a value (`km/h` / `mph`).
    public var symbol: String {
        rawValue
    }
}

/// One month's drive tally, the subset of the web `YearReviewMonthStat` the widget reads to pick
/// the busiest month (`month` is 1-based as the API delivers it).
public struct YearReviewMonthlyStat: Sendable, Equatable {
    public var month: Int
    public var drives: Int

    public init(month: Int, drives: Int) {
        self.month = month
        self.drives = drives
    }
}

/// The cached year-in-review inputs this surface consumes, mirroring the subset of the web
/// `YearReview` DTO the widget reads (`GET /analytics/year-review`). All distances are kilometres
/// and speeds km/h as the API delivers them; display conversion happens in `YearReviewProjector`.
public struct YearReviewDTO: Sendable, Equatable {
    public var totalDrives: Int
    public var totalDistanceKm: Double
    public var totalEnergyKwh: Double
    public var co2OffsetKg: Double
    public var totalDrivingMinutes: Double
    public var longestDriveKm: Double?
    public var fastestSpeedKmh: Double
    public var monthlyStats: [YearReviewMonthlyStat]

    public init(
        totalDrives: Int = 0,
        totalDistanceKm: Double = 0,
        totalEnergyKwh: Double = 0,
        co2OffsetKg: Double = 0,
        totalDrivingMinutes: Double = 0,
        longestDriveKm: Double? = nil,
        fastestSpeedKmh: Double = 0,
        monthlyStats: [YearReviewMonthlyStat] = []
    ) {
        self.totalDrives = totalDrives
        self.totalDistanceKm = totalDistanceKm
        self.totalEnergyKwh = totalEnergyKwh
        self.co2OffsetKg = co2OffsetKg
        self.totalDrivingMinutes = totalDrivingMinutes
        self.longestDriveKm = longestDriveKm
        self.fastestSpeedKmh = fastestSpeedKmh
        self.monthlyStats = monthlyStats
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings directly;
/// the source resolves these and pushes them with each snapshot.
public struct YearReviewUnitPrefs: Sendable, Equatable {
    public var distance: YearReviewDistanceUnit
    public var speed: YearReviewSpeedUnit
    public var localeIdentifier: String

    public init(
        distance: YearReviewDistanceUnit = .kilometers,
        speed: YearReviewSpeedUnit = .kilometersPerHour,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.speed = speed
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `YearReviewWidgetSource`: the cached DTO + display prefs + the
/// recap year plus their load/connection status. The model turns this into the projection. The
/// `year` mirrors the web `new Date().getFullYear()` the source resolves for both the query and
/// the title/caption.
public struct YearReviewUpdate: Sendable, Equatable {
    public var status: YearReviewLoadStatus
    public var connection: YearReviewConnection
    public var isFetching: Bool
    public var stats: YearReviewDTO?
    public var units: YearReviewUnitPrefs
    public var year: Int
    public var updatedAt: Date?

    public init(
        status: YearReviewLoadStatus = .loading,
        connection: YearReviewConnection = .live,
        isFetching: Bool = false,
        stats: YearReviewDTO? = nil,
        units: YearReviewUnitPrefs = YearReviewUnitPrefs(),
        year: Int = YearReviewUpdate.currentYear,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.stats = stats
        self.units = units
        self.year = year
        self.updatedAt = updatedAt
    }

    /// The device's current calendar year — the web widget's `new Date().getFullYear()` default.
    public static var currentYear: Int {
        Calendar(identifier: .gregorian).component(.year, from: Date())
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<…>>` from the KMP `AnalyticsStore.yearReview` +
/// `VehicleStore` first-vehicle fallback + `SettingsStore` units); previews and tests use
/// `YearReviewWidgetInMemoryYearReviewSource`. The view never talks to the network directly.
@MainActor
public protocol YearReviewWidgetSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (YearReviewUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `YearReviewWidgetSource`, recomputes the
/// `YearReviewProjection` via `YearReviewProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class YearReviewModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: YearReviewConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: YearReviewProjection?
    public private(set) var units = YearReviewUnitPrefs()
    public private(set) var year = YearReviewUpdate.currentYear
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any YearReviewWidgetSource
    @ObservationIgnored private let telemetry: any YearReviewTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any YearReviewWidgetSource,
        telemetry: any YearReviewTelemetry = OSLogYearReviewTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: YearReviewSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry / refresh
    /// affordances (web `refetch`) and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web `DataFreshnessAuto` self-refresh on `isStale` queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: YearReviewUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        year = update.year
        updatedAt = update.updatedAt
        projection = update.stats.map { YearReviewProjector.project(stats: $0, units: update.units, year: update.year) }
        phase = Self.resolvePhase(status: update.status, hasData: update.stats != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there is no recap; whenever stats are known the grid
    /// renders (cached values stay visible behind refresh/transient failures so an offline or stale
    /// pod still shows the last-known recap).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: YearReviewLoadStatus, hasData: Bool) -> Phase {
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
public final class YearReviewWidgetInMemoryYearReviewSource: YearReviewWidgetSource {
    public var onUpdate: (@MainActor (YearReviewUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: YearReviewUpdate?

    public init(initial: YearReviewUpdate? = nil) {
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
    public func push(_ update: YearReviewUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/analytics.ts → "year-review")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `YearReviewWidget` re-exposes these
/// as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum YearReviewSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "YearReviewWidget"

    /// Canonical registry metadata (registry/analytics.ts → "year-review": 2×4 / 2×4 / 4×40).
    public static let registration = DashboardWidgetRegistration(
        id: "year-review",
        nameKey: "widget.yearReview.title",
        descriptionKey: "widget.yearReview.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "YearReviewWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`count` are Foundation-only so the
/// adapter's accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum YearReviewStrings {
    public static let table = "YearReviewWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a templated string and substitutes the `{year}` placeholder (web // parity:allow ui
    /// `t('inYear').replace('{year}', String(year))`).
    public static func year(_ key: String, _ fallback: String, _ year: Int) -> String {
        string(key, fallback).replacingOccurrences(of: "{year}", with: String(year))
    }
}
