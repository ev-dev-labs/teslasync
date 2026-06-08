//
//  DriveDetailHeader.Model.swift
//  TeslaSync — P4 feature view · 0137 · DriveDetailHeader (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `DriveDetailHeaderModel`; no networking lives in the view.
//  SwiftUI parity of features/driving/components/drive-detail/DriveDetailHeader.tsx — the masthead
//  the drive-detail page renders above the trip charts: a back affordance, the route (or the
//  "Drive Details" fallback) title, a vehicle + timestamp subtitle, and the Replay / Share actions.
//
//  Deliberately SwiftUI-free (Foundation + Observation + OSLog only) so the model + the projection
//  it drives compile and run on a plain host and are pinned by unit tests; the SwiftUI chrome layers
//  on top in DriveDetailHeader.swift / DriveDetailHeader.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol DriveDetailHeaderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogDriveDetailHeaderTelemetry: DriveDetailHeaderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drive query, mirroring the shared `LoadableState` cases the
/// production source projects from the `useDrive` hook (web `isLoading` skeleton / resolved `drive` /
/// `drive === null` empty / failure).
public enum DriveHeaderLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip so a cached masthead is clearly
/// labeled while reconnecting / offline.
public enum DriveHeaderConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The exact subset of the web `DriveDetail` DTO this masthead reads — the four props the web
/// component takes (`drive`, `driveId`, `vehicleName`) flattened to the fields it actually renders.
/// `startTs` is required for the subtitle; `endTs` and the start/end addresses are optional (the web
/// renders the localized "Drive Details" fallback title when either address is missing). The shared
/// `DrivingStore` projects this from the API the same way the web hook does; display formatting
/// happens in `DriveDetailHeaderProjector`.
public struct DriveHeaderDTO: Sendable, Equatable {
    public var driveID: String
    public var vehicleName: String
    public var startAddress: String?
    public var endAddress: String?
    public var startTs: Date?
    public var endTs: Date?

    public init(
        driveID: String,
        vehicleName: String,
        startAddress: String? = nil,
        endAddress: String? = nil,
        startTs: Date? = nil,
        endTs: Date? = nil
    ) {
        self.driveID = driveID
        self.vehicleName = vehicleName
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.startTs = startTs
        self.endTs = endTs
    }
}

/// The user's display preferences for this surface, mirroring the web `DateTime in="vehicle"` path:
/// the timestamps render in the vehicle's IANA timezone (with a short abbreviation appended to the
/// start time, the web `showTz`) and the user's locale. The production app resolves the real values
/// from `useSettings()` + the selected vehicle and pushes them with each snapshot so the view never
/// reads settings directly. A `nil` timezone falls back to the device's current zone (the web pure
/// path) and suppresses the abbreviation.
public struct DriveHeaderFormatPrefs: Sendable, Equatable {
    public var localeIdentifier: String
    public var timeZoneIdentifier: String?

    public init(localeIdentifier: String = "en_US", timeZoneIdentifier: String? = nil) {
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }
}

/// One coalesced snapshot pushed by a `DriveDetailHeaderSource`: the drive header data + display
/// prefs plus their load/connection status. The model turns this into the projection.
public struct DriveDetailHeaderUpdate: Sendable, Equatable {
    public var status: DriveHeaderLoadStatus
    public var connection: DriveHeaderConnection
    public var isFetching: Bool
    public var drive: DriveHeaderDTO?
    public var prefs: DriveHeaderFormatPrefs
    public var updatedAt: Date?

    public init(
        status: DriveHeaderLoadStatus = .loading,
        connection: DriveHeaderConnection = .live,
        isFetching: Bool = false,
        drive: DriveHeaderDTO? = nil,
        prefs: DriveHeaderFormatPrefs = DriveHeaderFormatPrefs(),
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
/// the `SettingsStore` for the timezone/locale); previews and tests use
/// `InMemoryDriveDetailHeaderSource`. The view never talks to the network directly.
@MainActor
public protocol DriveDetailHeaderSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DriveDetailHeaderUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `DriveDetailHeaderSource`, recomputes the
/// `DriveHeaderProjection` via `DriveDetailHeaderProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class DriveDetailHeaderModel {
    /// The mutually-exclusive render branches (web shell loading skeleton / resolved masthead /
    /// empty / failure).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DriveHeaderConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: DriveHeaderProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DriveDetailHeaderSource
    @ObservationIgnored private let telemetry: any DriveDetailHeaderTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DriveDetailHeaderSource,
        telemetry: any DriveDetailHeaderTelemetry = OSLogDriveDetailHeaderTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DriveDetailHeaderSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached masthead stays visible). Wired to the retry affordance and to
    /// the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web stale-query self-refresh (prompt "stale chip + auto-refresh").
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: DriveDetailHeaderUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = update.drive.map { DriveDetailHeaderProjector.project(drive: $0, prefs: update.prefs) }
        phase = Self.resolvePhase(status: update.status, hasData: update.drive != nil)
    }

    /// Resolves the render phase. Mirroring the web shell: the skeleton shows only on the initial
    /// fetch and the empty state when there is no drive; whenever a drive is known the masthead renders
    /// (cached values stay visible behind a refresh / transient failure so an offline or stale pod
    /// still shows the last-known header).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase logic
    /// be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: DriveHeaderLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryDriveDetailHeaderSource: DriveDetailHeaderSource {
    public var onUpdate: (@MainActor (DriveDetailHeaderUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveDetailHeaderUpdate?

    public init(initial: DriveDetailHeaderUpdate? = nil) {
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
    public func push(_ update: DriveDetailHeaderUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI.
public enum DriveDetailHeaderSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DriveDetailHeader"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "DriveDetailHeader" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps each
/// parallel surface prompt owning its own strings without editing the shared catalog. `string` is
/// Foundation-only so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` helper
/// lives in the view file.
public enum DriveDetailHeaderStrings {
    public static let table = "DriveDetailHeader"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
