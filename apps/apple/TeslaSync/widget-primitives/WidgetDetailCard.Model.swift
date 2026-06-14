//
//  WidgetDetailCard.Model.swift
//  TeslaSync — P4 widget primitive · 0004 · WidgetDetailCard (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  detail card. The web `<WidgetDetailCard>` is purely presentational: it takes its data as plain props and
//  renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES own is
//  the current ``WidgetDetailCardInput`` (the props, observed so a rebind re-renders), the derived
//  ``WidgetDetailCardProjection`` as an observed read (SwiftUI observation replaces the React re-render),
//  and the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders exactly one copy string of its own — the empty default `emptyMessage ?? 'No
//  details available'` (a literal, not a `t()` call); its `label` / `value` / `badge.text` are
//  caller-supplied, already-localized props rendered verbatim. That single literal is resolved here through
//  the P1/S10 facade with that English fallback, alongside the em-dash value fallback (the web `value ?? '—'`)
//  and the native a11y additions (the row's combined label/value/badge reading and the empty-leaf hint), so
//  the Swift sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetDetailCard" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum WidgetDetailCardStrings {
    public static let table = "WidgetDetailCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty default message — the web literal `emptyMessage ?? 'No details available'` (the surface's
    /// only own copy). A caller `emptyMessage` override takes precedence at the view.
    public static var emptyMessage: String {
        string("widgetDetailCard.empty", "No details available")
    }

    /// Supporting line of the empty leaf, so the surface never renders a bare box (native HIG).
    public static var emptyHint: String {
        string("widgetDetailCard.emptyHint", "Details appear here once there is something to show.")
    }

    /// The em-dash shown for a missing value — the web `value ?? '—'`. Routed through the facade so the
    /// view holds no literal glyph and a locale could substitute its own absent-value mark.
    public static var valueFallback: String {
        string("widgetDetailCard.valueFallback", "—")
    }

    /// The resolved display value — the web `entry.value ?? '—'`. A pure helper so the resolution is
    /// unit-testable and shared by the rendered row + its VoiceOver reading.
    public static func displayValue(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return valueFallback }
        return value
    }

    /// Composes a row's combined VoiceOver reading. With a badge present it reads "{label}, {value}, {badge}";
    /// without one it reads "{label}, {value}". Positional formats so translators can reorder the parts.
    public static func rowAccessibilityLabel(label: String, value: String, badge: String?) -> String {
        if let badge, !badge.isEmpty {
            let format = string("widgetDetailCard.rowLabelWithBadge", "%1$@, %2$@, %3$@")
            return String(format: format, label, value, badge)
        }
        let format = string("widgetDetailCard.rowLabel", "%1$@, %2$@")
        return String(format: format, label, value)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetDetailCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogWidgetDetailCardTelemetry: WidgetDetailCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetDetailCardModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetDetailCardInput`` (the web props),
/// derives the pure ``WidgetDetailCardProjection`` as an observed read (SwiftUI observation replaces the
/// React re-render), and emits `view.opened` exactly once per instance. The web component has no fetcher,
/// so neither does this holder.
@MainActor
@Observable
public final class WidgetDetailCardModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetDetailCardInput

    @ObservationIgnored private let telemetry: any WidgetDetailCardTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetDetailCardInput,
        telemetry: any WidgetDetailCardTelemetry = OSLogWidgetDetailCardTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render decision (web render output) — a pure function of the props.
    public var projection: WidgetDetailCardProjection {
        WidgetDetailCardProjector.resolve(input)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetDetailCardInput) {
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
            telemetry.viewOpened(surface: WidgetDetailCardSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
