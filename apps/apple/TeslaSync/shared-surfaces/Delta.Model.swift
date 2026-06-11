//
//  Delta.Model.swift
//  TeslaSync — P4 shared surface · 0081 · Delta (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the change indicator. The web `<Delta>` binds three display-boundary hooks — `useTranslation`,
//  `useUnits`, `useFormatting` — and takes its comparison data as plain props; there is no fetcher, so
//  the native peer needs no data state-holder. What the holder DOES own is the surface lifecycle: it
//  carries the current ``DeltaInputs`` (the props) + the bound ``UnitPreferences`` (the native peer of
//  `useUnits()` / `useFormatting()`, injected from the app's `\.tsUnits` environment), derives the
//  pure ``DeltaProjection`` + the localized VoiceOver label as observed reads (SwiftUI observation
//  replaces the React re-render), and emits the surface's single `view.opened` diagnostics event. No
//  networking lives here.
//
//  The localized copy resolved here is exactly the copy the web source speaks: the populated title
//  (web `t('delta.title', '{{current}} vs {{previous}}')`) and the no-comparison label (web
//  `t('delta.noComparison', 'No comparison data')`). The visible value text is composed from
//  glyphs + locale-formatted numbers (it is not translated copy in the web either).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "Delta" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the labels deterministic.
public enum DeltaStrings {
    public static let table = "Delta"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The populated indicator's VoiceOver title — web `t('delta.title', '{{current}} vs {{previous}}')`.
    /// `%1$@` / `%2$@` are the formatted endpoints (positional so a translation may reorder them).
    public static func title(current: String, previous: String) -> String {
        String(format: string("delta.title", "%1$@ vs %2$@"), current, previous)
    }

    /// The empty / loading indicator's VoiceOver label — web `t('delta.noComparison', 'No comparison
    /// data')`.
    public static var noComparison: String {
        string("delta.noComparison", "No comparison data")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DeltaTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDeltaTelemetry: DeltaTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - DeltaModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``DeltaInputs`` (the web props) + the
/// bound ``UnitPreferences`` (web `useUnits()` / `useFormatting()`), derives the pure
/// ``DeltaProjection`` + the localized VoiceOver label as observed reads, and emits `view.opened`
/// exactly once per instance. The web component has no fetcher, so neither does this holder —
/// `update(_:)` / `update(units:)` are the native peer of React re-rendering with new props / new
/// settings, reassigning only when the value actually changes so an unrelated re-render does not
/// invalidate observers.
@MainActor
@Observable
public final class DeltaModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an
    /// observation dependency, so the surface re-renders when the props change.
    public private(set) var inputs: DeltaInputs

    /// The bound display-unit preferences (web `useUnits()` / `useFormatting()`). Reassigned from the
    /// `\.tsUnits` environment by the view; a change re-derives the affixes + grouping.
    public private(set) var units: UnitPreferences

    @ObservationIgnored private let telemetry: any DeltaTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        inputs: DeltaInputs,
        units: UnitPreferences = .metric,
        telemetry: any DeltaTelemetry = OSLogDeltaTelemetry()
    ) {
        self.inputs = inputs
        self.units = units
        self.telemetry = telemetry
    }

    /// The resolved, view-ready indicator (web render output).
    public var projection: DeltaProjection {
        DeltaProjector.resolve(inputs, units: units)
    }

    /// Whether to render the indicator as a tight inline chip (web `inline`).
    public var inline: Bool {
        inputs.inline
    }

    /// The VoiceOver label — the populated "current vs previous" title when there is a comparison,
    /// else the "No comparison data" label (web `title` attributes). Loading announces the same
    /// no-comparison label; the visible skeleton is itself decorative (hidden from VoiceOver).
    public var accessibilityLabel: String {
        switch projection {
        case let .value(value):
            DeltaStrings.title(current: value.currentText, previous: value.previousText)
        case .empty, .loading:
            DeltaStrings.noComparison
        }
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ inputs: DeltaInputs) {
        guard inputs != self.inputs else { return }
        self.inputs = inputs
    }

    /// Replaces the bound unit preferences — called by the view when the `\.tsUnits` environment
    /// changes. Reassigns only when the value actually changes.
    public func update(units: UnitPreferences) {
        guard units != self.units else { return }
        self.units = units
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear/disappear churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DeltaSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
