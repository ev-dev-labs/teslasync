//
//  BatteryDelta.Model.swift
//  TeslaSync — P4 shared surface · 0077 · BatteryDelta (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8)
//  for the battery delta. The web component binds a single hook — `useTranslation` — and takes its
//  data as plain props; there is no fetcher, so the native peer needs no data state-holder. What the
//  holder DOES own is the surface lifecycle: it carries the current ``BatteryDeltaInputs``, derives
//  the pure ``BatteryDeltaProjection`` + the localized VoiceOver label as observed reads (SwiftUI
//  observation replaces the React re-render), and emits the surface's single `view.opened`
//  diagnostics event. No networking lives here; the derivation is the pure projection, so the holder
//  is a thin, testable shell.
//
//  The web carries two pieces of user-facing copy — both VoiceOver-only `aria-label`s — which resolve
//  here through the P1/S10 facade: the "Battery delta unknown" no-data label and the
//  "Battery {from}% to {to}%" populated label. The visible "+60%" / "79% → 78%" text is composed from
//  glyphs + JS-formatted numbers (it is not translated copy in the web either).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. The two keys mirror the web `t()` calls verbatim (`battery.delta.unknown`,
/// `battery.delta.aria`). Keys live in the "BatteryDelta" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; in test / preview bundles `NSLocalizedString`
/// returns the `value:` fallback, keeping the projection deterministic.
public enum BatteryDeltaStrings {
    public static let table = "BatteryDelta"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The no-data VoiceOver label — web `t('battery.delta.unknown', 'Battery delta unknown')`.
    public static var unknownAccessibilityLabel: String {
        string("battery.delta.unknown", "Battery delta unknown")
    }

    /// The populated VoiceOver label — web `t('battery.delta.aria', 'Battery {{from}}% to {{to}}%',
    /// { from, to })`. The interpolation is positional (`%1$@` / `%2$@`) so a translation may reorder
    /// the endpoints; the literal percent is escaped as `%%`.
    public static func accessibilityLabel(from: String, to: String) -> String {
        let template = string("battery.delta.aria", "Battery %1$@%% to %2$@%%")
        return String(format: template, from, to)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol BatteryDeltaTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogBatteryDeltaTelemetry: BatteryDeltaTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - BatteryDeltaModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``BatteryDeltaInputs`` (the web props),
/// derives the pure ``BatteryDeltaProjection`` + the localized VoiceOver label as observed reads, and
/// emits `view.opened` exactly once per instance. The web component has no fetcher, so neither does
/// this holder — `update(_:)` is the native peer of React re-rendering with new props, reassigning
/// only when the inputs actually change so an unrelated re-render does not invalidate observers.
@MainActor
@Observable
public final class BatteryDeltaModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an
    /// observation dependency, so the surface re-renders when the endpoints / variant change.
    public private(set) var inputs: BatteryDeltaInputs

    @ObservationIgnored private let telemetry: any BatteryDeltaTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        inputs: BatteryDeltaInputs,
        telemetry: any BatteryDeltaTelemetry = OSLogBatteryDeltaTelemetry()
    ) {
        self.inputs = inputs
        self.telemetry = telemetry
    }

    public convenience init(
        startPct: Double?,
        endPct: Double?,
        variant: BatteryDeltaVariant = .defaultVariant,
        showIcon: Bool = true,
        telemetry: any BatteryDeltaTelemetry = OSLogBatteryDeltaTelemetry()
    ) {
        self.init(
            inputs: BatteryDeltaInputs(
                startPct: startPct,
                endPct: endPct,
                variant: variant,
                showIcon: showIcon
            ),
            telemetry: telemetry
        )
    }

    /// The resolved, view-ready delta (web render output).
    public var projection: BatteryDeltaProjection {
        BatteryDeltaProjector.resolve(
            startPct: inputs.startPct,
            endPct: inputs.endPct,
            variant: inputs.variant
        )
    }

    /// Whether the battery icon is shown (web `showIcon`).
    public var showIcon: Bool {
        inputs.showIcon
    }

    /// The VoiceOver label — the populated "Battery {from}% to {to}%" when there is data, else the
    /// "Battery delta unknown" no-data label (web `aria-label`).
    public var accessibilityLabel: String {
        let resolved = projection
        guard resolved.hasData,
              let fromValue = resolved.accessibilityFrom,
              let toValue = resolved.accessibilityTo
        else {
            return BatteryDeltaStrings.unknownAccessibilityLabel
        }
        return BatteryDeltaStrings.accessibilityLabel(from: fromValue, to: toValue)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ inputs: BatteryDeltaInputs) {
        guard inputs != self.inputs else { return }
        self.inputs = inputs
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear/disappear churn — the event fires a single time per model instance, never again on a
    /// later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: BatteryDeltaSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear
    /// lifecycle; the once-only `view.opened` contract is preserved (a later ``start()`` does not
    /// re-emit).
    public func stop() {
        started = false
    }
}
