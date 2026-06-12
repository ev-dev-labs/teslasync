//
//  WidgetTipCards.Model.swift
//  TeslaSync — P4 widget primitive · 0012 · WidgetTipCards (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  tip cards. The web `<WidgetTipCards>` is purely presentational: it takes its data as plain props and
//  renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES own is
//  the current ``WidgetTipCardsInput`` (the props, observed so a rebind re-renders), the derived
//  ``WidgetTipCardsProjection`` as an observed read (SwiftUI observation replaces the React re-render), and
//  the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders exactly one copy string of its own — the empty-state default `'No
//  recommendations'` (a literal, not a `t()` call); its `title` / `description` / `impactLabel` are
//  caller-supplied, already-localized props rendered verbatim. That single literal is resolved here through
//  the P1/S10 facade with that English fallback, alongside the localized impact-name defaults (the web
//  renders the raw `tip.impact` enum value — `'high'` — when no `impactLabel` is given; the native peer
//  localizes it so the Swift sources hold no user-facing English) and the native a11y additions.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetTipCards" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum WidgetTipCardsStrings {
    public static let table = "WidgetTipCards"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-state default message — the web literal `emptyMessage ?? 'No recommendations'` (the
    /// surface's only own copy). A caller `emptyMessage` override takes precedence at the view.
    public static var emptyMessage: String {
        string("widgetTipCards.empty", "No recommendations")
    }

    /// Supporting line of the empty leaf, so the surface never renders a bare box (native HIG).
    public static var emptyHint: String {
        string("widgetTipCards.emptyHint", "Recommendations appear here once there is something to suggest.")
    }

    /// The localized default badge label for an impact level — the native peer of the web `tip.impact`
    /// fallback (`impactLabel ?? impact`), localized so no raw enum value is shown to the user. A caller
    /// `impactLabel` override takes precedence at the view.
    public static func impactLabel(_ impact: TipImpact) -> String {
        switch impact {
        case .high: string("widgetTipCards.impact.high", "High")
        case .medium: string("widgetTipCards.impact.medium", "Medium")
        case .low: string("widgetTipCards.impact.low", "Low")
        }
    }

    /// Resolves a card's badge text — the web `tip.impactLabel ?? tip.impact`, with the raw-enum fallback
    /// localized via ``impactLabel(_:)``. A pure helper so the resolution is unit-testable.
    public static func badgeText(override: String?, impact: TipImpact) -> String {
        if let override, !override.isEmpty { return override }
        return impactLabel(impact)
    }

    /// Composes a card's combined VoiceOver reading. With an impact present it reads
    /// "{title}, {impact}. {description}"; without one it reads "{title}. {description}". Positional
    /// formats so translators can reorder the parts.
    public static func cardAccessibilityLabel(title: String, impact: String?, description: String) -> String {
        if let impact, !impact.isEmpty {
            let format = string("widgetTipCards.cardLabelWithImpact", "%1$@, %2$@. %3$@")
            return String(format: format, title, impact, description)
        }
        let format = string("widgetTipCards.cardLabel", "%1$@. %2$@")
        return String(format: format, title, description)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetTipCardsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogWidgetTipCardsTelemetry: WidgetTipCardsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetTipCardsModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetTipCardsInput`` (the web props),
/// derives the pure ``WidgetTipCardsProjection`` as an observed read (SwiftUI observation replaces the
/// React re-render), and emits `view.opened` exactly once per instance. The web component has no fetcher,
/// so neither does this holder.
@MainActor
@Observable
public final class WidgetTipCardsModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetTipCardsInput

    @ObservationIgnored private let telemetry: any WidgetTipCardsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetTipCardsInput,
        telemetry: any WidgetTipCardsTelemetry = OSLogWidgetTipCardsTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render decision (web render output) — a pure function of the props.
    public var projection: WidgetTipCardsProjection {
        WidgetTipCardsProjector.resolve(input)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetTipCardsInput) {
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
            telemetry.viewOpened(surface: WidgetTipCardsSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
