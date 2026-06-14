//
//  WidgetGaugeHero.Model.swift
//  TeslaSync — P4 widget primitive · 0007 · WidgetGaugeHero (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  gauge hero. The web `<WidgetGaugeHero>` is purely presentational: it takes its data as plain props and
//  renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES own is the
//  current ``WidgetGaugeHeroInput`` (the props, observed so a rebind re-renders), the display `precision` +
//  `locale` (the device-locale peer of the web global formatter settings), the derived
//  ``WidgetGaugeHeroLayout`` as an observed read (SwiftUI observation replaces the React re-render), and the
//  single `view.opened` diagnostics event. No networking lives here.
//
//  The web source (and the `RadialGauge` it composes) renders NO copy string of its own — every visible
//  string (`gauge.label`, `gauge.unit`, each stat's `label` / `value` / `unit`) is a caller-supplied,
//  already-localized prop rendered verbatim, and there are zero `t()` calls. So every key resolved here is a
//  NATIVE accessibility / HIG addition (the ring's combined VoiceOver reading + its spoken percent value,
//  and each stat's combined reading), resolved through the P1/S10 facade with an English fallback so the
//  Swift sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetGaugeHero" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum WidgetGaugeHeroStrings {
    public static let table = "WidgetGaugeHero"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Joins a formatted value with its optional unit affix — "{value} {unit}" — for a spoken reading.
    /// Returns the bare value when there is no unit, mirroring the web conditional affix.
    public static func valueWithUnit(value: String, unit: String?) -> String {
        guard let unit, !unit.isEmpty else { return value }
        let format = string("widgetGaugeHero.valueUnit", "%1$@ %2$@")
        return String(format: format, value, unit)
    }

    /// The ring's combined VoiceOver reading — "{label}, {value}{unit}", e.g. "State of charge, 74 %". A
    /// positional format so translators can reorder the caption and the reading.
    public static func gaugeAccessibilityLabel(label: String, value: String, unit: String) -> String {
        let reading = valueWithUnit(value: value, unit: unit.isEmpty ? nil : unit)
        let format = string("widgetGaugeHero.gaugeLabel", "%1$@, %2$@")
        return String(format: format, label, reading)
    }

    /// The ring's spoken accessibility value — the whole-percent fill, e.g. "74% of maximum". The `%%` is a
    /// literal percent sign; the positional integer lets translators reorder.
    public static func gaugeAccessibilityValue(percent: Int) -> String {
        let format = string("widgetGaugeHero.gaugeValue", "%1$d%% of maximum")
        return String(format: format, percent)
    }

    /// A supporting stat's combined VoiceOver reading — "{label}, {value}{unit}". A positional format so
    /// translators can reorder.
    public static func statAccessibilityLabel(label: String, value: String, unit: String?) -> String {
        let reading = valueWithUnit(value: value, unit: unit)
        let format = string("widgetGaugeHero.statLabel", "%1$@, %2$@")
        return String(format: format, label, reading)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetGaugeHeroTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogWidgetGaugeHeroTelemetry: WidgetGaugeHeroTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetGaugeHeroModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetGaugeHeroInput`` (the web props) plus
/// the display `precision` + `locale` (the device-locale peer of the web global formatter settings),
/// derives the pure ``WidgetGaugeHeroLayout`` as an observed read (SwiftUI observation replaces the React
/// re-render), and emits `view.opened` exactly once per instance. The web component has no fetcher, so
/// neither does this holder.
@MainActor
@Observable
public final class WidgetGaugeHeroModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetGaugeHeroInput

    /// The decimal precision for a non-integer center value (web global precision; default `2`).
    public private(set) var precision: Int

    /// The locale used to format the center value (the device-locale peer of the web global locale).
    public private(set) var locale: Locale

    @ObservationIgnored private let telemetry: any WidgetGaugeHeroTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetGaugeHeroInput,
        precision: Int = GaugeValueFormatter.defaultPrecision,
        locale: Locale = .current,
        telemetry: any WidgetGaugeHeroTelemetry = OSLogWidgetGaugeHeroTelemetry()
    ) {
        self.input = input
        self.precision = precision
        self.locale = locale
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render — a pure function of the props + the display settings.
    public var projection: WidgetGaugeHeroLayout {
        WidgetGaugeHeroProjector.resolve(input, precision: precision, locale: locale)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetGaugeHeroInput) {
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
            telemetry.viewOpened(surface: WidgetGaugeHeroSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
