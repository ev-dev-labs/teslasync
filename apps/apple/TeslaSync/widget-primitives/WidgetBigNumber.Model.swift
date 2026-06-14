//
//  WidgetBigNumber.Model.swift
//  TeslaSync — P4 widget primitive · 0001 · WidgetBigNumber (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  big-number primitive. The web `<WidgetBigNumber>` is purely presentational: it takes its data as plain
//  props and renders, with no fetcher — so the native peer needs no data state-holder. What the holder
//  DOES own is the current ``WidgetBigNumberInput`` (the props, observed so a rebind re-renders), the
//  derived ``WidgetBigNumberProjection`` as an observed read (SwiftUI observation replaces the React
//  re-render), and the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders ZERO copy of its own — it is anonymous (no `t()` calls; its `value` / `unit` /
//  `label` / `subtitle` / `badge.text` are caller-supplied, already-localized props rendered verbatim,
//  and `nullDisplay` defaults to the symbol "—"). The strings resolved here are therefore purely the
//  native VoiceOver additions (the value-with-unit join and the combined reading), so the Swift sources
//  hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetBigNumber" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the labels deterministic. The web component has no copy of its own, so every entry here is a
/// native a11y / HIG addition.
public enum WidgetBigNumberStrings {
    public static let table = "WidgetBigNumber"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The separator joining the spoken parts of the combined VoiceOver reading ("{value}, {label}, …").
    public static var accessibilitySeparator: String {
        string("widgetBigNumber.a11ySeparator", ", ")
    }

    /// Joins a formatted value with its optional unit affix — "{value} {unit}" — for the value's spoken
    /// reading. Returns the bare value when there is no unit, mirroring the web conditional affix. A
    /// positional format so translators can reorder the two parts.
    public static func valueWithUnit(value: String, unit: String?) -> String {
        guard let unit, !unit.isEmpty else { return value }
        let format = string("widgetBigNumber.valueUnit", "%1$@ %2$@")
        return String(format: format, value, unit)
    }

    /// Composes the surface's combined VoiceOver reading from the resolved parts — the value (with its
    /// unit), then the label, the subtitle, and the badge copy, skipping any that are absent/empty, joined
    /// by ``accessibilitySeparator``. So the whole primitive is scanned as a single, meaningful element.
    public static func accessibilityLabel(
        value: String,
        unit: String?,
        label: String?,
        subtitle: String?,
        badge: String?
    ) -> String {
        var parts = [valueWithUnit(value: value, unit: unit)]
        for affix in [label, subtitle, badge] {
            if let affix, !affix.isEmpty {
                parts.append(affix)
            }
        }
        return parts.joined(separator: accessibilitySeparator)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetBigNumberTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogWidgetBigNumberTelemetry: WidgetBigNumberTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetBigNumberModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetBigNumberInput`` (the web props),
/// derives the pure ``WidgetBigNumberProjection`` as an observed read (SwiftUI observation replaces the
/// React re-render), and emits `view.opened` exactly once per instance. The web component has no fetcher,
/// so neither does this holder.
@MainActor
@Observable
public final class WidgetBigNumberModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetBigNumberInput

    @ObservationIgnored private let telemetry: any WidgetBigNumberTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetBigNumberInput,
        telemetry: any WidgetBigNumberTelemetry = OSLogWidgetBigNumberTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render decision (web render output) — a pure function of the props.
    public var projection: WidgetBigNumberProjection {
        WidgetBigNumberProjector.resolve(input)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetBigNumberInput) {
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
            telemetry.viewOpened(surface: WidgetBigNumberSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
