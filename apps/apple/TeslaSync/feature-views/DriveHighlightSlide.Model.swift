//
//  DriveHighlightSlide.Model.swift
//  TeslaSync — P4 feature view · 0062 · DriveHighlightSlide (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + surface registry + i18n facade
//  (P1/S10) for the Year-in-Review "drive highlight" slide. Vendor-agnostic and SwiftUI-free so the
//  projection/model logic compiles and runs on a plain host (the surface view layers SwiftUI chrome on
//  top in DriveHighlightSlide.swift / DriveHighlightSlide.Views.swift).
//
//  Parity target: features/analytics/components/review/DriveHighlightSlide.tsx. The web leaf is a
//  presentational slide fed three props by the Year-in-Review story: `drive: YearReviewDriveHighlight |
//  null`, a display `label`, and an `emoji`. When `drive` is null it shows the emoji + "No drive data
//  for this year"; otherwise it renders the emoji, the label, and a card with the route, a three-up
//  stat grid (distance / duration / efficiency), and the date. It reads `useUnits()` for the distance +
//  efficiency display unit. The native surface binds the same inputs through a state holder so it can
//  additionally render the P4 load/connection states (loading / empty / error / stale / offline) the
//  shared story shell exposes around the slide.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol DriveHighlightSlideTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event. The slug is a
/// static, non-identifying constant logged verbatim; no payload, VIN, address, or location is recorded.
public struct OSLogDriveHighlightSlideTelemetry: DriveHighlightSlideTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the slide's data, mirroring the shared `LoadableState` cases the production
/// source projects from `Resource<T>` (web `isLoading` / `isError` / data present).
public enum DriveHighlightSlideLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip + the cached-data banner so a cached
/// highlight is clearly labeled while reconnecting / offline (web `DataFreshness` / `isStale`).
public enum DriveHighlightSlideConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref` (`'km' | 'mi' | 'ft'`)
/// resolved by `useUnits()` — the slide reads `unitPrefs.distance` for both the distance figure and the
/// `Wh/mi` vs `Wh/km` efficiency unit.
public enum DriveHighlightSlideDistanceUnit: String, Sendable, Equatable, CaseIterable {
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

    /// The short symbol shown beneath the distance figure (`km` / `mi` / `ft`) — the web
    /// `<p>{distanceUnit}</p>`.
    public var symbol: String {
        rawValue
    }

    /// Whether the slide uses imperial efficiency (`Wh/mi`) — the web `distanceUnit === 'mi'` test that
    /// gates both the `efficiency_wh_km * KM_PER_MILE` conversion and the `Wh/mi` unit label. Only miles
    /// flips it; kilometres and feet both keep `Wh/km`.
    public var usesImperialEfficiency: Bool {
        self == .miles
    }

    /// Resolves a `useUnits()` label to a unit, defaulting to kilometres for unknown labels (matching the
    /// web pref's `'km'` default).
    public static func from(label: String) -> DriveHighlightSlideDistanceUnit {
        DriveHighlightSlideDistanceUnit(rawValue: label) ?? .kilometers
    }
}

/// The cached drive-highlight this slide consumes — the web `YearReviewDriveHighlight` DTO. Field names
/// mirror the API contract (`distance_km`, `duration_min`, `efficiency_wh_km`, …) the web source reads
/// verbatim; the SI cutover applies to new Go/DB columns, not to this Apple mirror of the existing
/// year-review API shape. Distances arrive in kilometres and efficiency in Wh/km (already SI-derived);
/// display conversion happens in `DriveHighlightSlideProjector`.
public struct DriveHighlightReviewDTO: Sendable, Equatable {
    public var date: String
    public var distanceKm: Double
    public var durationMin: Double
    public var startAddress: String
    public var endAddress: String
    public var efficiencyWhKm: Double

    public init(
        date: String = "",
        distanceKm: Double = 0,
        durationMin: Double = 0,
        startAddress: String = "",
        endAddress: String = "",
        efficiencyWhKm: Double = 0
    ) {
        self.date = date
        self.distanceKm = distanceKm
        self.durationMin = durationMin
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.efficiencyWhKm = efficiencyWhKm
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings directly; the
/// source resolves these and pushes them with each snapshot so the formatted figures group exactly as
/// the web `Intl`/`fmtNumber` does.
public struct DriveHighlightSlideUnitPrefs: Sendable, Equatable {
    public var distance: DriveHighlightSlideDistanceUnit
    public var localeIdentifier: String

    public init(
        distance: DriveHighlightSlideDistanceUnit = .kilometers,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `DriveHighlightSlideSource`: the cached drive (nullable, mirroring
/// the web `drive` prop), the slide's display `label` + `emoji` (always present — they identify which
/// highlight this slide is, so the empty state can still show them), the display prefs, and the
/// load/connection status. The model turns this into the projection via `DriveHighlightSlideProjector`.
public struct DriveHighlightSlideUpdate: Sendable, Equatable {
    public var status: DriveHighlightSlideLoadStatus
    public var connection: DriveHighlightSlideConnection
    public var isFetching: Bool
    public var drive: DriveHighlightReviewDTO?
    public var label: String
    public var emoji: String
    public var units: DriveHighlightSlideUnitPrefs
    public var updatedAt: Date?

    public init(
        status: DriveHighlightSlideLoadStatus = .loading,
        connection: DriveHighlightSlideConnection = .live,
        isFetching: Bool = false,
        drive: DriveHighlightReviewDTO? = nil,
        label: String = "",
        emoji: String = "",
        units: DriveHighlightSlideUnitPrefs = DriveHighlightSlideUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.drive = drive
        self.label = label
        self.emoji = emoji
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<…>>` from the KMP `AnalyticsStore.yearReview` +
/// `SettingsStore` units); previews and tests use `InMemoryDriveHighlightSlideSource`. The view never
/// talks to the network directly.
@MainActor
public protocol DriveHighlightSlideSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DriveHighlightSlideUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The slide's observable view-model. Subscribes to a `DriveHighlightSlideSource`, recomputes the
/// `DriveHighlightSlideProjection` via `DriveHighlightSlideProjector`, and exposes a render `Phase` +
/// the slide's `label`/`emoji` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DriveHighlightSlideModel {
    /// The mutually-exclusive render branches. The web leaf renders either its content body or the
    /// "No drive data" empty body; the surrounding loading / error states come from the story shell and
    /// are reproduced here so the slide owns every P4 state rather than assuming a happy path.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DriveHighlightSlideConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: DriveHighlightSlideProjection?
    public private(set) var label = ""
    public private(set) var emoji = ""
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DriveHighlightSlideSource
    @ObservationIgnored private let telemetry: any DriveHighlightSlideTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DriveHighlightSlideSource,
        telemetry: any DriveHighlightSlideTelemetry = OSLogDriveHighlightSlideTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DriveHighlightSlideSurface.slug)
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
    /// of the web `DataFreshnessAuto` self-refresh on `isStale` queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: DriveHighlightSlideUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        label = update.label
        emoji = update.emoji
        updatedAt = update.updatedAt
        projection = update.drive.map {
            DriveHighlightSlideProjector.project(drive: $0, units: update.units, label: update.label)
        }
        phase = Self.resolvePhase(status: update.status, hasData: update.drive != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + leaf: the skeleton shows only on the initial
    /// fetch and the empty state when there is no drive (web `!drive`); whenever a drive is known the
    /// slide renders (cached values stay visible behind refresh/transient failures so an offline or
    /// stale pod still shows the last-known highlight).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: DriveHighlightSlideLoadStatus,
        hasData: Bool
    ) -> Phase {
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
public final class InMemoryDriveHighlightSlideSource: DriveHighlightSlideSource {
    public var onUpdate: (@MainActor (DriveHighlightSlideUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveHighlightSlideUpdate?

    public init(initial: DriveHighlightSlideUpdate? = nil) {
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
    public func push(_ update: DriveHighlightSlideUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and test
/// without SwiftUI. `DriveHighlightSlide` re-exposes it as `surfaceSlug` for API parity with the other
/// surfaces.
public enum DriveHighlightSlideSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DriveHighlightSlide"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "DriveHighlightSlide" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time. `string` is Foundation-only so the adapter's accessibility summary can
/// use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum DriveHighlightSlideStrings {
    public static let table = "DriveHighlightSlide"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
