//
//  Input.Model.swift
//  TeslaSync — P4 shared surface · 0217 · Input (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  text-field primitive. The view binds through `InputFieldModel`; no networking lives in the view
//  (the web source has none — it is a thin wrapper over `<input>`). The model owns the current input
//  snapshot + the resolved projection the view renders, adopts new props when the host re-renders
//  (`sync(_:)`, the parity of a controlled re-render with a changed `label` / `error` / `hint` /
//  `size` / …), and emits the `view.opened` diagnostics event exactly once when the surface first
//  appears. The field value itself is owned by the parent through a SwiftUI `Binding` (the native
//  peer of the web controlled `value` + `onChange`), so it is not part of the model's value-type
//  state. The surface always presents the field (there is no pre-content loading gate because the
//  source has no fetch), so the first appearance is the open moment.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol InputFieldTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogInputFieldTelemetry: InputFieldTelemetry {
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
/// no hardcoded user-facing literals. The web `Input` renders no translatable copy of its own (its
/// `label` / `error` / `hint` / `placeholder` are caller-supplied); the only native-owned strings are
/// the accessibility refinements (the unlabeled-field fallback name, the spoken "required", the
/// "Error: {message}" describedby, and the "Help for {field}" trigger name). Keys live in the "Input"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time; kept per-surface
/// so each parallel prompt owns its own strings.
public enum InputFieldStrings {
    public static let table = "Input"

    public static let string: InputFieldResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Holds the current ``InputFieldInput`` snapshot + the resolved
/// ``InputFieldResolved`` projection the view renders, adopts new props via `sync(_:)` (the parity of
/// a re-render with a changed `label` / `error` / `hint` / `size` / disabled / …), and emits the
/// `view.opened` diagnostics event exactly once when the surface first appears. There is no async
/// source because the web source has no data dependency; the host owns the props (and the bound
/// value) and feeds them on every render.
@MainActor
@Observable
public final class InputFieldModel {
    /// The resolved, view-ready projection.
    public private(set) var resolved: InputFieldResolved

    /// The current input snapshot — exposed read-only so the view's `onChange(of:)` seam and the
    /// injection initializer can read the shape the model was built from.
    @ObservationIgnored public private(set) var input: InputFieldInput

    @ObservationIgnored private let telemetry: any InputFieldTelemetry
    @ObservationIgnored private let strings: InputFieldResolve
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: InputFieldInput,
        telemetry: any InputFieldTelemetry = OSLogInputFieldTelemetry(),
        strings: @escaping InputFieldResolve = InputFieldStrings.string
    ) {
        self.input = input
        self.telemetry = telemetry
        self.strings = strings
        resolved = InputFieldProjection.resolve(input: input, strings: strings)
    }

    /// The resolved invalid state (web `aria-invalid`).
    public var isInvalid: Bool {
        resolved.isInvalid
    }

    /// Records the surface open exactly once. Idempotent across re-appears; the surface always
    /// presents the field, so the first appearance is the open moment.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: InputFieldMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}

    /// Adopt a new input snapshot — the parity of a re-render with a changed `label` / `error` /
    /// `hint` / `size` / disabled / secure / icon / suffix. Recomputes the projection; idempotent for
    /// an unchanged snapshot, so the re-render it triggers does not loop.
    public func sync(_ newInput: InputFieldInput) {
        guard newInput != input else { return }
        input = newInput
        resolved = InputFieldProjection.resolve(input: input, strings: strings)
    }
}
