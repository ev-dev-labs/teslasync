//
//  PatternsSlide.Model.swift
//  TeslaSync — P4 feature view · 0064 · PatternsSlide (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for the driving-
//  patterns recap slide. Vendor-agnostic and SwiftUI-free so the projection / model logic compiles
//  and runs on a plain host; the surface view layers SwiftUI chrome on top in PatternsSlide.swift.
//
//  Parity target: features/analytics/components/review/PatternsSlide.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))`, which is consent-gated and redacted there.
public protocol PatternsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to the
/// shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogPatternsTelemetry: PatternsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the slide's data, mirroring the shared `LoadableState` cases the production
/// source projects from `Resource<T>` (web `isLoading` / `isError` / data present).
public enum PatternsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` and the web `DataFreshness`
/// chip / `isStale` flag.
public enum PatternsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref` (`'km' | 'mi' | 'ft'`)
/// resolved by `useUnits()`.
public enum PatternsDistanceUnit: String, Sendable, Equatable, CaseIterable {
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

    /// The efficiency unit symbol for this distance preference — web
    /// `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public var efficiencySymbol: String {
        self == .miles ? "Wh/mi" : "Wh/km"
    }
}

/// The cached driving-patterns inputs this surface consumes, mirroring the subset of the web
/// `YearReview` DTO `PatternsSlide.tsx` reads (`GET /analytics/year-review`). Distances are kilometres
/// and efficiency Wh/km as the API delivers them; display conversion happens in `PatternsProjector`.
public struct PatternsReviewDTO: Sendable, Equatable {
    public var avgDistancePerDriveKm: Double
    public var avgEfficiencyWhKm: Double
    public var mostActiveHour: Int
    public var mostActiveDayOfWeek: String?
    public var avgDrivesPerWeek: Double

    public init(
        avgDistancePerDriveKm: Double = 0,
        avgEfficiencyWhKm: Double = 0,
        mostActiveHour: Int = 0,
        mostActiveDayOfWeek: String? = nil,
        avgDrivesPerWeek: Double = 0
    ) {
        self.avgDistancePerDriveKm = avgDistancePerDriveKm
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
        self.mostActiveHour = mostActiveHour
        self.mostActiveDayOfWeek = mostActiveDayOfWeek
        self.avgDrivesPerWeek = avgDrivesPerWeek
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings directly;
/// the source resolves these and pushes them with each snapshot.
public struct PatternsUnitPrefs: Sendable, Equatable {
    public var distance: PatternsDistanceUnit
    public var localeIdentifier: String

    public init(
        distance: PatternsDistanceUnit = .kilometers,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `PatternsReviewSource`: the cached DTO + display prefs plus the
/// load / connection status. The model turns this into the projection.
public struct PatternsUpdate: Sendable, Equatable {
    public var status: PatternsLoadStatus
    public var connection: PatternsConnection
    public var isFetching: Bool
    public var stats: PatternsReviewDTO?
    public var units: PatternsUnitPrefs
    public var updatedAt: Date?

    public init(
        status: PatternsLoadStatus = .loading,
        connection: PatternsConnection = .live,
        isFetching: Bool = false,
        stats: PatternsReviewDTO? = nil,
        units: PatternsUnitPrefs = PatternsUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.stats = stats
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<…>>` from the KMP `AnalyticsStore.yearReview` +
/// `SettingsStore` units); previews and tests use `InMemoryPatternsReviewSource`. The view never
/// talks to the network directly.
@MainActor
public protocol PatternsReviewSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (PatternsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The slide's observable view-model. Subscribes to a `PatternsReviewSource`, recomputes the
/// `PatternsProjection` via `PatternsProjector`, and exposes a render `Phase` + freshness for SwiftUI
/// to switch over.
@MainActor
@Observable
public final class PatternsSlideModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: PatternsConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: PatternsProjection?
    public private(set) var units = PatternsUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any PatternsReviewSource
    @ObservationIgnored private let telemetry: any PatternsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any PatternsReviewSource,
        telemetry: any PatternsTelemetry = OSLogPatternsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PatternsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry / refresh affordances
    /// (web `refetch`) and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native parity
    /// of the web self-refresh on `isStale` queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: PatternsUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.stats.map { PatternsProjector.project(stats: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.stats != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the initial
    /// fetch and the empty state when there is no recap; whenever stats are known the slide renders
    /// (cached values stay visible behind refresh / transient failures so an offline or stale pod still
    /// shows the last-known recap).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness / phase logic
    /// be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: PatternsLoadStatus, hasData: Bool) -> Phase {
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

/// In-memory source for previews + unit / UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryPatternsReviewSource: PatternsReviewSource {
    public var onUpdate: (@MainActor (PatternsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PatternsUpdate?

    public init(initial: PatternsUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: PatternsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface metadata + i18n facade (P1/S10 + P1/S11)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model compiles and tests
/// without SwiftUI. `PatternsSlide` re-exposes it as `surfaceSlug` for API parity with the siblings.
public enum PatternsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "PatternsSlide"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "PatternsSlide" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time. `string` / `unit` are Foundation-only so the adapter's accessibility summary can
/// use them; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum PatternsStrings {
    public static let table = "PatternsSlide"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a templated label and substitutes the `{unit}` token — the native parity of the web
    /// `t('yearReview.distancePerDrive', { unit })` interpolation.
    public static func unit(_ key: String, _ fallback: String, _ unit: String) -> String {
        string(key, fallback).replacingOccurrences(of: "{unit}", with: unit)
    }
}
