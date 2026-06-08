//
//  WatchSummaryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0114 · WatchSummaryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in WatchSummaryWidget.swift).
//
//  Parity target: features/dashboard/widgets/WatchSummaryWidget.tsx — the Apple Watch-style
//  compact view (battery, range, state, lock status) the web registry calls "watch-summary".
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted
/// there. The surface emits this as the `view.opened` event required by the prompt's §8.
public protocol WatchSummaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to
/// the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogWatchSummaryTelemetry: WatchSummaryTelemetry {
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
/// production source projects from `Resource<WatchSummary>` (the `isLoading` / `isError` flags
/// the web reads off `useWatchSummary`).
public enum WatchSummaryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale`.
public enum WatchSummaryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`) resolved by `useUnits()`.
public enum WatchDistanceUnit: String, Sendable, Equatable, CaseIterable {
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

/// The user's temperature display preference. Mirrors the web `TemperatureUnitPref`
/// (`'°C' | '°F'`) resolved by `useUnits()` — the pref string *is* the unit symbol.
public enum WatchTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol shown next to a value (`°C` / `°F`).
    public var symbol: String {
        rawValue
    }
}

/// The single cached watch summary this surface consumes, mirroring the subset of the web
/// `WatchSummary` + `WatchComplication` DTOs the widget reads (`GET /watch/summary`,
/// `GET /watch/complication`). SI/raw as delivered by the API; display conversion happens in
/// `WatchSummaryProjector`.
public struct WatchSummaryDTO: Sendable, Equatable {
    /// `state` — the raw vehicle state string (`online` / `asleep` / `charging` / …).
    public var state: String?
    /// `battery_level` — state-of-charge percent (0–100).
    public var batteryLevel: Double?
    /// `range_km` — estimated range in **kilometres** (as the web reads `summary.range_km`).
    public var rangeKm: Double?
    /// `is_locked` — door-lock status.
    public var isLocked: Bool?
    /// `inside_temp_c` — cabin temperature in **°C** (SI).
    public var insideTempC: Double?
    /// `last_updated` — when the snapshot was produced (the web `TimeStamp` value).
    public var lastUpdated: Date?
    /// `charging` — from the complication feed; drives the compact "⚡ Charging" indicator.
    public var charging: Bool

    public init(
        state: String? = nil,
        batteryLevel: Double? = nil,
        rangeKm: Double? = nil,
        isLocked: Bool? = nil,
        insideTempC: Double? = nil,
        lastUpdated: Date? = nil,
        charging: Bool = false
    ) {
        self.state = state
        self.batteryLevel = batteryLevel
        self.rangeKm = rangeKm
        self.isLocked = isLocked
        self.insideTempC = insideTempC
        self.lastUpdated = lastUpdated
        self.charging = charging
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings
/// directly; the source resolves these and pushes them per snapshot.
public struct WatchSummaryUnitPrefs: Sendable, Equatable {
    public var distance: WatchDistanceUnit
    public var temperature: WatchTemperatureUnit
    public var localeIdentifier: String

    public init(
        distance: WatchDistanceUnit = .kilometers,
        temperature: WatchTemperatureUnit = .celsius,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `WatchSummarySource`: the cached summary + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct WatchSummaryUpdate: Sendable, Equatable {
    public var status: WatchSummaryLoadStatus
    public var connection: WatchSummaryConnection
    public var isFetching: Bool
    public var summary: WatchSummaryDTO?
    public var units: WatchSummaryUnitPrefs
    public var updatedAt: Date?

    public init(
        status: WatchSummaryLoadStatus = .loading,
        connection: WatchSummaryConnection = .live,
        isFetching: Bool = false,
        summary: WatchSummaryDTO? = nil,
        units: WatchSummaryUnitPrefs = WatchSummaryUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.summary = summary
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the KMP `VehicleStore` watch-summary + complication queries + `SettingsStore`);
/// previews and tests use `InMemoryWatchSummarySource`. The view never talks to the network.
@MainActor
public protocol WatchSummarySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (WatchSummaryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `WatchSummarySource`, exposes the cached
/// summary + display prefs and a render `Phase` + freshness for SwiftUI to switch over. The
/// size-dependent layout (compact vs. standard) is decided by the view via `WatchSummaryLayout`,
/// mirroring the web `isCompact = size.cols <= 1` derive.
@MainActor
@Observable
public final class WatchSummaryModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / content).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: WatchSummaryConnection = .live
    public private(set) var isFetching = false
    public private(set) var summary: WatchSummaryDTO?
    public private(set) var units = WatchSummaryUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any WatchSummarySource
    @ObservationIgnored private let telemetry: any WatchSummaryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any WatchSummarySource,
        telemetry: any WatchSummaryTelemetry = OSLogWatchSummaryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WatchSummarySurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached summary stays visible). Wired to the retry / refresh
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

    private func apply(_ update: WatchSummaryUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        summary = update.summary
        phase = Self.resolvePhase(status: update.status, hasSummary: update.summary != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there is no `summary` object; whenever a summary is
    /// known the content renders (the cached summary stays visible behind refresh/transient
    /// failures so an offline or stale pod still shows the last-known glance — `hasData = summary
    /// != null` in the web source).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: WatchSummaryLoadStatus,
        hasSummary: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasSummary ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasSummary ? .content : .empty
        case let .failed(message):
            hasSummary ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryWatchSummarySource: WatchSummarySource {
    public var onUpdate: (@MainActor (WatchSummaryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WatchSummaryUpdate?

    public init(initial: WatchSummaryUpdate? = nil) {
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
    public func push(_ update: WatchSummaryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/vehicle.ts → "watch-summary")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `WatchSummaryWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum WatchSummarySurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WatchSummaryWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "watch-summary"): category `vehicle`,
    /// default 1×2, min 1×2, max 2×40.
    public static let registration = DashboardWidgetRegistration(
        id: "watch-summary",
        nameKey: "widget.watchSummary",
        descriptionKey: "widget.watchSummary.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 2, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "WatchSummaryWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the
/// adapter's accessibility content can use it; the SwiftUI `text(_:_:)` helper lives in the
/// view file.
public enum WatchSummaryStrings {
    public static let table = "WatchSummaryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }
}
