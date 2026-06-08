//
//  TeslaApiRefTool.Model.swift
//  TeslaSync — P4 feature view · 0020 · TeslaApiRefTool (Apple)
//
//  The telemetry seam (P1/S11), the state-holder seam (P1/S8), the observable
//  view-model, and the SwiftUI half of the i18n facade. The view binds through this
//  model and never performs networking itself.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for this surface.
/// The default implementation logs via `os.Logger`; the production app injects an
/// adapter that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol TeslaApiRefTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogTeslaApiRefTelemetry: TeslaApiRefTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state-holder layer; the bundled reference catalog is delivered by
/// `StaticTeslaApiRefSource`, and previews / tests use `InMemoryTeslaApiRefSource`. The
/// view never talks to the network directly.
@MainActor
public protocol TeslaApiRefSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ApiRefUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// Delivers the bundled `TeslaApiCatalog` through the seam — the production binding for
/// the static reference table the web reads from the `TESLA_ENDPOINTS` constant. It is
/// transport-free: `start()` / `refresh()` publish the catalog as a live, loaded
/// snapshot so the view renders content without any networking.
@MainActor
public final class StaticTeslaApiRefSource: TeslaApiRefSource {
    public var onUpdate: (@MainActor (ApiRefUpdate) -> Void)?
    private let endpoints: [TeslaApiEndpoint]

    public init(endpoints: [TeslaApiEndpoint] = TeslaApiCatalog.endpoints) {
        self.endpoints = endpoints
    }

    public func start() {
        publish()
    }

    public func stop() {}

    public func refresh() {
        publish()
    }

    private func publish() {
        onUpdate?(
            ApiRefUpdate(
                status: .loaded,
                connection: .live,
                endpoints: endpoints,
                updatedAt: Date()
            )
        )
    }
}

/// In-memory source for previews + unit / UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTeslaApiRefSource: TeslaApiRefSource {
    public var onUpdate: (@MainActor (ApiRefUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ApiRefUpdate?

    public init(initial: ApiRefUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: ApiRefUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Observable view-model

/// The tool's observable view-model. Subscribes to a `TeslaApiRefSource`, stores the
/// endpoint catalog, and exposes a render `phase` + freshness for SwiftUI to switch
/// over. Search is a pure view concern, so the filtered rows are recomputed by the view
/// from `endpoints` + the search text (mirroring the web `filtered` memo).
@MainActor
@Observable
public final class TeslaApiRefModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Canonical source of truth,
    /// re-exported by the view.
    public static let surfaceSlug = "TeslaApiRefTool"

    public private(set) var phase: ApiRefRenderPhase = .loading
    public private(set) var freshness: ApiRefFreshness = .fresh
    public private(set) var connection: ApiRefConnection = .live
    public private(set) var endpoints: [TeslaApiEndpoint] = []
    public private(set) var updatedAt: Date?

    /// The total number of catalog endpoints — backs the result-count caption.
    public var totalCount: Int {
        endpoints.count
    }

    @ObservationIgnored private let source: any TeslaApiRefSource
    @ObservationIgnored private let telemetry: any TeslaApiRefTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TeslaApiRefSource,
        telemetry: any TeslaApiRefTelemetry = OSLogTeslaApiRefTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Convenience init binding the bundled reference catalog through the static source.
    public convenience init(telemetry: any TeslaApiRefTelemetry = OSLogTeslaApiRefTelemetry()) {
        self.init(source: StaticTeslaApiRefSource(), telemetry: telemetry)
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

    /// Forces a refresh (cached endpoints stay visible). Wired to the chip + retry.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ApiRefUpdate) {
        connection = update.connection
        endpoints = update.endpoints
        updatedAt = update.updatedAt
        phase = TeslaApiRefBuilder.resolvePhase(status: update.status, endpointCount: update.endpoints.count)
        freshness = TeslaApiRefBuilder.resolveFreshness(update)
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension TeslaApiRefStrings {
    /// A `Text` resolved by key with the web English fallback (verbatim so the resolved
    /// value is not re-interpreted as a format string).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
