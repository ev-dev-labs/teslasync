//
//  SuspenseProgressBoundary.Model.swift
//  TeslaSync — P4 shared surface · 0141 · SuspenseProgressBoundary (Apple)
//
//  The per-boundary state-holder seam (P1/S8) and the telemetry seam (P1/S11). The view binds through
//  `SuspenseProgressBoundaryModel`; no networking lives in the view (the web source has none — it only
//  bridges Suspense to the global progress controller). The model is the native parity of the web
//  `ProgressTrackingFallback` effect: while the boundary is in its `loading` phase it holds the
//  controller's `start()` open, and the moment the phase resolves (or the boundary leaves the tree) it
//  fires the paired stop. It also emits the `view.opened` diagnostics event exactly once when the
//  surface first appears.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol SuspenseProgressBoundaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSuspenseProgressBoundaryTelemetry: SuspenseProgressBoundaryTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Tracks the current `SuspensePhase`, bridges the `loading`
/// window to the shared `SuspenseProgressController` (holding exactly one `start()` open for the
/// duration), and emits the `view.opened` diagnostics event exactly once when the boundary first
/// appears. There is no async source because the web source has no data dependency — readiness is
/// supplied by the host, the parity of `<Suspense>` resolving its lazy child.
@MainActor
@Observable
public final class SuspenseProgressBoundaryModel {
    public private(set) var phase: SuspensePhase

    /// The progress channel this boundary drives — exposed so the container can render its overlay bar
    /// from the same controller the model holds active.
    public let controller: SuspenseProgressController

    @ObservationIgnored private let telemetry: any SuspenseProgressBoundaryTelemetry
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var releaseProgress: (() -> Void)?

    public init(
        isReady: Bool,
        controller: SuspenseProgressController = .shared,
        telemetry: any SuspenseProgressBoundaryTelemetry = OSLogSuspenseProgressBoundaryTelemetry()
    ) {
        phase = SuspensePhase(isReady: isReady)
        self.controller = controller
        self.telemetry = telemetry
    }

    /// `true` while at least one consumer holds the controller's bar open — read by tests to assert the
    /// bridge without reaching into the controller's internals.
    public var isProgressActive: Bool {
        controller.isActive
    }

    /// Records the surface open exactly once and, if the boundary appears already loading, opens the
    /// progress bridge — the parity of mounting `<SuspenseProgressBoundary>` with an unresolved child.
    /// Idempotent across re-appears.
    public func start() {
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: SuspenseProgressBoundaryMeta.surfaceSlug)
        }
        openBridgeIfLoading()
    }

    /// Adopts a new readiness flag — the parity of the host re-rendering after its lazy child resolves
    /// (or re-suspends). Resolving fires the paired stop (the fallback unmounts); re-suspending opens a
    /// fresh bridge. Idempotent for an unchanged phase.
    public func sync(isReady: Bool) {
        let next = SuspensePhase(isReady: isReady)
        guard next != phase else { return }
        phase = next
        switch next {
        case .resolved: closeBridge()
        case .loading: openBridgeIfLoading()
        }
    }

    /// Releases the progress bridge when the boundary leaves the tree — the parity of the
    /// `ProgressTrackingFallback` effect cleanup running on unmount, so a bar never leaks past a
    /// disappeared boundary.
    public func stop() {
        closeBridge()
    }

    private func openBridgeIfLoading() {
        guard phase.isLoading, releaseProgress == nil else { return }
        releaseProgress = controller.start()
    }

    private func closeBridge() {
        releaseProgress?()
        releaseProgress = nil
    }
}
