//
//  WidgetStatGrid.Model.swift
//  TeslaSync — P4 widget primitive · 0010 · WidgetStatGrid (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  stat grid. The web `<WidgetStatGrid>` is purely presentational: it takes its data as plain props and
//  renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES own is
//  the current ``WidgetStatGridInput`` (the props, observed so a rebind re-renders), the derived
//  ``WidgetStatGridProjection`` as an observed read (SwiftUI observation replaces the React re-render), and
//  the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders exactly one copy string of its own — the empty leaf `message="No stats
//  available"` (a literal, not a `t()` call). It is resolved here through the P1/S10 facade with that
//  English fallback, alongside the native a11y additions (the cell's combined label/value reading, the
//  value-with-unit join, and the trend's spoken direction + magnitude), so the Swift sources hold no
//  hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetStatGrid" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum WidgetStatGridStrings {
    public static let table = "WidgetStatGrid"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-leaf headline — the web literal `message="No stats available"` (the surface's only own
    /// copy).
    public static var emptyMessage: String {
        string("widgetStatGrid.empty", "No stats available")
    }

    /// Supporting line of the empty leaf, so the surface never renders a bare box (native HIG; the web
    /// renders a single centered line).
    public static var emptyHint: String {
        string("widgetStatGrid.emptyHint", "Stats appear here once vehicle data is available.")
    }

    /// Composes a cell's combined VoiceOver reading — "{label}, {value}" — from the label and the
    /// unit-suffixed value. A positional format so translators can reorder the two parts.
    public static func cellAccessibilityLabel(label: String, value: String) -> String {
        let format = string("widgetStatGrid.cellLabel", "%1$@, %2$@")
        return String(format: format, label, value)
    }

    /// Joins a formatted value with its optional unit affix — "{value} {unit}" — for the cell's spoken
    /// value. Returns the bare value when there is no unit, mirroring the web conditional affix.
    public static func valueWithUnit(value: String, unit: String?) -> String {
        guard let unit, !unit.isEmpty else { return value }
        let format = string("widgetStatGrid.valueUnit", "%1$@ %2$@")
        return String(format: format, value, unit)
    }

    /// The spoken trend reading — "{direction} {magnitude}", e.g. "Up 12%". The direction word replaces the
    /// decorative arrow glyph (web `↑`/`↓`/`—`), which is hidden from VoiceOver natively.
    public static func trendAccessibilityLabel(direction: StatTrendDirection, value: String) -> String {
        let format = string("widgetStatGrid.trend", "%1$@ %2$@")
        return String(format: format, directionWord(direction), value)
    }

    /// Appends a cell's trend reading to its base label — "{base}, {trend}" — so VoiceOver reads the whole
    /// cell as one element. A positional format so translators can reorder.
    public static func cellWithTrend(base: String, trend: String) -> String {
        let format = string("widgetStatGrid.cellTrend", "%1$@, %2$@")
        return String(format: format, base, trend)
    }

    /// The localized direction word spoken in place of the arrow glyph.
    public static func directionWord(_ direction: StatTrendDirection) -> String {
        switch direction {
        case .up: string("widgetStatGrid.trendUp", "Up")
        case .down: string("widgetStatGrid.trendDown", "Down")
        case .flat: string("widgetStatGrid.trendFlat", "No change")
        }
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetStatGridTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogWidgetStatGridTelemetry: WidgetStatGridTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetStatGridModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetStatGridInput`` (the web props),
/// derives the pure ``WidgetStatGridProjection`` as an observed read (SwiftUI observation replaces the
/// React re-render), and emits `view.opened` exactly once per instance. The web component has no fetcher,
/// so neither does this holder.
@MainActor
@Observable
public final class WidgetStatGridModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetStatGridInput

    @ObservationIgnored private let telemetry: any WidgetStatGridTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetStatGridInput,
        telemetry: any WidgetStatGridTelemetry = OSLogWidgetStatGridTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render decision (web render output) — a pure function of the props.
    public var projection: WidgetStatGridProjection {
        WidgetStatGridProjector.resolve(input)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetStatGridInput) {
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
            telemetry.viewOpened(surface: WidgetStatGridSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
