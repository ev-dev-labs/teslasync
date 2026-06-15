//
//  RedisDiagnosticEmptyState.Model.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10). The view binds through `RedisDiagnosticModel`; no networking
//  lives in the view. The web component is a presentational leaf fed by its parent
//  (RedisSignalViewerPage) — so the "source" here carries the parent's prop snapshot
//  (vehicleId / meta / serverError / networkError) plus the component's own
//  `useQuery(['redis-signal-keys'])` lifecycle for the "other vehicles" chips.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol RedisDiagnosticTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogRedisDiagnosticTelemetry: RedisDiagnosticTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Keys query lifecycle (web `useQuery(['redis-signal-keys'])`)

/// The load lifecycle of the component's own "other vehicles" keys query. Mirrors the
/// web `useQuery` states the component reads (`isError` → drop the section; resolved
/// `keysData` → filter; pending → nothing yet).
public enum RedisDiagnosticKeysState: Sendable, Equatable {
    case idle
    case loading
    case failed
    case loaded([RedisSignalKeyEntry])
}

/// The resolved render state of the "other vehicles" sub-section. `hidden` matches the
/// web (no chips when the branch omits them, the query failed, or the filtered set is
/// empty); `loading` is the native skeleton chrome for the initial keys fetch; `chips`
/// carries the filtered, display-ready entries.
public enum RedisDiagnosticChipsPhase: Sendable, Equatable {
    case hidden
    case loading
    case chips([RedisSignalKeyEntry])
}

// MARK: - Input snapshot (web props from RedisSignalViewerPage + the keys query)

/// One coalesced snapshot of the component's inputs — the native mirror of the web props
/// (`vehicleId`, `meta`, `serverError`, `networkError`) plus the keys-query state and the
/// app base URL used to resolve the docs CTA. The production source composes this from
/// the parent's redis-signals query + the keys query; previews/tests construct it directly.
public struct RedisDiagnosticInput: Sendable, Equatable {
    public var vehicleId: Int
    public var meta: RedisDiagnosticSignalsMeta?
    public var serverError: RedisApiError?
    public var networkError: Bool
    public var keys: RedisDiagnosticKeysState
    public var docsBaseURL: URL?

    public init(
        vehicleId: Int,
        meta: RedisDiagnosticSignalsMeta? = nil,
        serverError: RedisApiError? = nil,
        networkError: Bool = false,
        keys: RedisDiagnosticKeysState = .idle,
        docsBaseURL: URL? = RedisDiagnosticDocs.defaultBase
    ) {
        self.vehicleId = vehicleId
        self.meta = meta
        self.serverError = serverError
        self.networkError = networkError
        self.keys = keys
        self.docsBaseURL = docsBaseURL
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the parent's
/// redis-signals query (for `meta` / `serverError` / `networkError`) composed with the
/// keys query; previews + tests use `InMemoryRedisDiagnosticSource`. The view never talks
/// to the network directly.
@MainActor
public protocol RedisDiagnosticSource: AnyObject {
    var onUpdate: (@MainActor (RedisDiagnosticInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the redis-signals + keys queries (wired to the retry affordance).
    func refresh()
    /// Switches the viewer to another vehicle (web `onSelectVehicle`).
    func selectVehicle(_ vehicleId: Int)
}

/// The surface's observable view-model. Subscribes to a `RedisDiagnosticSource`,
/// recomputes the resolved diagnostic branch + the chips phase, and exposes them for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class RedisDiagnosticModel {
    public private(set) var resolved: RedisDiagnosticResolved = RedisDiagnosticProjection.legacyEmpty
    public private(set) var chips: RedisDiagnosticChipsPhase = .hidden
    public private(set) var meta: RedisDiagnosticSignalsMeta?
    public private(set) var docsBaseURL: URL? = RedisDiagnosticDocs.defaultBase

    @ObservationIgnored private let source: any RedisDiagnosticSource
    @ObservationIgnored private let telemetry: any RedisDiagnosticTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any RedisDiagnosticSource,
        telemetry: any RedisDiagnosticTelemetry = OSLogRedisDiagnosticTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RedisDiagnosticEmptyState.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream queries.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the queries (wired to the retry affordance on the error branches).
    public func refresh() {
        source.refresh()
    }

    /// Switches the viewer to the tapped vehicle (web `onSelectVehicle(id)`).
    public func selectVehicle(_ vehicleId: Int) {
        source.selectVehicle(vehicleId)
    }

    private func apply(_ input: RedisDiagnosticInput) {
        let branch = RedisDiagnosticProjection.resolve(
            meta: input.meta,
            serverError: input.serverError,
            networkError: input.networkError,
            now: now()
        )
        resolved = branch
        meta = input.meta
        docsBaseURL = input.docsBaseURL
        chips = Self.chipsPhase(for: branch, keys: input.keys, vehicleId: input.vehicleId)
    }

    /// Resolves the chips sub-section phase from the branch + the keys-query state (web
    /// `keysQueryError ? [] : keysData?.keys.filter(…) ?? []`, plus the native loading chrome).
    nonisolated static func chipsPhase(
        for branch: RedisDiagnosticResolved,
        keys: RedisDiagnosticKeysState,
        vehicleId: Int
    ) -> RedisDiagnosticChipsPhase {
        guard branch.showsOtherKeys else { return .hidden }
        switch keys {
        case .loading:
            return .loading
        case let .loaded(entries):
            let filtered = RedisDiagnosticProjection.otherKeys(entries, excluding: vehicleId)
            return filtered.isEmpty ? .hidden : .chips(filtered)
        case .idle, .failed:
            return .hidden
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryRedisDiagnosticSource: RedisDiagnosticSource {
    public var onUpdate: (@MainActor (RedisDiagnosticInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var selectedVehicles: [Int] = []

    private let initial: RedisDiagnosticInput?

    public init(initial: RedisDiagnosticInput? = nil) {
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

    public func selectVehicle(_ vehicleId: Int) {
        selectedVehicles.append(vehicleId)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: RedisDiagnosticInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "RedisDiagnosticEmptyState" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum RDStrings {
    public static let table = "RedisDiagnosticEmptyState"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
