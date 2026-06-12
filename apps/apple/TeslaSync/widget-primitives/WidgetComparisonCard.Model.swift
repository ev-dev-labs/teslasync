//
//  WidgetComparisonCard.Model.swift
//  TeslaSync — P4 widget primitive · 0003 · WidgetComparisonCard (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  comparison card. The web `<WidgetComparisonCard>` is purely presentational: it takes its data as plain
//  props and renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES
//  own is the current ``WidgetComparisonCardInput`` (the props, observed so a rebind re-renders), the
//  derived ``WidgetComparisonCardProjection`` as an observed read (SwiftUI observation replaces the React
//  re-render), and the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders exactly one copy string of its own — the empty leaf `<p>No comparison data</p>`
//  (a literal, not a `t()` call). It is resolved here through the P1/S10 facade with that English fallback,
//  alongside the native a11y additions (the row's combined label/value reading and the empty-leaf hint), so
//  the Swift sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetComparisonCard" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the labels deterministic.
public enum WidgetComparisonCardStrings {
    public static let table = "WidgetComparisonCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-leaf headline — the web literal `<p>No comparison data</p>` (the surface's only own copy).
    public static var emptyMessage: String {
        string("widgetComparisonCard.empty", "No comparison data")
    }

    /// Supporting line of the empty leaf, so the surface never renders a bare box (native HIG; the web
    /// renders a single muted line).
    public static var emptyHint: String {
        string(
            "widgetComparisonCard.emptyHint",
            "Comparison metrics appear here once a current and previous period are available."
        )
    }

    /// Composes a row's combined VoiceOver reading — "{label}, {value}" — from the label and the
    /// unit-suffixed value. A positional format so translators can reorder the two parts.
    public static func rowAccessibilityLabel(label: String, value: String) -> String {
        let format = string("widgetComparisonCard.rowLabel", "%1$@, %2$@")
        return String(format: format, label, value)
    }

    /// Joins a formatted value with its optional unit affix — "{value} {unit}" — for the row's spoken
    /// value. Returns the bare value when there is no unit, mirroring the web conditional affix.
    public static func valueWithUnit(value: String, unit: String?) -> String {
        guard let unit, !unit.isEmpty else { return value }
        let format = string("widgetComparisonCard.valueUnit", "%1$@ %2$@")
        return String(format: format, value, unit)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetComparisonCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogWidgetComparisonCardTelemetry: WidgetComparisonCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetComparisonCardModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetComparisonCardInput`` (the web
/// props), derives the pure ``WidgetComparisonCardProjection`` as an observed read (SwiftUI observation
/// replaces the React re-render), and emits `view.opened` exactly once per instance. The web component has
/// no fetcher, so neither does this holder.
@MainActor
@Observable
public final class WidgetComparisonCardModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetComparisonCardInput

    @ObservationIgnored private let telemetry: any WidgetComparisonCardTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetComparisonCardInput,
        telemetry: any WidgetComparisonCardTelemetry = OSLogWidgetComparisonCardTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render decision (web render output) — a pure function of the props.
    public var projection: WidgetComparisonCardProjection {
        WidgetComparisonCardProjector.resolve(input)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetComparisonCardInput) {
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
            telemetry.viewOpened(surface: WidgetComparisonCardSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
