//
//  SignalCatalogWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0087 · SignalCatalogWidget (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the observable
//  view-model, and the SwiftUI half of the i18n facade. The view binds through
//  this model and never performs networking itself.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for this surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol SignalCatalogTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSignalCatalogTelemetry: SignalCatalogTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` fed by the KMP
/// telemetry `SignalCatalogStore` + the per-vehicle `SignalObservationsStore`);
/// previews and tests use `InMemorySignalCatalogSource`. The view never talks to
/// the network directly.
@MainActor
public protocol SignalCatalogSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SignalCatalogUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySignalCatalogSource: SignalCatalogSource {
    public var onUpdate: (@MainActor (SignalCatalogUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalCatalogUpdate?

    public init(initial: SignalCatalogUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: SignalCatalogUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Observable view-model

/// The widget's observable view-model. Subscribes to a `SignalCatalogSource`,
/// tallies the observation counts, and exposes the catalog entries + a render
/// `phase` + freshness for SwiftUI to switch over. Search is a pure view concern,
/// so the grouped projection is recomputed by the view from `entries` +
/// `observationCounts` + the search text (mirroring the web `useMemo` chain).
@MainActor
@Observable
public final class SignalCatalogModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Canonical source of truth,
    /// re-exported by the view for the registry.
    public static let surfaceSlug = "SignalCatalogWidget"

    public private(set) var phase: CatalogRenderPhase = .loading
    public private(set) var freshness: CatalogFreshness = .fresh
    public private(set) var connection: CatalogConnection = .live
    public private(set) var entries: [SignalCatalogEntry] = []
    public private(set) var observationCounts: [String: Int] = [:]
    public private(set) var updatedAt: Date?

    /// The total number of catalog signals — backs the compact big-number layout.
    public var totalCount: Int {
        entries.count
    }

    @ObservationIgnored private let source: any SignalCatalogSource
    @ObservationIgnored private let telemetry: any SignalCatalogTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SignalCatalogSource,
        telemetry: any SignalCatalogTelemetry = OSLogSignalCatalogTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
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

    /// Forces a network refresh (cached entries stay visible). Wired to the chip +
    /// retry affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SignalCatalogUpdate) {
        connection = update.connection
        entries = update.entries
        observationCounts = SignalCatalogBuilder.observationCounts(update.observations)
        updatedAt = update.updatedAt
        phase = SignalCatalogBuilder.resolvePhase(status: update.status, entryCount: update.entries.count)
        freshness = SignalCatalogBuilder.resolveFreshness(update)
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension SignalCatalogStrings {
    /// A `Text` resolved by key with the web English fallback (verbatim so the
    /// resolved value is not re-interpreted as a format string).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
