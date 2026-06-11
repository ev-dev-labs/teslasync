//
//  MetricCard.Model.swift
//  TeslaSync — P4 shared surface · 0095 · MetricCard (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the metric card. The web `MetricCard` takes its data as plain props and composes `<Delta>` /
//  `<HelpTooltip>`, whose only hook is `useTranslation`; there is no fetcher, so the native peer needs
//  no data state-holder. What the holder DOES own is the surface lifecycle: it carries the current
//  ``MetricCardInputs``, derives the pure ``MetricCardProjection`` + the localized VoiceOver labels as
//  observed reads (SwiftUI observation replaces the React re-render), and emits the surface's single
//  `view.opened` diagnostics event. No networking lives here.
//
//  The localized copy resolved here is exactly the copy the composed web source speaks: the
//  `<HelpTooltip>` default trigger label (web `More info about {label}`) + its "Learn more" link (web
//  `t('common.learnMore', 'Learn more')`), and the `<Delta>` VoiceOver title (web `t('delta.title',
//  '{{current}} vs {{previous}}')`) + its no-comparison label (web `t('delta.noComparison', 'No
//  comparison data')`). The visible value / subtitle / pill text are caller-supplied (the web does not
//  translate them either), so they are not keyed here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "MetricCard" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the labels deterministic.
public enum MetricCardStrings {
    public static let table = "MetricCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The help "?" trigger's VoiceOver label — web default `` `More info about ${label}` ``. Localized
    /// here (an improvement over the web literal); `%1$@` is the metric label.
    public static func helpAccessibilityLabel(label: String) -> String {
        String(format: string("metricCard.help.ariaLabel", "More info about %1$@"), label)
    }

    /// The "Learn more" link label — web `t('common.learnMore', 'Learn more')`.
    public static var learnMoreLabel: String {
        string("common.learnMore", "Learn more")
    }

    /// The populated delta's VoiceOver title — web `t('delta.title', '{{current}} vs {{previous}}')`.
    /// `%1$@` / `%2$@` are the formatted endpoints (positional so a translation may reorder them).
    public static func deltaTitle(current: String, previous: String) -> String {
        String(format: string("delta.title", "%1$@ vs %2$@"), current, previous)
    }

    /// The empty delta's VoiceOver label — web `t('delta.noComparison', 'No comparison data')`.
    public static var deltaNoComparison: String {
        string("delta.noComparison", "No comparison data")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol MetricCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogMetricCardTelemetry: MetricCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - MetricCardModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``MetricCardInputs`` (the web props),
/// derives the pure ``MetricCardProjection`` + the localized VoiceOver labels as observed reads, and
/// emits `view.opened` exactly once per instance. The web component has no fetcher, so neither does
/// this holder — `update(_:)` is the native peer of React re-rendering with new props, reassigning
/// only when the inputs actually change so an unrelated re-render does not invalidate observers.
@MainActor
@Observable
public final class MetricCardModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an
    /// observation dependency, so the surface re-renders when the props change.
    public private(set) var inputs: MetricCardInputs

    @ObservationIgnored private let telemetry: any MetricCardTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        inputs: MetricCardInputs,
        telemetry: any MetricCardTelemetry = OSLogMetricCardTelemetry()
    ) {
        self.inputs = inputs
        self.telemetry = telemetry
    }

    /// The resolved, view-ready card (web render output).
    public var projection: MetricCardProjection {
        MetricCardProjector.resolve(inputs)
    }

    /// The VoiceOver label spoken for the headline — the metric label, its value, and (when present)
    /// the subtitle, read as one element so the card announces "Label, Value, Subtitle". Composed from
    /// the caller-supplied strings (the web does not translate them).
    public var valueAccessibilityLabel: String {
        var parts = [inputs.label, projection.valueText]
        if let subtitle = inputs.subtitle, !subtitle.isEmpty {
            parts.append(subtitle)
        }
        return parts.joined(separator: ", ")
    }

    /// The help "?" trigger's VoiceOver label — web `help.ariaLabel ?? 'More info about {label}'`.
    public var helpAccessibilityLabel: String {
        inputs.help?.ariaLabel ?? MetricCardStrings.helpAccessibilityLabel(label: inputs.label)
    }

    /// The "Learn more" link label for the help popover — web `learnMore.label ?? t('common.learnMore')`.
    public var learnMoreLabel: String {
        inputs.help?.learnMore?.label ?? MetricCardStrings.learnMoreLabel
    }

    /// The VoiceOver label for a resolved delta arm — the populated "current vs previous" title, or
    /// the "No comparison data" label for the empty / loading arms (web `title` attributes).
    public func deltaAccessibilityLabel(for projection: MetricCardDeltaProjection) -> String {
        switch projection {
        case let .value(value):
            MetricCardStrings.deltaTitle(current: value.currentText, previous: value.previousText)
        case .empty, .loading:
            MetricCardStrings.deltaNoComparison
        }
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ inputs: MetricCardInputs) {
        guard inputs != self.inputs else { return }
        self.inputs = inputs
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear/disappear churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: MetricCardSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
