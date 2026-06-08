//
//  BrowserPushChannelCard.Source.swift
//  TeslaSync — P4 feature view · 0181 · BrowserPushChannelCard (Apple)
//
//  The P1/S8 state-holder seam the BrowserPushChannelCard view-model binds through:
//  the load lifecycle + live-connection freshness, the coalesced snapshot the six
//  web data hooks project into, the `@MainActor` source protocol (production wires
//  it over the shared push state holders), and the in-memory source previews/tests
//  drive. No networking lives in the view — the source owns every effect.
//

import Foundation

// MARK: - Load + connection status (state-holder seam, P1/S8)

/// The load lifecycle for the surface's data slice, mirroring the shared
/// `LoadableState` a production source projects from the push `Resource<T>`.
public enum BrowserPushChannelCardStatus: Equatable, Sendable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): `live`, `stale` (older than the freshness
/// window), `offline` (no connectivity — the cached snapshot is shown). Drives the
/// freshness chip + the auto-refresh affordance.
public enum BrowserPushChannelCardConnection: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a source: the load status, the live-connection
/// freshness, the per-device capability (or `nil` before the first resolve), the
/// registered-device rows, and the observed time. The model turns this into the
/// render phase.
public struct BrowserPushChannelCardUpdate: Equatable, Sendable {
    public var status: BrowserPushChannelCardStatus
    public var connection: BrowserPushChannelCardConnection
    public var capability: BrowserPushCapability?
    public var devices: [BrowserPushDeviceRow]
    public var updatedAt: Date?

    public init(
        status: BrowserPushChannelCardStatus = .loading,
        connection: BrowserPushChannelCardConnection = .live,
        capability: BrowserPushCapability? = nil,
        devices: [BrowserPushDeviceRow] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.capability = capability
        self.devices = devices
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 push state holders; previews/tests use the in-memory source. The view
/// never talks to the network directly. The three effects mirror the web
/// `subscribe()` / `unsubscribe()` / `unsubMut.mutateAsync(endpoint)` calls.
@MainActor
public protocol BrowserPushChannelCardSource: AnyObject {
    var onUpdate: (@MainActor (BrowserPushChannelCardUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Enable push on THIS device (web `subscribe()`).
    func enable()
    /// Disable push on THIS device (web `unsubscribe()`).
    func disable()
    /// Revoke a registered device by endpoint (web `unsubMut.mutateAsync(endpoint)`).
    func remove(endpoint: String)
}

// MARK: - In-memory source (previews + unit/UI tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)` and
/// inspect the recorded effects.
@MainActor
public final class InMemoryBrowserPushChannelCardSource: BrowserPushChannelCardSource {
    public var onUpdate: (@MainActor (BrowserPushChannelCardUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var enableCount = 0
    public private(set) var disableCount = 0
    public private(set) var removedEndpoints: [String] = []

    private let initial: BrowserPushChannelCardUpdate?

    public init(initial: BrowserPushChannelCardUpdate? = nil) {
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

    public func enable() {
        enableCount += 1
    }

    public func disable() {
        disableCount += 1
    }

    public func remove(endpoint: String) {
        removedEndpoints.append(endpoint)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: BrowserPushChannelCardUpdate) {
        onUpdate?(update)
    }
}
