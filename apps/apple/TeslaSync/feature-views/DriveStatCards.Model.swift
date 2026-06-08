//
//  DriveStatCards.Model.swift
//  TeslaSync — P4 feature view · 0139 · DriveStatCards (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10).
//  The view binds through `DriveStatCardsModel`; no networking lives in the view. SwiftUI
//  parity of features/driving/components/drive-detail/DriveStatCards.tsx — the drive-detail
//  summary that renders a drive's `distance / duration / max+avg speed / SOC / max power /
//  elevation / cost` as a grid of `IconStatCard` tiles. The web component receives its
//  `drive` + computed `stats` from the parent `useDriveDetailData` query and its display
//  units / cost settings from `useUnits` + `useFormatting`; the production app composes all
//  three into the `DriveStatCardsSource` seam below.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol DriveStatCardsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogDriveStatCardsTelemetry: DriveStatCardsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drive-detail query, mirroring the shared
/// `LoadableState` cases the web parent projects from `useDriveDetailData` (web `isLoading`
/// skeleton / resolved drive+stats / empty / failure).
public enum DriveStatCardsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner
/// so cached tiles are clearly labeled while reconnecting / offline.
public enum DriveStatCardsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The drive fields + computed stat values the web `DriveStatCards` reads from its `drive`
/// (`DriveDetail`, SI canonical) and `stats` (`DriveStats`) props. Only the fields the tiles
/// actually render are modeled. The speed fields are already in the user's display unit (the
/// web `stats.maxSpd` = `toSpeedDisplay(drive.maxSpeedMps)`); distance/duration/energy are SI.
public struct DriveStatCardsInput: Sendable, Equatable {
    /// `drive.distanceM` — meters (SI). Converted to the display unit by the projection.
    public var distanceM: Double
    /// `drive.durationS` — seconds (SI). Split into `Xh Ym` by the projection.
    public var durationS: Double
    /// `drive.startBatteryPct` — percent; `nil` renders `0` (web `fmtInt(null)` → `0`).
    public var startBatteryPct: Double?
    /// `drive.endBatteryPct` — percent; `nil` renders `0`.
    public var endBatteryPct: Double?
    /// `stats.maxSpd` — already in the display speed unit (upstream `toSpeedDisplay`).
    public var maxSpeed: Double
    /// `stats.avgSpd` — already in the display speed unit.
    public var avgSpeed: Double
    /// `stats.powerMax` — kilowatts (the web hardcodes the `kW` unit).
    public var powerMax: Double
    /// `stats.elevGain` — meters; rounded for display.
    public var elevGain: Double
    /// `stats.elevLoss` — meters; rounded for display.
    public var elevLoss: Double
    /// `stats.energyWh` — watt-hours; gates (and feeds) the two cost tiles.
    public var energyWh: Double

    public init(
        distanceM: Double = 0,
        durationS: Double = 0,
        startBatteryPct: Double? = nil,
        endBatteryPct: Double? = nil,
        maxSpeed: Double = 0,
        avgSpeed: Double = 0,
        powerMax: Double = 0,
        elevGain: Double = 0,
        elevLoss: Double = 0,
        energyWh: Double = 0
    ) {
        self.distanceM = distanceM
        self.durationS = durationS
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
        self.maxSpeed = maxSpeed
        self.avgSpeed = avgSpeed
        self.powerMax = powerMax
        self.elevGain = elevGain
        self.elevLoss = elevLoss
        self.energyWh = energyWh
    }
}

/// The user's display + cost preferences for this surface (web `useUnits().unitPrefs` +
/// `useFormatting`). Stores the SI label strings the shared enums round-trip through
/// (`"km"`, `"mph"`, …), the decimal precision (web global precision = `settings.decimal_precision`),
/// the currency symbol, and the per-kWh energy cost.
public struct DriveStatCardsFormatting: Sendable, Equatable {
    public var distanceUnit: String
    public var speedUnit: String
    public var locale: String?
    public var precision: Int
    public var currencySymbol: String
    public var costPerKwh: Double

    public init(
        distanceUnit: String = "km",
        speedUnit: String = "km/h",
        locale: String? = nil,
        precision: Int = 2,
        currencySymbol: String = "$",
        costPerKwh: Double = 0.12
    ) {
        self.distanceUnit = distanceUnit
        self.speedUnit = speedUnit
        self.locale = locale
        self.precision = precision
        self.currencySymbol = currencySymbol
        self.costPerKwh = costPerKwh
    }
}

/// One coalesced snapshot pushed by a `DriveStatCardsSource`: the query load status + the
/// drive/stats payload + the display/cost preferences + the (shared) connection + the
/// in-flight refresh flag.
public struct DriveStatCardsUpdate: Sendable, Equatable {
    public var status: DriveStatCardsLoadStatus
    public var input: DriveStatCardsInput?
    public var formatting: DriveStatCardsFormatting
    public var refreshing: Bool
    public var connection: DriveStatCardsConnection
    public var updatedAt: Date?

    public init(
        status: DriveStatCardsLoadStatus = .loading,
        input: DriveStatCardsInput? = nil,
        formatting: DriveStatCardsFormatting = DriveStatCardsFormatting(),
        refreshing: Bool = false,
        connection: DriveStatCardsConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.formatting = formatting
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders — composing the drive-detail query (web `useDriveDetailData`) with the unit-
/// preference holder (web `useUnits`) and the cost/formatting holder (web `useFormatting`),
/// plus a refresh affordance. Previews + tests use `InMemoryDriveStatCardsSource`. The view
/// never talks to the network directly.
@MainActor
public protocol DriveStatCardsSource: AnyObject {
    var onUpdate: (@MainActor (DriveStatCardsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the drive-detail query from the backend (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `DriveStatCardsSource`, projects the
/// drive/stats payload + preferences into the view-ready tiles, and exposes a render
/// `DriveStatCardsPhase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DriveStatCardsModel {
    public private(set) var connection: DriveStatCardsConnection = .live
    public private(set) var phase: DriveStatCardsPhase = .loading
    public private(set) var cards: [DriveStatCardsItem] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DriveStatCardsSource
    @ObservationIgnored private let telemetry: any DriveStatCardsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DriveStatCardsSource,
        telemetry: any DriveStatCardsTelemetry = OSLogDriveStatCardsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DriveStatCards.surfaceSlug)
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

    private func apply(_ update: DriveStatCardsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        refreshing = update.refreshing
        cards = DriveStatCardsProjection.cards(from: update.input, formatting: update.formatting)
        phase = DriveStatCardsProjection.resolvePhase(update.status, hasValue: update.input != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh of the drive-detail query (prompt "stale chip + auto-
    /// refresh"); reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: DriveStatCardsConnection) {
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
public final class InMemoryDriveStatCardsSource: DriveStatCardsSource {
    public var onUpdate: (@MainActor (DriveStatCardsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveStatCardsUpdate?

    public init(initial: DriveStatCardsUpdate? = nil) {
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
    public func push(_ update: DriveStatCardsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension DriveStatCards {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "DriveStatCards"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "DriveStatCards" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `label(_:_:_:)` additionally applies
/// the runtime interpolation argument for the one templated key (`driveDetail.costPerUnit`).
public enum DriveStatCardsStrings {
    public static let table = "DriveStatCards"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves a label, substituting any positional arguments (web i18next `{{unit}}`). Used
    /// by the `Cost / {{unit}}` tile, whose `%@` is replaced with the display distance unit.
    public static func label(_ key: String, _ fallback: String, _ args: [String] = []) -> String {
        let raw = string(key, fallback)
        guard !args.isEmpty else { return raw }
        return String(format: raw, arguments: args)
    }
}
