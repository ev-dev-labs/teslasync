//
//  Label.Model.swift
//  TeslaSync — P4 shared surface · 0218 · Label (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  form label. The web `<Label>` is purely presentational: it takes its data as plain props and renders,
//  with no fetcher — so the native peer needs no data state-holder. What the holder DOES own is the surface
//  lifecycle: it carries the current ``LabelInput`` (the props), derives the pure ``LabelProjection`` as an
//  observed read (SwiftUI observation replaces the React re-render), and emits the surface's single
//  `view.opened` diagnostics event. No networking lives here.
//
//  The web source resolves one key of its own — `t('form.required', 'required')`, the screen-reader suffix
//  — which is mirrored verbatim below; the only addition is the empty-text leaf's a11y copy (the native
//  "never a blank box" peer of an empty `<label>`).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "Label" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. `required` mirrors the web `t('form.required', 'required')`; `emptyLabel` is a
/// native a11y addition.
public enum LabelStrings {
    public static let table = "Label"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The screen-reader "required" suffix — the verbatim peer of the web `t('form.required', 'required')`.
    public static var required: String {
        string("form.required", "required")
    }

    /// The fallback shown when the label content is blank, so the surface never renders a bare box
    /// (native HIG; the web simply renders an empty `<label>`).
    public static var emptyLabel: String {
        string("label.empty", "Unlabeled field")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol LabelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogLabelTelemetry: LabelTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - LabelModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``LabelInput`` (the web props), derives the
/// pure ``LabelProjection`` as an observed read (resolving the localized "required" word + empty
/// fallback through the P1/S10 facade), and emits `view.opened` exactly once per instance. The web
/// component has no fetcher, so neither does this holder — `update(_:)` is the native peer of React
/// re-rendering with new props, reassigning only when the value actually changes so an unrelated re-render
/// does not invalidate observers.
@MainActor
@Observable
public final class LabelModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: LabelInput

    @ObservationIgnored private let telemetry: any LabelTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(input: LabelInput, telemetry: any LabelTelemetry = OSLogLabelTelemetry()) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready label (web render output) — a pure function of the props + the localized
    /// copy resolved through the P1/S10 facade.
    public var projection: LabelProjection {
        LabelProjector.resolve(
            input: input,
            requiredWord: LabelStrings.required,
            emptyFallback: LabelStrings.emptyLabel
        )
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// input actually changes so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: LabelInput) {
        guard input != self.input else { return }
        self.input = input
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: LabelSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
