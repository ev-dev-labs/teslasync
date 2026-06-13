//
//  Spinner.Model.swift
//  TeslaSync — P4 shared surface · 0140 · Spinner (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  brand loading mark. The web `<Spinner>` binds one display-boundary hook (`useMotionPreference`) and takes
//  its data as plain props; there is no fetcher, so the native peer needs no data state-holder. What the
//  holder DOES own is the surface lifecycle: it carries the current ``SpinnerInput`` (the props) + the bound
//  reduce-motion flag (the native peer of the web `useReducedMotion()`, injected from the app's
//  `\.accessibilityReduceMotion` environment), derives the pure ``SpinnerProjection`` as an observed read
//  (SwiftUI observation replaces the React re-render), resolves the localized accessibility + caption text,
//  and emits the surface's single `view.opened` diagnostics event. No networking lives here.
//
//  The web `<Spinner>` resolves one localized string of its own — the `'Loading'` accessibility-label
//  fallback used when no `label` prop is supplied — so that is the one key mirrored through the P1/S10
//  facade; the `label` itself is a caller-supplied, already-localized prop.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "Spinner" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum SpinnerStrings {
    public static let table = "Spinner"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The accessibility-label fallback announced when no `label` prop is supplied — the localized peer of
    /// the web `aria-label={label ?? 'Loading'}`.
    public static var loading: String {
        string("spinner.loading", "Loading")
    }

    /// The accessibility label for a given caption: the caller's `label` when present + non-empty (web
    /// `aria-label={label}`), otherwise the localized `"Loading"` fallback (web `?? 'Loading'`).
    public static func accessibilityLabel(for label: String?) -> String {
        guard let label, !label.isEmpty else { return loading }
        return label
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol SpinnerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSpinnerTelemetry: SpinnerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - SpinnerModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``SpinnerInput`` (the web props) + the bound
/// reduce-motion flag (web `useReducedMotion()`, reassigned from the `\.accessibilityReduceMotion`
/// environment by the view), derives the pure ``SpinnerProjection`` as an observed read, resolves the
/// localized caption + accessibility text, and emits `view.opened` exactly once per instance. The web
/// component has no fetcher, so neither does this holder — `update(_:)` / `update(reduceMotion:)` are the
/// native peer of React re-rendering with new props / a new preference, reassigning only when the value
/// actually changes so an unrelated re-render does not invalidate observers.
@MainActor
@Observable
public final class SpinnerModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: SpinnerInput

    /// The bound Reduce Motion flag (web `useReducedMotion()`). Reassigned from the
    /// `\.accessibilityReduceMotion` environment by the view; a change re-derives the mark.
    public private(set) var reduceMotion: Bool

    @ObservationIgnored private let telemetry: any SpinnerTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: SpinnerInput,
        reduceMotion: Bool = false,
        telemetry: any SpinnerTelemetry = OSLogSpinnerTelemetry()
    ) {
        self.input = input
        self.reduceMotion = reduceMotion
        self.telemetry = telemetry
    }

    /// The resolved, view-ready mark (web render output) — a pure function of the props + preference.
    public var projection: SpinnerProjection {
        SpinnerProjector.resolve(input, reduceMotion: reduceMotion)
    }

    /// The accessibility label spoken for the surface — the caller's `label` when present, else the
    /// localized `"Loading"` fallback (web `aria-label={label ?? 'Loading'}`).
    public var accessibilityLabel: String {
        SpinnerStrings.accessibilityLabel(for: input.label)
    }

    /// The visible caption rendered under the bolt, shown only when ``SpinnerProjection/showsLabelText`` is
    /// true (web `{label && <span>{label}</span>}`).
    public var captionText: String {
        input.label ?? ""
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: SpinnerInput) {
        guard input != self.input else { return }
        self.input = input
    }

    /// Replaces the bound Reduce Motion flag — called by the view when the `\.accessibilityReduceMotion`
    /// environment changes. Reassigns only when the value actually changes.
    public func update(reduceMotion: Bool) {
        guard reduceMotion != self.reduceMotion else { return }
        self.reduceMotion = reduceMotion
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: SpinnerSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
