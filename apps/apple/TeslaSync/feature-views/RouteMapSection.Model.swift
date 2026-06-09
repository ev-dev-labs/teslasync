//
//  RouteMapSection.Model.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `RouteMapSectionModel`; no networking lives in the view.
//  SwiftUI parity of features/driving/components/drive-detail/RouteMapSection.tsx — the drive-detail
//  route map: a speed-colored trail on a MapKit canvas with start/end markers, a stationary-GPS
//  fallback, a speed legend, and a start/end-time footer.
//
//  Deliberately SwiftUI-free (Foundation + Observation + OSLog only) so the model + the projection it
//  drives compile and run on a plain host and are pinned by unit tests; the SwiftUI chrome layers on
//  top in RouteMapSection.swift / RouteMapSection.Views.swift. The web component is fed by
//  `useDriveDetailData` (which derives trail / segments / markers from the raw `DriveDetail`), so the
//  native source delivers the raw drive and the projector reproduces that derivation verbatim.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol RouteMapSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogRouteMapSectionTelemetry: RouteMapSectionTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Raw drive DTO (web `DriveDetail` subset the route map reads)

/// One GPS fix recorded for the drive (web `DrivePosition`). `hasMeaningfulRoute` / `firstValidIndex`
/// run over these to decide whether there is a real route to plot or only a single stationary cluster.
public struct RouteMapPosition: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double
    public var speedMps: Double?

    public init(latitude: Double, longitude: Double, speedMps: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.speedMps = speedMps
    }
}

/// One telemetry sample (web `DriveTelemetryPoint`). Coordinates are optional because telemetry rows
/// can predate the first GPS fix; the projector filters them exactly as the web `routeSource` does.
public struct RouteMapTelemetrySample: Sendable, Equatable {
    public var latitude: Double?
    public var longitude: Double?
    public var speedMps: Double?

    public init(latitude: Double?, longitude: Double?, speedMps: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.speedMps = speedMps
    }
}

/// The exact subset of the web `DriveDetail` the route map reads. The shared `DrivingStore` projects
/// this from the API the same way the web `useDrive` hook does; the geometry derivation
/// (`routeSource` → trail / segments / markers) happens in `RouteMapProjector`, byte-for-byte with the
/// web `useDriveDetailData`.
public struct RouteMapDrive: Sendable, Equatable {
    public var driveID: String
    public var startTs: Date?
    public var endTs: Date?
    public var startLatitude: Double?
    public var startLongitude: Double?
    public var positions: [RouteMapPosition]
    public var telemetry: [RouteMapTelemetrySample]

    public init(
        driveID: String,
        startTs: Date? = nil,
        endTs: Date? = nil,
        startLatitude: Double? = nil,
        startLongitude: Double? = nil,
        positions: [RouteMapPosition] = [],
        telemetry: [RouteMapTelemetrySample] = []
    ) {
        self.driveID = driveID
        self.startTs = startTs
        self.endTs = endTs
        self.startLatitude = startLatitude
        self.startLongitude = startLongitude
        self.positions = positions
        self.telemetry = telemetry
    }
}

/// The user's display preferences for this surface, mirroring the web `useUnits()` + `useDateFormat()`
/// path the route map reads: the speed legend converts the SI thresholds into `speedUnit` at
/// `precision` decimals, and the marker / footer timestamps render in the vehicle's IANA timezone and
/// the user's locale. The production app resolves the real values from `useSettings()` and pushes them
/// with each snapshot so the view never reads settings directly.
public struct RouteMapFormatPrefs: Sendable, Equatable {
    public var localeIdentifier: String
    public var timeZoneIdentifier: String?
    public var speedUnit: String
    public var precision: Int

    public init(
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String? = nil,
        speedUnit: String = "mph",
        precision: Int = 0
    ) {
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
        self.speedUnit = speedUnit
        self.precision = precision
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drive query, mirroring the shared `LoadableState` cases the
/// production source projects from the `useDrive` hook (web `isLoading` skeleton / resolved `drive` /
/// `drive === null` empty / failure).
public enum RouteMapLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip so a cached route map is clearly labeled
/// while reconnecting / offline.
public enum RouteMapConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `RouteMapSource`: the raw drive + display prefs plus their
/// load/connection status. The model turns this into the projection.
public struct RouteMapUpdate: Sendable, Equatable {
    public var status: RouteMapLoadStatus
    public var connection: RouteMapConnection
    public var isFetching: Bool
    public var drive: RouteMapDrive?
    public var prefs: RouteMapFormatPrefs
    public var updatedAt: Date?

    public init(
        status: RouteMapLoadStatus = .loading,
        connection: RouteMapConnection = .live,
        isFetching: Bool = false,
        drive: RouteMapDrive? = nil,
        prefs: RouteMapFormatPrefs = RouteMapFormatPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.drive = drive
        self.prefs = prefs
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<DriveDetail>>` from the KMP `DrivingStore` composed with
/// the `SettingsStore` for the unit/timezone/locale prefs); previews and tests use
/// `InMemoryRouteMapSource`. The view never talks to the network directly.
@MainActor
public protocol RouteMapSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (RouteMapUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `RouteMapSource`, recomputes the
/// `RouteMapProjection` via `RouteMapProjector`, and exposes a render `Phase` + freshness for SwiftUI
/// to switch over.
@MainActor
@Observable
public final class RouteMapSectionModel {
    /// The mutually-exclusive render branches (web shell loading skeleton / resolved map / empty /
    /// failure). `content` still carries an empty-trail projection (the web "No route data" body).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: RouteMapConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: RouteMapProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any RouteMapSource
    @ObservationIgnored private let telemetry: any RouteMapSectionTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any RouteMapSource,
        telemetry: any RouteMapSectionTelemetry = OSLogRouteMapSectionTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RouteMapSectionSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached map stays visible). Wired to the retry affordance and to the
    /// stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native parity
    /// of the web stale-query self-refresh (prompt "stale chip + auto-refresh").
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: RouteMapUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = update.drive.map { RouteMapProjector.project(drive: $0, prefs: update.prefs) }
        phase = Self.resolvePhase(status: update.status, hasData: update.drive != nil)
    }

    /// Resolves the render phase. Mirroring the web shell: the skeleton shows only on the initial fetch
    /// and the empty state when there is no drive; whenever a drive is known the panel renders (its body
    /// switches between the map and the "No route data" copy), and cached values stay visible behind a
    /// refresh / transient failure so an offline or stale pod still shows the last-known map.
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: RouteMapLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryRouteMapSource: RouteMapSource {
    public var onUpdate: (@MainActor (RouteMapUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RouteMapUpdate?

    public init(initial: RouteMapUpdate? = nil) {
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
    public func push(_ update: RouteMapUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI.
public enum RouteMapSectionSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "RouteMapSection"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "RouteMapSection" table, folded into the app `Localizable.xcstrings`
/// master catalog at integration time; the per-surface table keeps each parallel surface prompt owning
/// its own strings without editing the shared catalog. `string` is Foundation-only so the adapter's
/// legend / accessibility summaries can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum RouteMapSectionStrings {
    public static let table = "RouteMapSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
