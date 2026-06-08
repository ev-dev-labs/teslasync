//
//  StatHeroSlide.Model.swift
//  TeslaSync — P4 feature view · 0068 · StatHeroSlide (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `StatHeroSlideModel`; no networking lives in the
//  view. SwiftUI parity of features/analytics/components/review/StatHeroSlide.tsx —
//  one "Year in Review" hero slide that animates a single headline stat (distance or
//  energy) with an emoji, a big number, its unit, and a fun comparison line.
//
//  This file is deliberately SwiftUI-free so the model + seam logic compiles and runs
//  on a plain host; the surface view layers SwiftUI chrome on top in StatHeroSlide.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol StatHeroSlideTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
/// The slug is a static, non-identifying constant logged verbatim; no payload, VIN, or
/// location is ever recorded.
public struct OSLogStatHeroSlideTelemetry: StatHeroSlideTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the slide's data, mirroring the shared `LoadableState` cases the
/// production source projects from `Resource<T>` (web `isLoading` / `isError` / data present).
public enum StatHeroSlideLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip + the cached-data banner so a
/// cached recap is clearly labeled while reconnecting / offline (web `DataFreshness` / `isStale`).
public enum StatHeroSlideConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`) resolved by `useUnits()`.
public enum StatHeroSlideDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact metres-per-unit divisor used by `convertDistanceFromSI` (NIST-grade, lib/unitConversion.ts:
    /// `METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT`).
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        case .feet: 0.3048
        }
    }

    /// The short symbol shown next to a value (`km` / `mi` / `ft`) — the web `unit: distanceUnit`.
    public var symbol: String {
        rawValue
    }

    /// Resolves a `useUnits()` label to a unit, defaulting to kilometres for unknown labels
    /// (matching the web pref's `'km'` default).
    public static func from(label: String) -> StatHeroSlideDistanceUnit {
        StatHeroSlideDistanceUnit(rawValue: label) ?? .kilometers
    }
}

/// Which headline stat this slide renders, mirroring the web `field` prop the parent story passes to
/// each `StatHeroSlide`. Unknown fields fall through to `.other`, reproducing the web `default` branch
/// (the 📊 zero slide) rather than hiding the surface.
public enum StatHeroSlideField: Sendable, Equatable {
    case distance
    case energy
    case other(String)

    public init(rawValue: String) {
        switch rawValue {
        case "distance": self = .distance
        case "energy": self = .energy
        default: self = .other(rawValue)
        }
    }

    /// The web field key (`"distance"` / `"energy"` / the raw passthrough).
    public var rawValue: String {
        switch self {
        case .distance: "distance"
        case .energy: "energy"
        case let .other(value): value
        }
    }
}

/// The cached year-in-review inputs this slide consumes — the subset of the web `YearReview` DTO
/// `getStatConfig` reads (`total_distance_km`, `total_energy_kwh`). Distance is kilometres and energy
/// kilowatt-hours as the API delivers them; display conversion happens in `StatHeroSlideProjector`.
public struct StatHeroSlideStats: Sendable, Equatable {
    public var totalDistanceKm: Double
    public var totalEnergyKwh: Double

    public init(totalDistanceKm: Double = 0, totalEnergyKwh: Double = 0) {
        self.totalDistanceKm = totalDistanceKm
        self.totalEnergyKwh = totalEnergyKwh
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings directly;
/// the source resolves these and pushes them with each snapshot.
public struct StatHeroSlideUnitPrefs: Sendable, Equatable {
    public var distance: StatHeroSlideDistanceUnit
    public var localeIdentifier: String

    public init(
        distance: StatHeroSlideDistanceUnit = .kilometers,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `StatHeroSlideSource`: the cached stats + display prefs + the
/// field this slide shows, plus their load/connection status. The model turns this into the display
/// config via `StatHeroSlideProjector`.
public struct StatHeroSlideUpdate: Sendable, Equatable {
    public var status: StatHeroSlideLoadStatus
    public var connection: StatHeroSlideConnection
    public var isFetching: Bool
    public var stats: StatHeroSlideStats?
    public var units: StatHeroSlideUnitPrefs
    public var field: StatHeroSlideField
    public var updatedAt: Date?

    public init(
        status: StatHeroSlideLoadStatus = .loading,
        connection: StatHeroSlideConnection = .live,
        isFetching: Bool = false,
        stats: StatHeroSlideStats? = nil,
        units: StatHeroSlideUnitPrefs = StatHeroSlideUnitPrefs(),
        field: StatHeroSlideField = .distance,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.stats = stats
        self.units = units
        self.field = field
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<…>>` from the KMP `AnalyticsStore.yearReview` +
/// `SettingsStore` units); previews and tests use `InMemoryStatHeroSlideSource`. The view never talks
/// to the network directly.
@MainActor
public protocol StatHeroSlideSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (StatHeroSlideUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The slide's observable view-model. Subscribes to a `StatHeroSlideSource`, recomputes the
/// `StatHeroSlideConfig` via `StatHeroSlideProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class StatHeroSlideModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: StatHeroSlideConnection = .live
    public private(set) var isFetching = false
    public private(set) var config: StatHeroSlideConfig?
    public private(set) var field: StatHeroSlideField = .distance
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any StatHeroSlideSource
    @ObservationIgnored private let telemetry: any StatHeroSlideTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any StatHeroSlideSource,
        telemetry: any StatHeroSlideTelemetry = OSLogStatHeroSlideTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: StatHeroSlideSurface.slug)
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

    private func apply(_ update: StatHeroSlideUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        field = update.field
        updatedAt = update.updatedAt
        config = update.stats.map {
            StatHeroSlideProjector.project(stats: $0, units: update.units, field: update.field)
        }
        phase = Self.resolvePhase(status: update.status, hasData: update.stats != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there is no recap; whenever stats are known the slide
    /// renders (cached values stay visible behind refresh/transient failures so an offline or stale
    /// pod still shows the last-known recap).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase logic
    /// be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: StatHeroSlideLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryStatHeroSlideSource: StatHeroSlideSource {
    public var onUpdate: (@MainActor (StatHeroSlideUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: StatHeroSlideUpdate?

    public init(initial: StatHeroSlideUpdate? = nil) {
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
    public func push(_ update: StatHeroSlideUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface metadata

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `StatHeroSlide` re-exposes it as `surfaceSlug` for API parity with the other
/// surfaces.
public enum StatHeroSlideSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "StatHeroSlide"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "StatHeroSlide" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`interpolate` are Foundation-only so
/// the adapter can resolve the comparison copy; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum StatHeroSlideStrings {
    public static let table = "StatHeroSlide"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a templated string and substitutes i18next-style `{{name}}` tokens (web
    /// `t(key, { name: value })`).
    public static func interpolate(
        _ key: String,
        _ fallback: String,
        _ replacements: [String: String]
    ) -> String {
        var result = string(key, fallback)
        for (name, value) in replacements {
            result = result.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return result
    }
}
