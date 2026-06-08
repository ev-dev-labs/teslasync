//
//  MoreDetailsPanel.Model.swift
//  TeslaSync — P4 feature view · 0145 · MoreDetailsPanel (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10). The
//  view binds through `MoreDetailsModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drive-detail/MoreDetailsPanel.tsx — the drive-detail "More
//  Details" panel that renders the computed `DriveStats` (odometer, range, elevation, energy,
//  consumption, power, temperatures, min speed, battery, net) for one drive. The web component
//  reads its `drive` + `stats` from the parent `useDriveDetailData` projection and its display
//  units from `useUnits`; the production app composes both into the `MoreDetailsSource` seam
//  below so the same drive-detail query + unit-preference holders feed every platform.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol MoreDetailsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogMoreDetailsTelemetry: MoreDetailsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drive-detail query, mirroring the shared `LoadableState`
/// cases the web parent projects from `useDriveDetailData` (web `isLoading` skeleton / resolved
/// drive + stats / empty / `error`).
public enum MoreDetailsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached values are clearly labeled while reconnecting / offline.
public enum MoreDetailsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `MoreDetailsSource`: the drive-detail load status + the
/// cached aggregate + the display-unit preferences + the (shared) connection + the in-flight
/// refresh flag + the last-updated timestamp.
public struct MoreDetailsUpdate: Sendable, Equatable {
    public var status: MoreDetailsLoadStatus
    public var input: MoreDetailsInput?
    public var unitPrefs: MoreDetailsUnitPrefs
    public var refreshing: Bool
    public var connection: MoreDetailsConnection
    public var updatedAt: Date?

    public init(
        status: MoreDetailsLoadStatus = .loading,
        input: MoreDetailsInput? = nil,
        unitPrefs: MoreDetailsUnitPrefs = MoreDetailsUnitPrefs(),
        refreshing: Bool = false,
        connection: MoreDetailsConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.unitPrefs = unitPrefs
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders — composing the drive-detail query (web `useDriveDetailData`) with the
/// unit-preference holder (web `useUnits`) and a refresh affordance. Previews + tests use
/// `InMemoryMoreDetailsSource`. The view never talks to the network directly.
@MainActor
public protocol MoreDetailsSource: AnyObject {
    var onUpdate: (@MainActor (MoreDetailsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the drive-detail query from the backend (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `MoreDetailsSource`, projects the cached
/// aggregate + unit preferences into the two view-ready tile groups, and exposes a render
/// `MoreDetailsPhase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class MoreDetailsModel {
    public private(set) var connection: MoreDetailsConnection = .live
    public private(set) var phase: MoreDetailsPhase = .loading
    public private(set) var tiles: MoreDetailsTiles = .init(primary: [], secondary: [])
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any MoreDetailsSource
    @ObservationIgnored private let telemetry: any MoreDetailsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any MoreDetailsSource,
        telemetry: any MoreDetailsTelemetry = OSLogMoreDetailsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MoreDetailsPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches the drive-detail query (web `refetch()`), used by the error-state retry.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: MoreDetailsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        refreshing = update.refreshing
        tiles = MoreDetailsProjection.tiles(from: update.input, prefs: update.unitPrefs)
        phase = MoreDetailsProjection.resolvePhase(update.status, hasValue: update.input != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh of the drive-detail query (prompt "stale chip + auto-
    /// refresh"); reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: MoreDetailsConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryMoreDetailsSource: MoreDetailsSource {
    public var onUpdate: (@MainActor (MoreDetailsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MoreDetailsUpdate?

    public init(initial: MoreDetailsUpdate? = nil) {
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
    public func push(_ update: MoreDetailsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension MoreDetailsPanel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "MoreDetailsPanel"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "MoreDetailsPanel" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum MoreDetailsStrings {
    public static let table = "MoreDetailsPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
