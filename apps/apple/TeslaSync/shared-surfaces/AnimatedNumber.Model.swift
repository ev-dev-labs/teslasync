//
//  AnimatedNumber.Model.swift
//  TeslaSync — P4 shared surface · 0075 · AnimatedNumber (Apple)
//
//  The state-holder seam (P1/S8) and the telemetry seam (P1/S11) for the count-up number display. The
//  view binds through `AnimatedNumberModel`; no networking lives in the view (the web source has none
//  — it reads only its props). The model owns the current input snapshot, exposes the pure formatting
//  / settled-text projection the view renders, and emits the `view.opened` diagnostics event exactly
//  once when the surface first appears (the display always presents — there is no gate — so the first
//  appearance is the open moment).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AnimatedNumberTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAnimatedNumberTelemetry: AnimatedNumberTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Holds the current input snapshot, exposes the formatting and
/// settled-text projection the view renders, and emits the `view.opened` diagnostics event exactly
/// once when the display first appears. There is no async source because the web source has no data
/// dependency; `sync(_:)` adopts new props when the host re-renders with a changed value.
@MainActor
@Observable
public final class AnimatedNumberModel {
    public private(set) var input: AnimatedNumberInput

    @ObservationIgnored private let telemetry: any AnimatedNumberTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: AnimatedNumberInput,
        telemetry: any AnimatedNumberTelemetry = OSLogAnimatedNumberTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The fully composed settled display string (prefix + final number + suffix) — the accessibility
    /// label and the Reduce Motion / zero-duration immediate render.
    public var settledText: String {
        AnimatedNumberProjection.settledString(for: input)
    }

    /// The fully composed display string for an arbitrary (tweened) value — the view passes each
    /// animation frame's value through here to render the rolling number.
    public func format(_ display: Double) -> String {
        AnimatedNumberFormatting.display(input, value: display)
    }

    /// Adopt a new input snapshot — the parity of the web effect re-running when `value` / `duration`
    /// change. Idempotent for an unchanged snapshot.
    public func sync(_ newInput: AnimatedNumberInput) {
        guard newInput != input else { return }
        input = newInput
    }

    /// Records the surface open exactly once. Idempotent across re-appears.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AnimatedNumberMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}
}
