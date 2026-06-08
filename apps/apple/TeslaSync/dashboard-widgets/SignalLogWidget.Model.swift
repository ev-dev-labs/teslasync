//
//  SignalLogWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0089 · SignalLogWidget (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the observable
//  view-model (including the pause/resume freeze the web keeps in a ref), and the
//  SwiftUI half of the i18n facade. The view binds through this model and never
//  performs networking itself.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for this surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core diagnostics taxonomy (ADR-016), which is
/// consent-gated and redacted there.
public protocol SignalLogTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSignalLogTelemetry: SignalLogTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` fed by the KMP
/// `VehicleStore` + the telemetry signal-observations + MQTT-status stores);
/// previews and tests use `InMemorySignalLogSource`. The view never talks to the
/// network directly.
@MainActor
public protocol SignalLogSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SignalLogUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySignalLogSource: SignalLogSource {
    public var onUpdate: (@MainActor (SignalLogUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalLogUpdate?

    public init(initial: SignalLogUpdate? = nil) {
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
    public func push(_ update: SignalLogUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Observable view-model

/// The widget's observable view-model. Subscribes to a `SignalLogSource`, projects
/// the feed via `SignalLogBuilder`, aggregates the MQTT signals/sec rate, and
/// exposes a render `phase` + freshness for SwiftUI to switch over. It also owns
/// the pause/resume freeze the web keeps in `pausedDataRef`: while paused the
/// displayed feed is held at its last snapshot even as fresh updates arrive.
@MainActor
@Observable
public final class SignalLogModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Canonical source of truth,
    /// re-exported by the view for the registry.
    public static let surfaceSlug = "SignalLogWidget"

    public private(set) var phase: SignalLogRenderPhase = .loading
    public private(set) var freshness: SignalLogFreshness = .fresh
    public private(set) var connection: SignalLogConnection = .live
    public private(set) var displayItems: [SignalLogRowProjection] = []
    public private(set) var signalsPerSecond: Double = 0
    public private(set) var paused = false
    public private(set) var updatedAt: Date?

    /// The compact big number — the aggregate rate rounded (web `Math.round`).
    public var roundedRate: Int {
        SignalLogBuilder.roundedRate(signalsPerSecond)
    }

    @ObservationIgnored private var liveItems: [SignalLogRowProjection] = []
    @ObservationIgnored private let source: any SignalLogSource
    @ObservationIgnored private let telemetry: any SignalLogTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SignalLogSource,
        telemetry: any SignalLogTelemetry = OSLogSignalLogTelemetry()
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

    /// Toggles the pause/resume freeze. Pausing holds the displayed feed at its
    /// current snapshot; resuming catches it back up to the latest projection.
    public func togglePause() {
        let wasPaused = paused
        paused.toggle()
        if wasPaused {
            displayItems = liveItems
        }
    }

    private func apply(_ update: SignalLogUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        signalsPerSecond = SignalLogBuilder.aggregateRate(update.signalRates)
        let projected = SignalLogBuilder.projectFeed(update)
        liveItems = projected
        if !paused {
            displayItems = projected
        }
        phase = SignalLogBuilder.resolvePhase(status: update.status, itemCount: projected.count)
        freshness = SignalLogBuilder.resolveFreshness(update)
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension SignalLogStrings {
    /// A `Text` resolved by key with the web English fallback (verbatim so the
    /// resolved value is not re-interpreted as a format string).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
