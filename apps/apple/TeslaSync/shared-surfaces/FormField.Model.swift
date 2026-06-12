//
//  FormField.Model.swift
//  TeslaSync — P4 shared surface · 0154 · FormField (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the form-field wrapper. The view binds through `FormFieldModel`; no
//  networking lives in the view. The web source (FormField.tsx) is a presentational
//  leaf fed by its caller (and, in practice, a react-hook-form `Controller`), so the
//  "source" here republishes the caller's prop snapshot (label / required / hint /
//  error) — recomputing the resolved projection on every emission, exactly as the web
//  re-renders when `fieldState.error` changes — rather than issuing HTTP itself.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink, which is consent-gated and redacted
/// there.
public protocol FormFieldTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`
/// event. The surface slug is the only payload, so nothing user-identifying is
/// logged.
public struct OSLogFormFieldTelemetry: FormFieldTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the host
/// form's field state (e.g. a react-hook-form-equivalent `Controller` snapshot);
/// previews and tests use `InMemoryFormFieldSource`. The view never talks to the
/// network directly.
@MainActor
public protocol FormFieldSource: AnyObject {
    var onUpdate: (@MainActor (FormFieldInput) -> Void)? { get set }
    func start()
    func stop()
}

/// The wrapper's observable view-model. Subscribes to a `FormFieldSource`, recomputes
/// the resolved projection, and exposes it for SwiftUI to render. Emits the
/// `view.opened` diagnostics event once, on first `start()`.
@MainActor
@Observable
public final class FormFieldModel {
    /// The latest resolved view-state. Seeded so the label renders on first frame
    /// even before the source emits.
    public private(set) var resolved: FormFieldResolved

    @ObservationIgnored private let source: any FormFieldSource
    @ObservationIgnored private let telemetry: any FormFieldTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any FormFieldSource,
        initial: FormFieldInput,
        telemetry: any FormFieldTelemetry = OSLogFormFieldTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        resolved = FormFieldProjection.resolve(initial)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent: a
    /// second call while running is a no-op.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FormFieldSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    private func apply(_ input: FormFieldInput) {
        resolved = FormFieldProjection.resolve(input)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Drive it with `push(_:)`. It records
/// the start / stop counts so the model's lifecycle wiring can be asserted.
@MainActor
public final class InMemoryFormFieldSource: FormFieldSource {
    public var onUpdate: (@MainActor (FormFieldInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    private let initial: FormFieldInput?

    public init(initial: FormFieldInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: FormFieldInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "FormField" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum FormFieldStrings {
    public static let table = "FormField"

    /// The accessibility word appended for a required field (web `aria-label="required"`).
    public static let requiredKey = "form.field.required"
    public static let requiredFallback = "required"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The localized "required" word used in the field's VoiceOver label.
    public static func requiredWord() -> String {
        string(requiredKey, requiredFallback)
    }
}
