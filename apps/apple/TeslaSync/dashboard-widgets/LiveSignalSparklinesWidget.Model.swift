//
//  LiveSignalSparklinesWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0057 · LiveSignalSparklinesWidget (Apple)
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
public protocol LiveSignalSparklinesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogLiveSignalSparklinesTelemetry: LiveSignalSparklinesTelemetry {
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
/// `VehicleStore` + telemetry `SignalStore` / live-gap + per-signal history
/// stores); previews and tests use `InMemoryLiveSignalSparklinesSource`. The view
/// never talks to the network directly.
@MainActor
public protocol LiveSignalSparklinesSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (LiveSignalSparklinesUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryLiveSignalSparklinesSource: LiveSignalSparklinesSource {
    public var onUpdate: (@MainActor (LiveSignalSparklinesUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveSignalSparklinesUpdate?

    public init(initial: LiveSignalSparklinesUpdate? = nil) {
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
    public func push(_ update: LiveSignalSparklinesUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Observable view-model

/// The widget's observable view-model. Subscribes to a `LiveSignalSparklinesSource`,
/// recomputes the row projection via `LiveSignalSparklinesBuilder`, and exposes a
/// render `phase` + freshness for SwiftUI to switch over. Size-agnostic: the
/// responsive column split is a pure view concern derived from the grid size.
@MainActor
@Observable
public final class LiveSignalSparklinesModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Canonical source of truth,
    /// re-exported by the view for the registry.
    public static let surfaceSlug = "LiveSignalSparklinesWidget"

    public private(set) var phase: SignalRenderPhase = .loading
    public private(set) var freshness: SignalFreshness = .fresh
    public private(set) var connection: SignalConnection = .live
    public private(set) var rows: [SignalRowProjection] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any LiveSignalSparklinesSource
    @ObservationIgnored private let telemetry: any LiveSignalSparklinesTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LiveSignalSparklinesSource,
        telemetry: any LiveSignalSparklinesTelemetry = OSLogLiveSignalSparklinesTelemetry()
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

    /// Forces a network refresh (cached rows stay visible). Wired to the chip +
    /// retry affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: LiveSignalSparklinesUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        let projected = LiveSignalSparklinesBuilder.projectRows(update)
        rows = projected
        phase = LiveSignalSparklinesBuilder.resolvePhase(status: update.status, rowCount: projected.count)
        freshness = LiveSignalSparklinesBuilder.resolveFreshness(update)
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension LiveSignalSparklinesStrings {
    /// A `Text` resolved by key with the web English fallback (verbatim so the
    /// resolved value is not re-interpreted as a format string).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
