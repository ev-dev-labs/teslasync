//
//  Checkbox.Model.swift
//  TeslaSync — P4 shared surface · 0204 · Checkbox (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  checkbox primitive. The view binds through `CheckboxModel`; no networking lives in the view (the web
//  source has none — it is a thin wrapper over `<input type="checkbox">`). The model owns the
//  uncontrolled local checked flag (the native peer of the DOM `defaultChecked`), exposes the resolved
//  projection the view renders, commits changes back through the caller's `onChange` (the web
//  `onChange(e.target.checked)`), adopts new props when the host re-renders (`sync(_:)`, the parity of
//  a controlled re-render), and emits the `view.opened` diagnostics event exactly once when the surface
//  first appears. The surface always presents the box (there is no pre-content loading gate because the
//  source has no fetch), so the first appearance is the open moment.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol CheckboxTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogCheckboxTelemetry: CheckboxTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the views and the adapter hold no
/// hardcoded user-facing literals. The web `Checkbox` renders no translatable copy of its own (the
/// `label` is caller-supplied); the only native-owned strings are the accessibility refinements (the
/// unlabeled-box fallback name and the spoken checked / unchecked / mixed value). Keys live in the
/// "Checkbox" table, folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings.
public enum CheckboxStrings {
    public static let table = "Checkbox"

    public static let string: CheckboxResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Holds the uncontrolled local checked flag (the native peer of
/// the DOM `defaultChecked`, seeded once at init) + the resolved projection the view renders, commits
/// changes back through the caller's `onChange` (the web `onChange(next)`), adopts new props via
/// `sync(_:)` (the parity of a controlled re-render with a changed `checked` / `indeterminate` /
/// `disabled` / `label` / `size`), and emits the `view.opened` diagnostics event exactly once when the
/// surface first appears. There is no async source because the web source has no data dependency; the
/// host owns the props and feeds them on every render.
@MainActor
@Observable
public final class CheckboxModel {
    /// The resolved, view-ready projection.
    public private(set) var resolved: CheckboxResolved

    /// The uncontrolled local checked flag (web DOM `defaultChecked`), authoritative only when the
    /// surface is uncontrolled. Exposed read-only for tests / hosts.
    public private(set) var internalChecked: Bool

    @ObservationIgnored private var input: CheckboxInput
    @ObservationIgnored private let onChange: (Bool) -> Void
    @ObservationIgnored private let telemetry: any CheckboxTelemetry
    @ObservationIgnored private let strings: CheckboxResolve
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: CheckboxInput,
        onChange: @escaping (Bool) -> Void = { _ in },
        telemetry: any CheckboxTelemetry = OSLogCheckboxTelemetry(),
        strings: @escaping CheckboxResolve = CheckboxStrings.string
    ) {
        self.input = input
        self.onChange = onChange
        self.telemetry = telemetry
        self.strings = strings
        internalChecked = input.defaultChecked
        resolved = CheckboxProjection.resolve(
            input: input,
            internalChecked: input.defaultChecked,
            strings: strings
        )
    }

    /// The resolved checked state (web `checked`).
    public var isChecked: Bool {
        resolved.isChecked
    }

    /// The resolved indeterminate state (web `indeterminate`).
    public var isIndeterminate: Bool {
        resolved.isIndeterminate
    }

    /// Records the surface open exactly once. Idempotent across re-appears; the surface always presents
    /// the box, so the first appearance is the open moment.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: CheckboxMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}

    /// Commit a new checked value — the web `onChange(next)` path, guarded by `disabled` (web
    /// `if (disabled) return`). When it differs from the current resolved value, adopts it (the local
    /// flag only when uncontrolled — controlled mode leaves the value to the parent), recomputes the
    /// projection, and forwards it to the host. Idempotent for an unchanged value, so the controlled
    /// re-render it triggers does not loop.
    public func setChecked(_ next: Bool) {
        guard !input.isDisabled else { return }
        guard next != resolved.isChecked else { return }
        if !input.isControlled {
            internalChecked = next
        }
        recompute()
        onChange(next)
    }

    /// Flip the checked value — the web `onChange(!checked)` invoked from the box / label tap. Guarded
    /// by `disabled`.
    public func toggle() {
        guard !input.isDisabled else { return }
        setChecked(CheckboxProjection.nextChecked(current: resolved.isChecked))
    }

    /// Adopt a new input snapshot — the parity of a controlled re-render with a changed `checked` /
    /// `indeterminate` / `disabled` / `label` / `size`. Recomputes the projection; idempotent for an
    /// unchanged snapshot. `defaultChecked` is initial-only (web DOM `defaultChecked`), so it never
    /// reseeds the local flag after mount — only the controlled value / indeterminate / chrome flow
    /// through.
    public func sync(_ newInput: CheckboxInput) {
        guard newInput != input else { return }
        input = newInput
        recompute()
    }

    /// Recompute the published projection from the current input + local flag.
    private func recompute() {
        resolved = CheckboxProjection.resolve(
            input: input,
            internalChecked: internalChecked,
            strings: strings
        )
    }
}
