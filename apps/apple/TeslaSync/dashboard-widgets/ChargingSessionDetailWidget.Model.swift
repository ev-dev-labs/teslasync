//
//  ChargingSessionDetailWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0024 · ChargingSessionDetailWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10).
//  The view binds through `ChargingSessionDetailModel`; no networking lives in the
//  view. The model coalesces the latest charge session (web `useChargingSessions`
//  → `useChargingSessionDetail`) and its power/SoC telemetry (web
//  `useChargeTelemetry`) into the view-ready projection and a mutually-exclusive
//  render `Phase`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol ChargingSessionDetailTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogChargingSessionDetailTelemetry: ChargingSessionDetailTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The aggregate load lifecycle the web widget derives from its queries
/// (`isLoading = detailLoading || telemetryLoading`, `detailError`, success). The
/// source coalesces the detail + telemetry `Resource<T>` states into one value.
public enum ChargingSessionDetailLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip (web `DataFreshness` live / stale / offline) that the
/// `WidgetShell` renders from `isFetching` / `isStale` / `dataUpdatedAt`.
public enum ChargingSessionDetailConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// Which friendly empty surface the content shell shows. The web source has a
/// single empty branch (`!detail` → `EmptyState` "No charge sessions"), so there
/// is one reason; modeled as an enum for symmetry with the other surfaces.
public enum ChargingSessionDetailEmptyReason: Sendable, Equatable {
    case noSessions
}

/// A charge-session list row used only to pick the most-recent session (web
/// `useChargingSessions` → `latestSessionId` reduce). The production source pushes
/// the resolved `detail`/`samples`; the selector is exposed for parity + tests.
public struct ChargingSessionRef: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let startedAt: Date

    public init(id: Int64, startedAt: Date) {
        self.id = id
        self.startedAt = startedAt
    }
}

/// The resolved latest charge session (web `ApiChargingSession` detail). All
/// quantities are SI-on-disk: `energyAddedWh` in watt-hours, `durationS` in
/// seconds. The projection converts to kWh / a duration label at the display
/// boundary (web `convertEnergyFromSI(…, 'kWh')` + the `duration_min` formatter).
public struct ChargingSessionDetailInput: Sendable, Equatable {
    public var energyAddedWh: Double
    public var durationS: Double
    public var chargerType: String?

    public init(energyAddedWh: Double, durationS: Double, chargerType: String? = nil) {
        self.energyAddedWh = energyAddedWh
        self.durationS = durationS
        self.chargerType = chargerType
    }
}

/// One charge-telemetry sample (web `ChargeTelemetryReading`). `powerW` is in watts
/// (SI canonical — the projection divides by 1000 for the kW axis); `socPercent`
/// is the resolved state-of-charge (web `battery_level ?? soc`). Both nullable,
/// matching the web `number | null` so the chart can connect across gaps.
public struct ChargingSessionDetailSampleInput: Sendable, Equatable {
    public var timestamp: Date
    public var powerW: Double?
    public var socPercent: Double?

    public init(timestamp: Date, powerW: Double? = nil, socPercent: Double? = nil) {
        self.timestamp = timestamp
        self.powerW = powerW
        self.socPercent = socPercent
    }
}

/// One coalesced snapshot pushed by a `ChargingSessionDetailSource`: the latest
/// session detail + its telemetry plus the aggregate load/connection status. The
/// model turns this into the `ChargingSessionDetailSummary`/`…Point` projection
/// and a render `Phase`.
public struct ChargingSessionDetailUpdate: Sendable, Equatable {
    public var status: ChargingSessionDetailLoadStatus
    public var connection: ChargingSessionDetailConnection
    public var detail: ChargingSessionDetailInput?
    public var samples: [ChargingSessionDetailSampleInput]
    public var updatedAt: Date?

    public init(
        status: ChargingSessionDetailLoadStatus = .loading,
        connection: ChargingSessionDetailConnection = .live,
        detail: ChargingSessionDetailInput? = nil,
        samples: [ChargingSessionDetailSampleInput] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.detail = detail
        self.samples = samples
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the vehicles + charging-sessions + session-detail +
/// charge-telemetry stores); previews and tests use
/// `InMemoryChargingSessionDetailSource`. The view never talks to the network.
@MainActor
public protocol ChargingSessionDetailSource: AnyObject {
    var onUpdate: (@MainActor (ChargingSessionDetailUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a
/// `ChargingSessionDetailSource`, recomputes the projection, and exposes a render
/// `Phase` + freshness + empty reason for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargingSessionDetailModel {
    /// The mutually-exclusive render branches (web shell skeleton / error / body).
    public enum Phase: Equatable {
        case loading
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargingSessionDetailConnection = .live
    public private(set) var summary: ChargingSessionDetailSummary?
    public private(set) var points: [ChargingSessionDetailPoint] = []
    public private(set) var emptyReason: ChargingSessionDetailEmptyReason? = .noSessions
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargingSessionDetailSource
    @ObservationIgnored private let telemetry: any ChargingSessionDetailTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ChargingSessionDetailSource,
        telemetry: any ChargingSessionDetailTelemetry = OSLogChargingSessionDetailTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargingSessionDetailWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached values stay visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChargingSessionDetailUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let detail = update.detail {
            summary = ChargingSessionDetailProjection.summary(detail: detail, samples: update.samples)
            points = ChargingSessionDetailProjection.points(from: update.samples)
            emptyReason = nil
        } else {
            summary = nil
            points = []
            emptyReason = .noSessions
        }
        phase = Self.resolvePhase(status: update.status, hasContent: update.detail != nil)
    }

    /// Resolves the render phase with the web shell's precedence: a hard query
    /// error replaces the body (web `error ? <QueryError/>`); the skeleton shows
    /// only on the initial fetch with nothing cached; otherwise the content shell
    /// renders (and shows its own friendly empty surface when there is no session).
    public static func resolvePhase(status: ChargingSessionDetailLoadStatus, hasContent: Bool) -> Phase {
        switch status {
        case let .failed(message):
            .error(message)
        case .loading:
            hasContent ? .content : .loading
        case .loaded:
            .content
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargingSessionDetailSource: ChargingSessionDetailSource {
    public var onUpdate: (@MainActor (ChargingSessionDetailUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingSessionDetailUpdate?

    public init(initial: ChargingSessionDetailUpdate? = nil) {
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
    public func push(_ update: ChargingSessionDetailUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the
/// "ChargingSessionDetailWidget" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time.
public enum ChargingSessionDetailStrings {
    public static let table = "ChargingSessionDetailWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
