//
//  InfrastructureSection.Model.swift
//  TeslaSync — P4 feature view · 0006 · InfrastructureSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the dev-tools Infrastructure surface. The view binds through `InfrastructureModel`
//  and never performs networking itself: tool execution + connectivity flow through
//  an injected `InfrastructureSource` (the production app wires it to the dev-tools
//  client; previews/tests use `InMemoryInfrastructureSource`).
//
//  The web source is a grid of on-demand `useMutation` tools (no live query): four
//  `BackendTool`s (db-stats, migration-status, env-check, runtime-info) plus an MQTT
//  test tool (topic+message → mqtt-test). Each tool owns its own run lifecycle
//  (idle → running → completed). The surface additionally carries a reachability /
//  freshness state so every required state (loading/empty/error/stale/offline)
//  renders, mirroring the established widget connection model.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the surface-open product-analytics event. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared
/// core `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted there).
public protocol InfrastructureTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogInfrastructureTelemetry: InfrastructureTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity / freshness (native chrome for the required states)

/// Dev-tools service reachability + freshness, mirroring `LiveConnectionState`
/// (ADR-013). `online` = reachable; `stale` = reachable but the last contact is
/// older than the freshness window (auto-refresh nudge); `offline` = unreachable
/// (run is disabled, cached results stay visible behind an offline chip).
public enum InfraConnection: Sendable, Equatable {
    case online
    case stale
    case offline
}

// MARK: - State-holder seam (P1/S8 layer)

/// One coalesced connectivity snapshot pushed by a source.
public struct InfraConnectivityUpdate: Sendable, Equatable {
    public var connection: InfraConnection
    public var updatedAt: Date?

    public init(connection: InfraConnection, updatedAt: Date? = nil) {
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// dev-tools client + the shared connectivity store; previews/tests use
/// `InMemoryInfrastructureSource`. The view never talks to the network directly.
@MainActor
public protocol InfrastructureSource: AnyObject {
    /// Pushes connectivity/freshness changes (reachability of the dev-tools API).
    var onConnectivity: (@MainActor (InfraConnectivityUpdate) -> Void)? { get set }
    /// Begins observing connectivity.
    func start()
    /// Stops observing.
    func stop()
    /// Re-probes connectivity (wired to the surface refresh affordance).
    func refresh()
    /// Executes a tool against its endpoint and returns the projected result.
    func run(toolID: String, inputs: InfraToolInputs) async -> InfraToolResult
}

/// Freshness policy: a completed result older than `window` is "stale".
public enum InfraFreshness {
    /// Default freshness window (web dev-tools have no live feed; 60s is a sensible
    /// "this snapshot may be out of date, re-run" threshold).
    public static let window: TimeInterval = 60

    public static func isStale(ranAt: Date?, now: Date, window: TimeInterval = window) -> Bool {
        guard let ranAt else { return false }
        return now.timeIntervalSince(ranAt) > window
    }
}

/// The surface view-model. Owns the per-tool run lifecycles + the connectivity
/// chip, subscribes to an `InfrastructureSource`, and exposes everything the grid
/// renders. `@Observable` so SwiftUI tracks fine-grained changes.
@MainActor
@Observable
public final class InfrastructureModel {
    /// Surface render phase: `loading` until the first connectivity snapshot lands
    /// (initial skeleton chrome), then `ready` (the tool grid, including the offline
    /// presentation). The web renders the grid immediately; the brief skeleton is
    /// the native-idiomatic initial-mount affordance required by the state matrix.
    public enum Phase: Sendable, Equatable {
        case loading
        case ready
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: InfraConnection = .online
    public private(set) var tools: [InfraToolState]
    public private(set) var updatedAt: Date?

    /// Whether the dev-tools API is currently unreachable (run disabled, cached
    /// results stay visible behind the offline chip).
    public var isOffline: Bool {
        connection == .offline
    }

    @ObservationIgnored private let source: any InfrastructureSource
    @ObservationIgnored private let telemetry: any InfrastructureTelemetry
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any InfrastructureSource,
        telemetry: any InfrastructureTelemetry = OSLogInfrastructureTelemetry(),
        catalog: [InfraTool] = InfraToolCatalog.all,
        now: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        tools = catalog.map { InfraToolState(tool: $0) }
        source.onConnectivity = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: InfrastructureSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the connectivity feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-probes connectivity (wired to the surface freshness chip refresh).
    public func refresh() {
        source.refresh()
    }

    /// Runs a tool (web `mutation.mutate()`), fire-and-forget for the UI. No-op
    /// while that tool is already running or while offline (run is disabled with the
    /// cached result visible).
    public func run(toolID: String, inputs: InfraToolInputs = .empty) {
        Task { @MainActor [weak self] in
            await self?.performRun(toolID: toolID, inputs: inputs)
        }
    }

    /// The awaitable core of `run` — sets the tool `running`, awaits the source, and
    /// lands the projected result. Returns `nil` when the run was skipped (offline /
    /// already running / unknown tool). Exposed so tests drive runs deterministically.
    @discardableResult
    public func performRun(toolID: String, inputs: InfraToolInputs = .empty) async -> InfraToolResult? {
        guard connection != .offline else { return nil }
        guard let index = tools.firstIndex(where: { $0.id == toolID }), !tools[index].isRunning else { return nil }
        tools[index].phase = .running
        let result = await source.run(toolID: toolID, inputs: inputs)
        if let landing = tools.firstIndex(where: { $0.id == toolID }) {
            tools[landing].phase = .completed(result, ranAt: now())
        }
        return result
    }

    /// Restores previously-fetched (cached) results — e.g. the last successful run
    /// reloaded so the surface shows data immediately and keeps it visible while
    /// offline. Also used by previews/tests to seed deterministic completed states.
    public func restore(_ cached: [String: InfraToolResult], at date: Date) {
        for (toolID, result) in cached {
            guard let index = tools.firstIndex(where: { $0.id == toolID }) else { continue }
            tools[index].phase = .completed(result, ranAt: date)
        }
    }

    /// Whether a tool's latest result is older than the freshness window.
    public func isStale(_ state: InfraToolState) -> Bool {
        InfraFreshness.isStale(ranAt: state.ranAt, now: now())
    }

    private func apply(_ update: InfraConnectivityUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        phase = .ready
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory `InfrastructureSource` for previews + unit/UI tests. Returns canned
/// results per tool id and lets tests drive connectivity with `push(_:)`.
@MainActor
public final class InMemoryInfrastructureSource: InfrastructureSource {
    public var onConnectivity: (@MainActor (InfraConnectivityUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var runCount = 0
    public private(set) var lastInputs: InfraToolInputs?

    private let initial: InfraConnectivityUpdate?
    private let results: [String: InfraToolResult]
    private let defaultResult: InfraToolResult

    public init(
        initial: InfraConnectivityUpdate? = InfraConnectivityUpdate(connection: .online, updatedAt: Date()),
        results: [String: InfraToolResult] = [:],
        defaultResult: InfraToolResult = .success(json: "{\n  \"ok\": true\n}")
    ) {
        self.initial = initial
        self.results = results
        self.defaultResult = defaultResult
    }

    public func start() {
        startCount += 1
        if let initial { onConnectivity?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
        if let initial { onConnectivity?(initial) }
    }

    public func run(toolID: String, inputs: InfraToolInputs) async -> InfraToolResult {
        runCount += 1
        lastInputs = inputs
        return results[toolID] ?? defaultResult
    }

    /// Pushes a connectivity snapshot to the bound model (test/preview affordance).
    public func push(_ update: InfraConnectivityUpdate) {
        onConnectivity?(update)
    }
}
