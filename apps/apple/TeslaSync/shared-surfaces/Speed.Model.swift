//
//  Speed.Model.swift
//  TeslaSync — P4 shared surface · 0088 · Speed (Apple)
//
//  The state-holder seam (P1/S8) and the telemetry seam (P1/S11) for the speed renderer. The view binds
//  through `SpeedModel`; no networking lives in the view (the web source performs none — its `useUnits`
//  hook is a synchronous selector over already-loaded settings). The model owns the current input
//  snapshot, exposes the pure projection + accessibility label the view renders, and emits the
//  `view.opened` diagnostics event exactly once when the surface first appears (the renderer always
//  presents — there is no gate — so the first appearance is the open moment).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol SpeedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSpeedTelemetry: SpeedTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Holds the current input snapshot, exposes the resolved view-
/// state + the accessibility label the view renders, and emits the `view.opened` diagnostics event
/// exactly once when the renderer first appears. There is no async source because the web source has no
/// data dependency beyond the synchronous settings selector; `sync(_:)` adopts new props when the host
/// re-renders with a changed value, precision, locale, or settings.
@MainActor
@Observable
public final class SpeedModel {
    public private(set) var input: SpeedInput

    @ObservationIgnored private let telemetry: any SpeedTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: SpeedInput,
        telemetry: any SpeedTelemetry = OSLogSpeedTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved view-state — the visible text, the canonical tooltip string, and the branch flag.
    public var resolved: SpeedResolved {
        SpeedProjection.resolve(input)
    }

    /// The VoiceOver label — the visible figure with its unit, or the fallback glyph.
    public var accessibilityLabel: String {
        SpeedAccessibility.label(input)
    }

    /// Adopt a new input snapshot — the parity of the web component re-rendering with changed props or a
    /// changed display unit / precision from settings. Idempotent for an unchanged snapshot.
    public func sync(_ newInput: SpeedInput) {
        guard newInput != input else { return }
        input = newInput
    }

    /// Records the surface open exactly once. Idempotent across re-appears.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: SpeedMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}
}
