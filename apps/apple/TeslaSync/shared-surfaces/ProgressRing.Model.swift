//
//  ProgressRing.Model.swift
//  TeslaSync — P4 shared surface · 0099 · ProgressRing (Apple)
//
//  The state-holder seam (P1/S8) and the telemetry seam (P1/S11) for the circular progress gauge. The
//  view binds through `ProgressRingModel`; no networking lives in the view (the web source has none —
//  it reads only its props). The model owns the current input snapshot, exposes the pure resolved
//  geometry and the VoiceOver label the view renders, and emits the `view.opened` diagnostics event
//  exactly once when the surface first appears (the gauge always presents — there is no gate — so the
//  first appearance is the open moment).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol ProgressRingTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogProgressRingTelemetry: ProgressRingTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Holds the current input snapshot, exposes the resolved ring
/// geometry and the composed accessibility label the view renders, and emits the `view.opened`
/// diagnostics event exactly once when the gauge first appears. There is no async source because the
/// web source has no data dependency; `sync(_:)` adopts new props when the host re-renders with a
/// changed value.
@MainActor
@Observable
public final class ProgressRingModel {
    public private(set) var input: ProgressRingInput

    @ObservationIgnored private let telemetry: any ProgressRingTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: ProgressRingInput,
        telemetry: any ProgressRingTelemetry = OSLogProgressRingTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved ring geometry the view paints — the pure projection of the current input.
    public var resolved: ProgressRingResolved {
        ProgressRingProjection.resolve(input)
    }

    /// The composed VoiceOver label for the whole gauge (caption identity + centered / percentage value).
    public var accessibilityLabel: String {
        ProgressRingAccessibility.combinedLabel(input, resolved: resolved)
    }

    /// Adopt a new input snapshot — the parity of the web re-rendering with a changed `value` / prop.
    /// Idempotent for an unchanged snapshot.
    public func sync(_ newInput: ProgressRingInput) {
        guard newInput != input else { return }
        input = newInput
    }

    /// Records the surface open exactly once. Idempotent across re-appears.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: ProgressRingMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}
}
