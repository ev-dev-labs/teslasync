//
//  JourneyDetailsPanel.Model.swift
//  TeslaSync — P4 feature view · 0144 · JourneyDetailsPanel (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10). The view
//  binds through `JourneyDetailsModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drive-detail/JourneyDetailsPanel.tsx — the drive-detail panel that
//  shows the trip's Start and Destination endpoints (address-or-coordinates, vehicle-local timestamp,
//  and start/end battery).
//
//  Deliberately SwiftUI-free (Foundation + Observation + OSLog only) so the model + the projection it
//  drives compile and run on a plain host and are pinned by unit tests; the SwiftUI chrome layers on
//  top in JourneyDetailsPanel.swift / JourneyDetailsPanel.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol JourneyDetailsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogJourneyDetailsTelemetry: JourneyDetailsTelemetry {
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
/// production source projects from the `useDrive` hook the parent page subscribes to (web `isLoading`
/// skeleton / resolved `drive` / `drive === null` empty / failure).
public enum JourneyLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the panel freshness chip + connectivity banner so a cached
/// journey is clearly labeled while reconnecting / offline.
public enum JourneyConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The exact subset of the web `DriveDetail` DTO this panel reads — the fields the web component
/// renders for its Start + Destination endpoints. The shared `DrivingStore` projects this from the
/// API the same way the web hook does; all display formatting happens in `JourneyDetailsProjector`.
/// Latitude/longitude are optional Doubles (web `number | null`); battery is an optional percent
/// (web `number | null`, rendered raw or as the "?" sentinel).
public struct JourneyDriveDTO: Sendable, Equatable {
    public var startAddress: String?
    public var startLatitude: Double?
    public var startLongitude: Double?
    public var startTimestamp: Date?
    public var startBatteryPercent: Int?
    public var endAddress: String?
    public var endLatitude: Double?
    public var endLongitude: Double?
    public var endTimestamp: Date?
    public var endBatteryPercent: Int?

    public init(
        startAddress: String? = nil,
        startLatitude: Double? = nil,
        startLongitude: Double? = nil,
        startTimestamp: Date? = nil,
        startBatteryPercent: Int? = nil,
        endAddress: String? = nil,
        endLatitude: Double? = nil,
        endLongitude: Double? = nil,
        endTimestamp: Date? = nil,
        endBatteryPercent: Int? = nil
    ) {
        self.startAddress = startAddress
        self.startLatitude = startLatitude
        self.startLongitude = startLongitude
        self.startTimestamp = startTimestamp
        self.startBatteryPercent = startBatteryPercent
        self.endAddress = endAddress
        self.endLatitude = endLatitude
        self.endLongitude = endLongitude
        self.endTimestamp = endTimestamp
        self.endBatteryPercent = endBatteryPercent
    }
}

/// The user's display preferences for this surface. The timestamps render in the vehicle's IANA
/// timezone + the user's locale (the web `DateTime in="vehicle"` path); the coordinates use the same
/// locale + the global decimal precision (the web `fmtNumber` reads from `useSettings`, default 2).
/// The production app resolves the real values from `useSettings()` + the selected vehicle and pushes
/// them with each snapshot so the view never reads settings directly. A `nil` timezone falls back to
/// the device's current zone (the web pure path).
public struct JourneyFormatPrefs: Sendable, Equatable {
    public var localeIdentifier: String
    public var timeZoneIdentifier: String?
    public var decimalPrecision: Int

    public init(
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String? = nil,
        decimalPrecision: Int = 2
    ) {
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
        self.decimalPrecision = max(0, min(20, decimalPrecision))
    }
}

/// One coalesced snapshot pushed by a `JourneyDetailsSource`: the drive data + display prefs plus
/// their load/connection status. The model turns this into the projection.
public struct JourneyDetailsUpdate: Sendable, Equatable {
    public var status: JourneyLoadStatus
    public var connection: JourneyConnection
    public var isFetching: Bool
    public var drive: JourneyDriveDTO?
    public var prefs: JourneyFormatPrefs
    public var updatedAt: Date?

    public init(
        status: JourneyLoadStatus = .loading,
        connection: JourneyConnection = .live,
        isFetching: Bool = false,
        drive: JourneyDriveDTO? = nil,
        prefs: JourneyFormatPrefs = JourneyFormatPrefs(),
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
/// the `SettingsStore` for the timezone/locale/precision); previews and tests use
/// `InMemoryJourneyDetailsSource`. The view never talks to the network directly.
@MainActor
public protocol JourneyDetailsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (JourneyDetailsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `JourneyDetailsSource`, recomputes the
/// `JourneyDetailsProjection` via `JourneyDetailsProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class JourneyDetailsModel {
    /// The mutually-exclusive render branches (web shell loading skeleton / resolved panel / empty /
    /// failure).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: JourneyConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: JourneyDetailsProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any JourneyDetailsSource
    @ObservationIgnored private let telemetry: any JourneyDetailsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any JourneyDetailsSource,
        telemetry: any JourneyDetailsTelemetry = OSLogJourneyDetailsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: JourneyDetailsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached journey stays visible). Wired to the retry affordance and to
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

    private func apply(_ update: JourneyDetailsUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = update.drive.map { JourneyDetailsProjector.project(drive: $0, prefs: update.prefs) }
        phase = Self.resolvePhase(status: update.status, hasData: update.drive != nil)
    }

    /// Resolves the render phase. Mirroring the web shell: the skeleton shows only on the initial
    /// fetch and the empty state when there is no drive; whenever a drive is known the panel renders
    /// (cached values stay visible behind a refresh / transient failure so an offline or stale pod
    /// still shows the last-known journey).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase logic
    /// be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: JourneyLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryJourneyDetailsSource: JourneyDetailsSource {
    public var onUpdate: (@MainActor (JourneyDetailsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: JourneyDetailsUpdate?

    public init(initial: JourneyDetailsUpdate? = nil) {
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
    public func push(_ update: JourneyDetailsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI.
public enum JourneyDetailsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "JourneyDetailsPanel"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "JourneyDetailsPanel" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps each
/// parallel surface prompt owning its own strings without editing the shared catalog. `string` is
/// Foundation-only so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` helper
/// lives in the view file.
public enum JourneyDetailsStrings {
    public static let table = "JourneyDetailsPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
