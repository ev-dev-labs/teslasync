//
//  PollingEngine.Model.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  The state-holder seam (P1/S8), the i18n facade (P1/S10), and the telemetry seam (P1/S11) for the
//  adaptive-polling panel. The view binds through `PollingEngineModel`; no networking lives in the
//  view. The web source composes two `useQuery` reads (`getPollingStatus` every 15 s,
//  `getPollingSavings` every 30 s) with `useTranslation`, and renders `null` when polling is
//  disabled. The coalesced input snapshot here carries the decoded status + savings + the P4
//  connectivity axis rather than opening the HTTP reads itself; the production app implements the
//  source over the shared polling repositories, while previews / tests use the in-memory source.
//
//  Withdraw parity (web `if (!status?.enabled) return null`): a resolved-disabled snapshot withdraws
//  the whole surface (`isWithdrawn`), and `view.opened` is deferred until the surface first presents
//  non-withdrawn chrome — mirroring the web tree, which never mounts the panel while disabled.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold
/// no hardcoded prose. Keys live in the "PollingEngine" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In test / preview bundles (where the table
/// is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection
/// deterministic.
public enum PollingEngineStrings {
    public static let table = "PollingEngine"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a templated key and substitutes the positional arguments. The template is localized
    /// first, so translators control word order around the substituted values.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PollingEngineTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPollingEngineTelemetry: PollingEngineTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Decoded data snapshot (native peers of the `@/api/polling` types)

/// The forecast hint a decision may carry — the peer of `PredictionInfo`. `estimatedInNanos` is the
/// raw Go `time.Duration` span the web divides by `1e6` for display.
public struct PollingPrediction: Sendable, Equatable {
    public var nextState: String
    public var estimatedInNanos: Double
    public var confidence: Double
    public var basedOn: String

    public init(nextState: String, estimatedInNanos: Double, confidence: Double, basedOn: String) {
        self.nextState = nextState
        self.estimatedInNanos = estimatedInNanos
        self.confidence = confidence
        self.basedOn = basedOn
    }
}

/// The most-recent polling decision for a vehicle — the peer of `PollDecision` (only the fields the
/// expanded row renders: the next interval, the reasons, and the optional prediction).
public struct PollingDecision: Sendable, Equatable {
    public var nextIntervalMs: Double
    public var reasons: [String]
    public var prediction: PollingPrediction?

    public init(nextIntervalMs: Double, reasons: [String], prediction: PollingPrediction? = nil) {
        self.nextIntervalMs = nextIntervalMs
        self.reasons = reasons
        self.prediction = prediction
    }
}

/// One vehicle's live polling status — the peer of `VehiclePollingStatus`. `nextPollAfter` is the
/// already-parsed timestamp (the web parses the ISO string at render time); a nil value models an
/// unparseable / absent timestamp.
public struct PollingVehicleStatus: Sendable, Equatable, Identifiable {
    public var vin: String
    public var activity: PollingActivity
    public var profile: PollingProfile
    public var consecIdle: Int
    public var batteryLevel: Double
    public var nextPollAfter: Date?
    public var lastDecision: PollingDecision?

    public var id: String {
        vin
    }

    public init(
        vin: String,
        activity: PollingActivity,
        profile: PollingProfile,
        consecIdle: Int,
        batteryLevel: Double,
        nextPollAfter: Date?,
        lastDecision: PollingDecision? = nil
    ) {
        self.vin = vin
        self.activity = activity
        self.profile = profile
        self.consecIdle = consecIdle
        self.batteryLevel = batteryLevel
        self.nextPollAfter = nextPollAfter
        self.lastDecision = lastDecision
    }
}

/// The cost / savings snapshot — the peer of `CostSnapshot` (only the fields the savings card
/// renders: the four metrics + the breakdown map).
public struct PollingCostSnapshot: Sendable, Equatable {
    public var pollsMade: Double
    public var pollsSaved: Double
    public var savingsPercent: Double
    public var estimatedSavings: Double
    public var remainingCredit: Double
    public var savingsBreakdown: [String: Double]

    public init(
        pollsMade: Double,
        pollsSaved: Double,
        savingsPercent: Double,
        estimatedSavings: Double,
        remainingCredit: Double,
        savingsBreakdown: [String: Double]
    ) {
        self.pollsMade = pollsMade
        self.pollsSaved = pollsSaved
        self.savingsPercent = savingsPercent
        self.estimatedSavings = estimatedSavings
        self.remainingCredit = remainingCredit
        self.savingsBreakdown = savingsBreakdown
    }
}

/// The polling-engine status — the peer of `PollEngineStatus`. `vehicles` is the ordered list the
/// web derives from `Object.entries(status.vehicles)`; the production source preserves the server
/// order (deterministic in tests).
public struct PollingStatusSnapshot: Sendable, Equatable {
    public var enabled: Bool
    public var vehicles: [PollingVehicleStatus]

    public init(enabled: Bool, vehicles: [PollingVehicleStatus]) {
        self.enabled = enabled
        self.vehicles = vehicles
    }
}

// MARK: - Input snapshot (web `useQuery` status + savings + the P4 axis)

/// The resolution state of the status read — the native shape of the `getPollingStatus` query.
/// `loading` keeps the skeleton chrome; `failed` surfaces a retryable error; `loaded` decides
/// withdraw vs. present.
public enum PollingLoadState: Sendable, Equatable {
    case loading
    case failed(String)
    case loaded(PollingStatusSnapshot)
}

/// One coalesced snapshot of the panel's inputs — the status read, the optional savings read (the
/// web `{savings && …}` guard), and the P4 connectivity axis. The view never talks to the network;
/// the source pushes updated snapshots through this value.
public struct PollingInput: Sendable, Equatable {
    public var status: PollingLoadState
    public var savings: PollingCostSnapshot?
    public var connection: PollingConnection

    public init(
        status: PollingLoadState = .loading,
        savings: PollingCostSnapshot? = nil,
        connection: PollingConnection = .live
    ) {
        self.status = status
        self.savings = savings
        self.connection = connection
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through for the panel inputs. The production app implements this over the
/// shared polling repositories (status + savings); previews and tests use
/// `InMemoryPollingEngineSource`. The feed is local + synchronous (no HTTP in the view).
@MainActor
public protocol PollingEngineSource: AnyObject {
    var onUpdate: (@MainActor (PollingInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the status + savings snapshots (header refresh + error retry + stale recovery).
    func refresh()
}

/// The production context source. Holds the host-provided snapshot and re-emits it on
/// `start`/`refresh` — the native binding point for the web `useQuery` reads. The host re-creates the
/// source (or pushes through a subclass hook) when the upstream queries settle.
@MainActor
public final class LivePollingEngineSource: PollingEngineSource {
    public var onUpdate: (@MainActor (PollingInput) -> Void)?

    private let input: PollingInput

    public init(input: PollingInput) {
        self.input = input
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    private func emit() {
        onUpdate?(input)
    }
}

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`. Call counters let the wiring + delegation
/// be asserted without a network.
@MainActor
public final class InMemoryPollingEngineSource: PollingEngineSource {
    public var onUpdate: (@MainActor (PollingInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PollingInput?

    public init(initial: PollingInput? = nil) {
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
    public func push(_ input: PollingInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The panel's observable view-model. Subscribes to a `PollingEngineSource`, recomputes the resolved
/// projection, exposes the render `phase` + the resolved panel + the `connection` axis, withdraws the
/// surface when polling is disabled (web `null`), emits `view.opened` once the surface first presents
/// non-withdrawn chrome, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class PollingEngineModel {
    public private(set) var resolved = PollingResolved(phase: .loading, ready: nil)
    public private(set) var connection: PollingConnection = .live

    public var phase: PollingResolved.Phase {
        resolved.phase
    }

    public var ready: PollingReady? {
        resolved.ready
    }

    /// Web `!status.enabled → null`: the whole surface is withdrawn. The view renders nothing.
    public var isWithdrawn: Bool {
        resolved.phase == .disabled
    }

    @ObservationIgnored private let source: any PollingEngineSource
    @ObservationIgnored private let telemetry: any PollingEngineTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any PollingEngineSource,
        telemetry: any PollingEngineTelemetry = OSLogPollingEngineTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream feed. Idempotent. Telemetry is deferred to the first non-withdrawn
    /// `apply` so a disabled-from-start surface emits no `view.opened` (web mount parity).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the status + savings snapshots (header refresh button + error retry + freshness).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: PollingInput) {
        resolved = PollingProjection.resolve(input, now: now())
        connection = input.connection
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    /// Emits `view.opened` exactly once, and only when the surface is actually presented (not
    /// withdrawn) — mirroring the web tree, which never mounts the panel while polling is disabled.
    private func maybeEmitOpen() {
        guard !didEmitOpen, resolved.phase != .disabled else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: PollingEngineMeta.surfaceSlug)
    }

    /// Stale → one guarded refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline never auto-refreshes (nothing to fetch over).
    private func handleAutoRefresh(for connection: PollingConnection) {
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
