//
//  HelpIcon.Model.swift
//  TeslaSync — P4 shared surface · 0215 · HelpIcon (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  field-level help primitive. The web `<HelpIcon>` is purely presentational: it takes its data as plain
//  props and resolves its strings through `useTranslation`, with no fetcher — so the native peer needs no
//  data state-holder. What the holder DOES own is the surface's interaction state (the `isPresented` flag —
//  the native peer of the focus-within / tap that reveals the web `<Tooltip>`), the props (the derived
//  ``HelpIconProjection`` is an observed read), and the single `view.opened` diagnostics event. No
//  networking lives here.
//
//  The web source resolves two real `t()` keys for its trigger label — `a11y.helpFor` and
//  `help.tooltip.iconLabel` — and resolves the help text itself through a caller-supplied key (falling back
//  to `content`). The facade below resolves all three by key against the "HelpIcon" table with the web
//  `defaultValue` as the fallback, plus the one native a11y addition (the open hint).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "HelpIcon" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. A caller-supplied help-text key absent from the table resolves to its
/// `defaultValue` (the web `content`), matching `t(key, { defaultValue })`.
public enum HelpIconStrings {
    public static let table = "HelpIcon"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The P1/S10 facade as a `HelpIconResolve` closure — the default resolver the view injects into the
    /// state-holder. Tests inject an identity / fake resolver instead.
    public static let resolve: HelpIconResolve = { key, fallback in
        string(key, fallback)
    }

    /// VoiceOver hint announced on the trigger — the action a tap performs (native a11y addition; the web
    /// trigger has no explicit hint, relying on the `(?)` glyph + `aria-label`).
    public static var openHint: String {
        string("helpIcon.openHint", "Shows help")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol HelpIconTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogHelpIconTelemetry: HelpIconTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - HelpIconModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``HelpIconInput`` (the web props) + the
/// `isPresented` flag (the native peer of the hover / focus / tap that reveals the web `<Tooltip>`), derives
/// the pure ``HelpIconProjection`` as an observed read (SwiftUI observation replaces the React re-render),
/// and emits `view.opened` exactly once per instance. The web component has no fetcher, so neither does this
/// holder. The i18n resolver is held here (not in the value types) so the projection stays pure + testable.
@MainActor
@Observable
public final class HelpIconModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: HelpIconInput

    /// Whether the help bubble is shown (the native peer of the web tooltip's focus-within / open state).
    /// Settable so the view can bind it to a `.popover(isPresented:)`.
    public var isPresented: Bool

    @ObservationIgnored private let resolver: HelpIconResolve
    @ObservationIgnored private let telemetry: any HelpIconTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: HelpIconInput,
        resolve: @escaping HelpIconResolve = HelpIconStrings.resolve,
        telemetry: any HelpIconTelemetry = OSLogHelpIconTelemetry()
    ) {
        self.input = input
        isPresented = false
        resolver = resolve
        self.telemetry = telemetry
    }

    /// The resolved, view-ready help affordance (web render output) — a pure function of the props + the
    /// injected resolver.
    public var projection: HelpIconProjection {
        HelpIconProjector.resolve(input: input, resolve: resolver)
    }

    /// Whether the surface renders anything — web `!!text` (its negation is the `return null` branch).
    public var hasContent: Bool {
        projection.hasContent
    }

    /// Reveals the help bubble — the native peer of the web focus / tap that opens the `<Tooltip>`.
    public func present() {
        isPresented = true
    }

    /// Dismisses the help bubble — the native peer of the web Escape-to-blur that collapses the tooltip.
    public func dismiss() {
        isPresented = false
    }

    /// Replaces the props — the native peer of React re-rendering with new props. The props reassign only
    /// when they actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: HelpIconInput) {
        if input != self.input {
            self.input = input
        }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: HelpIconSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
