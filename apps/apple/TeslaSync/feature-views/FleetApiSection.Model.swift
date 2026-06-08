//
//  FleetApiSection.Model.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the coalesced
//  source snapshot, the in-memory source for previews/tests, the `@Observable`
//  view-model the surface binds through, and the SwiftUI half of the i18n facade.
//  The views render this model and never perform networking themselves — the
//  production app implements `FleetApiSource` over the shared dev-tools store.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for this surface. The default
/// logs via `os.Logger`; the production app injects an adapter forwarding to the
/// shared core `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted).
public protocol FleetApiTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogFleetApiTelemetry: FleetApiTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Coalesced source snapshot

/// One snapshot pushed by a `FleetApiSource`: the two shared dev-tools queries
/// (`fleet-api-info`, `public-key-status`), the vehicle options, and the live
/// connection band. The model resolves the section phase + freshness from it.
public struct FleetSnapshot: Sendable, Equatable {
    public var fleetInfo: FleetQuery
    public var publicKeyStatus: FleetQuery
    public var vehicles: [VehicleOption]
    public var connection: FleetConnection
    public var isFetching: Bool
    public var isError: Bool
    public var updatedAt: Date?

    public init(
        fleetInfo: FleetQuery = .loading,
        publicKeyStatus: FleetQuery = .loading,
        vehicles: [VehicleOption] = [],
        connection: FleetConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.fleetInfo = fleetInfo
        self.publicKeyStatus = publicKeyStatus
        self.vehicles = vehicles
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 dev-tools store (the `apiFetch('/dev-tools/…')` client); previews
/// and tests use `InMemoryFleetApiSource`. The view never talks to the network.
@MainActor
public protocol FleetApiSource: AnyObject {
    var onUpdate: (@MainActor (FleetSnapshot) -> Void)? { get set }
    var onResult: (@MainActor (String, ToolResult) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Runs a dev-tools request (port of `apiFetch`), reporting its `ToolResult`
    /// back through `onResult` keyed by `request.id`.
    func perform(_ request: FleetRequest)
}

/// In-memory source for previews + unit/UI tests. Drive queries with `push(_:)`
/// and resolve actions with the canned table (auto) or `resolve(_:_:)` (manual).
@MainActor
public final class InMemoryFleetApiSource: FleetApiSource {
    public var onUpdate: (@MainActor (FleetSnapshot) -> Void)?
    public var onResult: (@MainActor (String, ToolResult) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var performed: [FleetRequest] = []

    private let initial: FleetSnapshot?
    private let canned: [String: ToolResult]
    private let autoResolve: Bool

    public init(
        initial: FleetSnapshot? = nil,
        canned: [String: ToolResult] = [:],
        autoResolve: Bool = true
    ) {
        self.initial = initial
        self.canned = canned
        self.autoResolve = autoResolve
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

    public func perform(_ request: FleetRequest) {
        performed.append(request)
        guard autoResolve else { return }
        onResult?(request.id, canned[request.id] ?? .success(.object(request.body ?? [:])))
    }

    /// Pushes a query snapshot to the bound model (test/preview affordance).
    public func push(_ snapshot: FleetSnapshot) {
        onUpdate?(snapshot)
    }

    /// Resolves a pending action result (used when `autoResolve` is off).
    public func resolve(_ id: String, _ result: ToolResult) {
        onResult?(id, result)
    }
}

// MARK: - Observable view-model

/// The surface's observable view-model. Subscribes to a `FleetApiSource`, exposes
/// the two shared queries + vehicle options + per-action results, and resolves the
/// section render phase + freshness. Each tool view holds its own ephemeral input
/// state (mirroring the web per-tool `useState`) and renders the outcome filed
/// under its request id here.
@MainActor
@Observable
public final class FleetApiSectionModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "FleetApiSection"

    public private(set) var fleetInfo: FleetQuery = .loading
    public private(set) var publicKeyStatus: FleetQuery = .loading
    public private(set) var vehicles: [VehicleOption] = []
    public private(set) var connection: FleetConnection = .live
    public private(set) var updatedAt: Date?
    public private(set) var results: [String: ToolResult] = [:]

    @ObservationIgnored private let source: any FleetApiSource
    @ObservationIgnored private let telemetry: any FleetApiTelemetry
    @ObservationIgnored private var isFetching = false
    @ObservationIgnored private var isError = false
    @ObservationIgnored private var started = false

    public init(
        source: any FleetApiSource,
        telemetry: any FleetApiTelemetry = OSLogFleetApiTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] snapshot in self?.apply(snapshot) }
        source.onResult = { [weak self] id, result in self?.results[id] = result }
    }

    /// The canonical onboarding steps (port of `ONBOARDING_STEPS`).
    public var onboardingSteps: [OnboardingStep] {
        FleetApiContent.onboardingSteps()
    }

    /// Whether the local keypair is configured (drives onboarding auto-detect).
    public var isKeypairConfigured: Bool {
        guard case let .loaded(value) = publicKeyStatus else { return false }
        return FleetApiBuilder.publicKeyStatus(from: value).configured
    }

    /// Whether the Fleet API is authenticated (drives onboarding auto-detect).
    public var isAuthenticated: Bool {
        guard case let .loaded(value) = fleetInfo else { return false }
        return FleetApiBuilder.configInfo(from: value).authenticated
    }

    /// The discovered partner hostname (used for the pairing URL).
    public var hostname: String {
        guard case let .loaded(value) = fleetInfo else { return "" }
        return FleetApiBuilder.configInfo(from: value).hostname ?? ""
    }

    /// The resolved section shell branch.
    public var phase: FleetRenderPhase {
        FleetApiBuilder.resolveSectionPhase(
            fleetInfo: fleetInfo,
            publicKeyStatus: publicKeyStatus,
            hasVehicles: !vehicles.isEmpty
        )
    }

    /// The resolved freshness-chip status.
    public var freshness: FleetFreshness {
        FleetApiBuilder.resolveFreshness(connection: connection, isFetching: isFetching, isError: isError)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of the shared queries (wired to the freshness chip + retry).
    public func refresh() {
        source.refresh()
    }

    /// Runs a tool request: files a `.loading` marker, then delegates to the
    /// source, whose `onResult` callback files the final outcome under `request.id`.
    public func run(_ request: FleetRequest) {
        results[request.id] = .loading
        source.perform(request)
    }

    /// The current result filed under a request id (`.idle` when never run).
    public func result(for id: String, idleKey: String = "", idleFallback: String = "") -> ToolResult {
        results[id] ?? .idle(messageKey: idleKey, fallback: idleFallback)
    }

    private func apply(_ snapshot: FleetSnapshot) {
        fleetInfo = snapshot.fleetInfo
        publicKeyStatus = snapshot.publicKeyStatus
        vehicles = snapshot.vehicles
        connection = snapshot.connection
        isFetching = snapshot.isFetching
        isError = snapshot.isError
        updatedAt = snapshot.updatedAt
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension FleetApiStrings {
    /// A `Text` resolved by key with the web English fallback (verbatim so the
    /// resolved value is not re-interpreted as a format string).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
