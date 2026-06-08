//
//  WeeklyDigestWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0116 · WeeklyDigestWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a plain
//  host (the surface view layers SwiftUI chrome on top in WeeklyDigestWidget.swift).
//
//  Parity target: features/dashboard/widgets/WeeklyDigestWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted there.
public protocol WeeklyDigestTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogWeeklyDigestTelemetry: WeeklyDigestTelemetry {
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
/// production source projects from the `useWeeklyDigest` query (web `useQuery`).
public enum WeeklyDigestLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Query freshness, mirroring `LiveConnectionState` (ADR-013) and the web `WidgetShell`
/// `isStale` / `isFetching` freshness chip + the offline cached-content affordance.
public enum WeeklyDigestConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref` (`'km' | 'mi' | 'ft'`)
/// resolved by `useUnits()`, used to convert the distance, pick the efficiency unit, and render the
/// distance suffix.
public enum WeeklyDigestDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact metres-per-unit divisor used by `convertDistanceFromSI` (NIST-grade), matching
    /// `METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT` in lib/unitConversion.ts.
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        case .feet: 0.3048
        }
    }

    /// The short symbol rendered next to the distance (`km` / `mi` / `ft`).
    public var symbol: String {
        rawValue
    }

    /// Web `unitPrefs.distance === 'mi'` branch driving the efficiency unit + conversion.
    public var isImperial: Bool {
        self == .miles
    }
}

/// The weekly-digest payload the widget consumes — the web `WeeklyDigestData` shape returned by
/// `GET /vehicles/{id}/weekly-digest`. Every field is optional to mirror the web `?? 0` fallbacks;
/// `distanceKm` / `efficiency` are stored in km / Wh·km as delivered by the API and converted for
/// display in `WeeklyDigestProjector` (verbatim with the web transform).
public struct WeeklyDigestDTO: Sendable, Equatable {
    public var drives: Double?
    public var distanceKm: Double?
    public var energyKwh: Double?
    public var efficiency: Double?
    public var prevDrives: Double?
    public var prevDistanceKm: Double?
    public var prevEnergyKwh: Double?
    public var prevEfficiency: Double?

    public init(
        drives: Double? = nil,
        distanceKm: Double? = nil,
        energyKwh: Double? = nil,
        efficiency: Double? = nil,
        prevDrives: Double? = nil,
        prevDistanceKm: Double? = nil,
        prevEnergyKwh: Double? = nil,
        prevEfficiency: Double? = nil
    ) {
        self.drives = drives
        self.distanceKm = distanceKm
        self.energyKwh = energyKwh
        self.efficiency = efficiency
        self.prevDrives = prevDrives
        self.prevDistanceKm = prevDistanceKm
        self.prevEnergyKwh = prevEnergyKwh
        self.prevEfficiency = prevEfficiency
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings directly;
/// the source resolves these and pushes them with each snapshot.
public struct WeeklyDigestUnitPrefs: Sendable, Equatable {
    public var distance: WeeklyDigestDistanceUnit
    public var localeIdentifier: String

    public init(distance: WeeklyDigestDistanceUnit = .kilometers, localeIdentifier: String = "en_US") {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `WeeklyDigestSource`: the digest payload + display prefs plus
/// their load/connection status. The model turns this into the projection.
public struct WeeklyDigestUpdate: Sendable, Equatable {
    public var status: WeeklyDigestLoadStatus
    public var connection: WeeklyDigestConnection
    public var isFetching: Bool
    public var data: WeeklyDigestDTO?
    public var units: WeeklyDigestUnitPrefs
    public var updatedAt: Date?

    public init(
        status: WeeklyDigestLoadStatus = .loading,
        connection: WeeklyDigestConnection = .live,
        isFetching: Bool = false,
        data: WeeklyDigestDTO? = nil,
        units: WeeklyDigestUnitPrefs = WeeklyDigestUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.data = data
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the `VehicleStore` for the active vehicle + the weekly-digest `Resource` + `SettingsStore`);
/// previews and tests use `InMemoryWeeklyDigestSource`. The view never talks to the network directly.
@MainActor
public protocol WeeklyDigestSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (WeeklyDigestUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `WeeklyDigestSource`, recomputes the
/// `WeeklyDigestProjection` via `WeeklyDigestProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class WeeklyDigestModel {
    /// The mutually-exclusive render branches (web shell loading / error → body card / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: WeeklyDigestConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection = WeeklyDigestProjection(metrics: [])
    public private(set) var units = WeeklyDigestUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any WeeklyDigestSource
    @ObservationIgnored private let telemetry: any WeeklyDigestTelemetry
    @ObservationIgnored private let copy: WeeklyDigestCopy
    @ObservationIgnored private var started = false

    public init(
        source: any WeeklyDigestSource,
        telemetry: any WeeklyDigestTelemetry = OSLogWeeklyDigestTelemetry(),
        copy: WeeklyDigestCopy = WeeklyDigestStrings.copy()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WeeklyDigestSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached metrics stay visible). Wired to the retry / refresh
    /// affordances and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web freshness self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: WeeklyDigestUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = WeeklyDigestProjector.project(data: update.data, units: update.units, copy: copy)
        phase = Self.resolvePhase(status: update.status, hasData: !projection.isEmpty)
    }

    /// Resolves the render phase, mirroring the web `WidgetShell` precedence: `loading` →
    /// `error` → body. The web shell short-circuits on `error` BEFORE rendering children, so an
    /// errored query shows `QueryError` even when stale metrics exist (this differs from list
    /// surfaces that keep cached rows behind a transient failure). The body itself renders the
    /// comparison card when the digest resolved (web `metrics.length > 0`, i.e. `data` present even
    /// if every value is zero) and the "No weekly data yet" empty state otherwise.
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: WeeklyDigestLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryWeeklyDigestSource: WeeklyDigestSource {
    public var onUpdate: (@MainActor (WeeklyDigestUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WeeklyDigestUpdate?

    public init(initial: WeeklyDigestUpdate? = nil) {
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
    public func push(_ update: WeeklyDigestUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/analytics.ts → "weekly-digest")



/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI view
/// so the model/adapter compile and test without SwiftUI. `WeeklyDigestWidget` re-exposes these as
/// `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum WeeklyDigestSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WeeklyDigestWidget"

    /// Canonical registry metadata (registry/analytics.ts → "weekly-digest"): Weekly Digest, category
    /// `analytics`, default 2×4, min 1×2, max 4×40.
    public static let registration = DashboardWidgetRegistration(
        id: "weekly-digest",
        nameKey: "widget.weeklyDigest.title",
        descriptionKey: "widget.weeklyDigest.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "WeeklyDigestWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the model +
/// adapter copy can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum WeeklyDigestStrings {
    public static let table = "WeeklyDigestWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog (the four metric
    /// labels the web reads via `t()`, the em-dash glyph, and the VoiceOver trend phrases).
    public static func copy() -> WeeklyDigestCopy {
        WeeklyDigestCopy(
            distanceLabel: string("widget.weeklyDigest.distance", "Distance"),
            drivesLabel: string("widget.weeklyDigest.drives", "Drives"),
            energyLabel: string("widget.weeklyDigest.energy", "Energy"),
            efficiencyLabel: string("widget.weeklyDigest.efficiency", "Efficiency"),
            emDash: string("widget.weeklyDigest.emDash", "—"),
            a11yTrendUp: string("widget.weeklyDigest.a11yTrendUp", "trending up %@"),
            a11yTrendDown: string("widget.weeklyDigest.a11yTrendDown", "trending down %@"),
            a11yTrendFlat: string("widget.weeklyDigest.a11yTrendFlat", "no change"),
            a11yNoComparison: string("widget.weeklyDigest.a11yNoComparison", "no prior data")
        )
    }
}
