//
//  WidgetStatusGrid.Model.swift
//  TeslaSync — P4 widget primitive · 0011 · WidgetStatusGrid (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  status grid. The web `<WidgetStatusGrid>` is purely presentational: it takes its data as plain props and
//  renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES own is the
//  current ``WidgetStatusGridInput`` (the props, observed so a rebind re-renders), the derived
//  ``WidgetStatusGridProjection`` as an observed read (SwiftUI observation replaces the React re-render), and
//  the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders exactly one copy string of its own — the empty default
//  `emptyMessage = 'No status data available'` (a default param, not a `t()` call). It is resolved here
//  through the P1/S10 facade with that English fallback, alongside the native a11y additions (the spoken
//  status words and the cell's combined label/value/status reading) and the empty-leaf hint, so the Swift
//  sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetStatusGrid" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum WidgetStatusGridStrings {
    public static let table = "WidgetStatusGrid"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-leaf headline — the web `emptyMessage = 'No status data available'` default (the surface's
    /// only own copy).
    public static var emptyMessage: String {
        string("widgetStatusGrid.empty", "No status data available")
    }

    /// Supporting line of the empty leaf, so the surface never renders a bare box (native HIG; the web
    /// renders a single `EmptyState` line).
    public static var emptyHint: String {
        string(
            "widgetStatusGrid.emptyHint",
            "Status indicators appear here once the system reports component states."
        )
    }

    /// The spoken status word for VoiceOver — the semantic state read aloud after the label/value. The web
    /// conveys status through color + a dot; native restates it as a word so colorblind / VoiceOver users
    /// get the same signal.
    public static func statusWord(_ kind: StatusCellKind) -> String {
        switch kind {
        case .ok:
            string("widgetStatusGrid.status.ok", "OK")
        case .warning:
            string("widgetStatusGrid.status.warning", "Warning")
        case .error:
            string("widgetStatusGrid.status.error", "Error")
        case .inactive:
            string("widgetStatusGrid.status.inactive", "Inactive")
        case .unknown:
            string("widgetStatusGrid.status.unknown", "Unknown")
        }
    }

    /// Composes a cell's combined VoiceOver reading. With a value: "{label}, {value}, {status}"; without a
    /// value (compact, or no value supplied): "{label}, {status}". Positional formats so translators can
    /// reorder the parts.
    public static func cellAccessibilityLabel(label: String, value: String?, status: StatusCellKind) -> String {
        let word = statusWord(status)
        if let value, !value.isEmpty {
            let format = string("widgetStatusGrid.cellLabel", "%1$@, %2$@, %3$@")
            return String(format: format, label, value, word)
        }
        let format = string("widgetStatusGrid.cellLabelNoValue", "%1$@, %2$@")
        return String(format: format, label, word)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetStatusGridTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event
/// carrying only the public surface slug.
public struct OSLogWidgetStatusGridTelemetry: WidgetStatusGridTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetStatusGridModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetStatusGridInput`` (the web props),
/// derives the pure ``WidgetStatusGridProjection`` as an observed read (SwiftUI observation replaces the
/// React re-render), and emits `view.opened` exactly once per instance. The web component has no fetcher,
/// so neither does this holder.
@MainActor
@Observable
public final class WidgetStatusGridModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetStatusGridInput

    @ObservationIgnored private let telemetry: any WidgetStatusGridTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetStatusGridInput,
        telemetry: any WidgetStatusGridTelemetry = OSLogWidgetStatusGridTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render decision (web render output) — a pure function of the props.
    public var projection: WidgetStatusGridProjection {
        WidgetStatusGridProjector.resolve(input)
    }

    /// The empty-leaf headline — the caller override (web `emptyMessage`) or the facade default.
    public var resolvedEmptyMessage: String {
        input.emptyMessage ?? WidgetStatusGridStrings.emptyMessage
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetStatusGridInput) {
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
            telemetry.viewOpened(surface: WidgetStatusGridSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
