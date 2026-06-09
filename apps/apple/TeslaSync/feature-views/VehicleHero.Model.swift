//
//  VehicleHero.Model.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the dashboard vehicle hero. The view binds through `VehicleHeroPanelModel`;
//  no networking lives in the view. The web source (VehicleHero.tsx) is a
//  presentational leaf fed `vehicle` / `state` / `firmwareVersion` props by the
//  Dashboard page, so the input snapshot here carries those (plus the parent's
//  loading / error / connectivity state) rather than issuing HTTP itself.
//
//  States: the web leaf renders the full hero when `state` is present and an "asleep"
//  panel (with a Wake Up affordance) when it is `null` — that null branch is this
//  surface's friendly empty state. On top of those, this surface honours the P4 leaf
//  contract: a `phase` (loading / data / asleep / error) fed by the parent's query
//  state, and an orthogonal `connection` axis (live / stale / offline) surfaced as a
//  freshness chip + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol VehicleHeroPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogVehicleHeroPanelTelemetry: VehicleHeroPanelTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum VehicleHeroPanelConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the Dashboard page)

/// One coalesced snapshot of the hero's inputs — the native mirror of the web props
/// (`vehicle`, `state`, `firmwareVersion`, the unit preference) plus the parent
/// surface's lifecycle (`isLoading`, an error message, and connectivity). State values
/// are SI; the projection converts them to the user's unit.
public struct VehicleHeroPanelInput: Sendable, Equatable {
    public var vehicle: VehicleHeroPanelVehicle
    public var state: VehicleHeroPanelState?
    public var firmwareVersion: String
    public var unitSystem: VehicleHeroPanelUnitSystem
    public var locale: Locale
    public var lastUpdated: Date?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: VehicleHeroPanelConnection

    public init(
        vehicle: VehicleHeroPanelVehicle,
        state: VehicleHeroPanelState? = nil,
        firmwareVersion: String = "",
        unitSystem: VehicleHeroPanelUnitSystem = .metric,
        locale: Locale = .current,
        lastUpdated: Date? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleHeroPanelConnection = .live
    ) {
        self.vehicle = vehicle
        self.state = state
        self.firmwareVersion = firmwareVersion
        self.unitSystem = unitSystem
        self.locale = locale
        self.lastUpdated = lastUpdated
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Header (always-visible identity chrome)

/// The always-visible header — the native mirror of the web hero's name + status +
/// freshness + "{model} {trim} · {vin}" line, shown in every phase.
public struct VehicleHeroPanelHeader: Sendable, Equatable {
    public let title: String
    public let status: VehicleHeroPanelStatus
    public let model: String
    public let trimBadging: String
    public let vin: String
    public let updatedAt: Date?

    public init(
        title: String,
        status: VehicleHeroPanelStatus,
        model: String,
        trimBadging: String,
        vin: String,
        updatedAt: Date?
    ) {
        self.title = title
        self.status = status
        self.model = model
        self.trimBadging = trimBadging
        self.vin = vin
        self.updatedAt = updatedAt
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the hero's render branches.
/// `phase` selects the body; the header, gauges, charging summary, stat cards, and
/// actions are pre-computed so the view is a pure function of this value.
public struct VehicleHeroPanelResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case data
        case asleep
        case error(String)
    }

    public let phase: Phase
    public let header: VehicleHeroPanelHeader
    public let vehicleID: Int64
    public let gauges: [VehicleHeroPanelGauge]
    public let charging: VehicleHeroPanelChargingDetail?
    public let statCards: [VehicleHeroPanelStatCard]
    public let actions: [VehicleHeroPanelAction]

    public init(
        phase: Phase,
        header: VehicleHeroPanelHeader,
        vehicleID: Int64,
        gauges: [VehicleHeroPanelGauge],
        charging: VehicleHeroPanelChargingDetail?,
        statCards: [VehicleHeroPanelStatCard],
        actions: [VehicleHeroPanelAction]
    ) {
        self.phase = phase
        self.header = header
        self.vehicleID = vehicleID
        self.gauges = gauges
        self.charging = charging
        self.statCards = statCards
        self.actions = actions
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit tested
/// across loading / data / asleep / error and the context-aware body.
public enum VehicleHeroPanelProjection {
    public static func resolve(_ input: VehicleHeroPanelInput, now: Date = Date()) -> VehicleHeroPanelResolved {
        let header = VehicleHeroPanelHeader(
            title: input.vehicle.title,
            status: input.state?.status ?? .offline,
            model: input.vehicle.model,
            trimBadging: input.vehicle.trimBadging,
            vin: input.vehicle.vin,
            updatedAt: input.lastUpdated ?? input.vehicle.updatedAt
        )

        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return chrome(.error(message), header, input.vehicle.id)
        }
        // Live state present → the full hero (even while a background refetch runs).
        if let state = input.state {
            return VehicleHeroPanelResolved(
                phase: .data,
                header: header,
                vehicleID: input.vehicle.id,
                gauges: VehicleHeroPanelGauges.gauges(for: state, system: input.unitSystem, locale: input.locale),
                charging: state.isCharging
                    ? VehicleHeroPanelChargingDetail.make(
                        from: state,
                        system: input.unitSystem,
                        now: now,
                        locale: input.locale
                    )
                    : nil,
                statCards: VehicleHeroPanelStats.cards(
                    for: state, firmware: input.firmwareVersion, system: input.unitSystem, locale: input.locale
                ),
                actions: VehicleHeroPanelAction.allCases
            )
        }
        // Initial fetch (web parent `isLoading`) with no snapshot yet.
        if input.isLoading {
            return chrome(.loading, header, input.vehicle.id)
        }
        // Resolved with no live state → the web "asleep" branch (this surface's empty).
        return chrome(.asleep, header, input.vehicle.id)
    }

    private static func chrome(
        _ phase: VehicleHeroPanelResolved.Phase,
        _ header: VehicleHeroPanelHeader,
        _ vehicleID: Int64
    ) -> VehicleHeroPanelResolved {
        VehicleHeroPanelResolved(
            phase: phase,
            header: header,
            vehicleID: vehicleID,
            gauges: [],
            charging: nil,
            statCards: [],
            actions: []
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// Dashboard page's resolved vehicle + live-state queries; previews and tests use
/// `InMemoryVehicleHeroPanelSource`. The view never talks to the network directly.
@MainActor
public protocol VehicleHeroPanelSource: AnyObject {
    var onUpdate: (@MainActor (VehicleHeroPanelInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The hero's observable view-model. Subscribes to a `VehicleHeroPanelSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class VehicleHeroPanelModel {
    public private(set) var resolved: VehicleHeroPanelResolved
    public private(set) var connection: VehicleHeroPanelConnection = .live

    public var phase: VehicleHeroPanelResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any VehicleHeroPanelSource
    @ObservationIgnored private let telemetry: any VehicleHeroPanelTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any VehicleHeroPanelSource,
        telemetry: any VehicleHeroPanelTelemetry = OSLogVehicleHeroPanelTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        resolved = VehicleHeroPanelProjection.resolve(VehicleHeroPanelModel.pendingInput, now: now())
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleHero.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: VehicleHeroPanelInput) {
        resolved = VehicleHeroPanelProjection.resolve(input, now: now())
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// The pre-feed loading snapshot used before the source delivers the first input.
    private static let pendingInput = VehicleHeroPanelInput(
        vehicle: VehicleHeroPanelVehicle(id: 0, displayName: "", vin: "", model: "", trimBadging: ""),
        isLoading: true
    )
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryVehicleHeroPanelSource: VehicleHeroPanelSource {
    public var onUpdate: (@MainActor (VehicleHeroPanelInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleHeroPanelInput?

    public init(initial: VehicleHeroPanelInput? = nil) {
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
    public func push(_ input: VehicleHeroPanelInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "VehicleHero" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum VehicleHeroPanelStrings {
    public static let table = "VehicleHero"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
