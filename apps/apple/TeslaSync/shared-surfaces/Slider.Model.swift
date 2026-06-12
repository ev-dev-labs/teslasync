//
//  Slider.Model.swift
//  TeslaSync — P4 shared surface · 0226 · Slider (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  single-thumb slider. The view binds through `SliderModel`; no networking lives in the view (the
//  web source has none — it is a controlled primitive reading its `value` prop + `useId`). The model
//  owns the canonical value, exposes the resolved projection the view renders, commits sanitized
//  changes back through the caller's `onChange` (the web `onChange(next)`), adopts new props when the
//  host re-renders (`sync(_:)`, the parity of a controlled re-render), services the WAI-ARIA keyboard
//  commands (`apply(_:)`), and emits the `view.opened` diagnostics event exactly once when the
//  surface first appears. The surface always presents the track (there is no pre-content loading gate
//  because the source has no fetch), so the first appearance is the open moment.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol SliderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSliderTelemetry: SliderTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the views and the adapter hold
/// no hardcoded user-facing literals. The web `Slider` renders no translatable copy of its own
/// (`label` + the formatted value are caller-supplied); the only native-owned string is the
/// accessibility hint, reproduced here. Keys live in the "Slider" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum SliderStrings {
    public static let table = "Slider"

    public static let string: SliderResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Holds the canonical value + the resolved projection the view
/// renders, commits sanitized edits back through the caller's `onChange` (the web `onChange(next)`),
/// adopts new props via `sync(_:)` (the parity of a controlled re-render with a changed `value` /
/// `min` / `max` / `step` / `label` / `showLabel` / `disabled`), services the keyboard commands via
/// `apply(_:)`, and emits the `view.opened` diagnostics event exactly once when the surface first
/// appears. There is no async source because the web source has no data dependency; the host owns the
/// value and feeds it on every render.
@MainActor
@Observable
public final class SliderModel {
    /// The canonical (clamped + snapped) value the native control binds to.
    public private(set) var value: Double
    /// The resolved, view-ready projection.
    public private(set) var resolved: SliderResolved

    @ObservationIgnored private var input: SliderInput
    @ObservationIgnored private let format: ((Double) -> String)?
    @ObservationIgnored private let onChange: (Double) -> Void
    @ObservationIgnored private let telemetry: any SliderTelemetry
    @ObservationIgnored private let strings: SliderResolve
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: SliderInput,
        format: ((Double) -> String)? = nil,
        onChange: @escaping (Double) -> Void = { _ in },
        telemetry: any SliderTelemetry = OSLogSliderTelemetry(),
        strings: @escaping SliderResolve = SliderStrings.string
    ) {
        var seeded = input
        let sanitized = SliderMath.sanitize(
            input.value,
            minimum: input.minimum,
            maximum: input.maximum,
            step: input.step
        )
        seeded.value = sanitized
        self.input = seeded
        self.format = format
        self.onChange = onChange
        self.telemetry = telemetry
        self.strings = strings
        value = sanitized
        resolved = SliderProjection.resolve(seeded, format: format, strings: strings)
    }

    /// Records the surface open exactly once. Idempotent across re-appears; the surface always
    /// presents the track, so the first appearance is the open moment.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: SliderMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}

    /// Commit a new value — the web `onChange(next)` path. Sanitizes (snap + clamp) the raw value,
    /// and when it differs from the current value adopts it, recomputes the projection, and forwards
    /// it to the host. Idempotent for an unchanged value, so the controlled re-render it triggers
    /// does not loop.
    public func setValue(_ raw: Double) {
        let sanitized = SliderMath.sanitize(
            raw,
            minimum: input.minimum,
            maximum: input.maximum,
            step: input.step
        )
        guard sanitized != value else { return }
        value = sanitized
        input.value = sanitized
        resolved = SliderProjection.resolve(input, format: format, strings: strings)
        onChange(sanitized)
    }

    /// Service a keyboard command — the WAI-ARIA APG slider pattern (Arrows / PageUp-Down /
    /// Home-End). Computes the next value and commits it through `setValue`.
    public func apply(_ command: SliderCommand) {
        setValue(SliderMath.next(for: command, from: input))
    }

    /// Adopt a new input snapshot — the parity of a controlled re-render with a changed `value` /
    /// `min` / `max` / `step` / `label` / `showLabel` / `disabled`. Recomputes the canonical value +
    /// projection; idempotent for an unchanged snapshot.
    public func sync(_ newInput: SliderInput) {
        var adopted = newInput
        adopted.value = SliderMath.sanitize(
            newInput.value,
            minimum: newInput.minimum,
            maximum: newInput.maximum,
            step: newInput.step
        )
        guard adopted != input else { return }
        input = adopted
        value = adopted.value
        resolved = SliderProjection.resolve(adopted, format: format, strings: strings)
    }
}
