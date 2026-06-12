//
//  RangeSlider.Model.swift
//  TeslaSync — P4 shared surface · 0224 · RangeSlider (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  dual-thumb range slider. The web `<RangeSlider>` is a controlled presentational component: its `value`
//  and `onChange` are plain props and there is no fetcher — so the native peer needs no data state-holder.
//  What the holder DOES own is the surface's interaction state (the current ``RangeSliderInput``, the
//  page-supplied `onChange` + `formatValue` closures kept here so the value types stay closure-free +
//  `Equatable`), the derived ``RangeSliderProjection`` as an observed read, and the single `view.opened`
//  diagnostics event. No networking lives here.
//
//  The web source resolves two localized keys — `slider.thumbMin` ("{{label}} minimum") and
//  `slider.thumbMax` ("{{label}} maximum") — for the per-thumb accessible names; those are mirrored here
//  verbatim. The remaining strings (the spoken range connector and the degenerate-range affordance copy)
//  are native a11y / HIG additions.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics metadata (P1/S11)

/// Static, non-identifying metadata for the surface.
public enum RangeSliderMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RangeSliderSurface.slug
    /// The VoiceOver / keyboard adjustment notch used when the prop `step` is non-positive (web Arrow keys
    /// step by `step`, which defaults to 1).
    public static let fallbackStep: Double = 1
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "RangeSlider" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum RangeSliderStrings {
    public static let table = "RangeSlider"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The low thumb's accessible name — the web `t('slider.thumbMin', '{{label}} minimum', { label })`.
    public static func minThumbLabel(label: String) -> String {
        interpolate(string("slider.thumbMin", "{{label}} minimum"), label: label)
    }

    /// The high thumb's accessible name — the web `t('slider.thumbMax', '{{label}} maximum', { label })`.
    public static func maxThumbLabel(label: String) -> String {
        interpolate(string("slider.thumbMax", "{{label}} maximum"), label: label)
    }

    /// The spoken connector between the low and high values in the summary element, e.g. "0 to 100" (the
    /// visible row uses an en-dash; this is the VoiceOver-friendly word). Native a11y addition.
    public static var rangeConnector: String {
        string("slider.rangeConnector", "to")
    }

    /// The combined summary read for the label row: "{{label}}, {{low}} to {{high}}". Native a11y addition
    /// so the row reads as one phrase rather than label + dash + values.
    public static func valueSummary(label: String, low: String, high: String) -> String {
        "\(label), \(low) \(rangeConnector) \(high)"
    }

    /// Title of the degenerate-range affordance, shown when `max <= min` so the surface never renders an
    /// unusable / blank track (native HIG; the web simply renders a full, immovable track).
    public static var emptyTitle: String {
        string("slider.empty", "No range to adjust")
    }

    /// Supporting line of the degenerate-range affordance.
    public static var emptyMessage: String {
        string("slider.emptyMessage", "A range appears here once the minimum and maximum differ.")
    }

    private static func interpolate(_ template: String, label: String) -> String {
        template.replacingOccurrences(of: "{{label}}", with: label)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol RangeSliderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogRangeSliderTelemetry: RangeSliderTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - RangeSliderModel (P1/S8) — interaction state + routing

/// The surface's observable state-holder. It owns the current ``RangeSliderInput`` (the web props),
/// derives the pure ``RangeSliderProjection`` as an observed read (SwiftUI observation replaces the React
/// re-render), formats the displayed / spoken values (web `formatValue ?? String`), resolves the per-thumb
/// accessible names (web `minThumbLabel ?? t(...)`), routes every thumb change through the web swap rules
/// to the page's `onChange`, and emits `view.opened` exactly once per instance. The web component has no
/// fetcher, so neither does this holder.
///
/// Control model: the web slider is fully controlled (the page owns `value`). The native peer applies each
/// change OPTIMISTICALLY to its local `input` — so a drag stays responsive and previews / tests run without
/// an external store — AND emits it through `onChange`; when the page re-binds the resulting value,
/// ``update(_:onChange:formatValue:)`` reconciles (a no-op when the value matches, an override otherwise).
@MainActor
@Observable
public final class RangeSliderModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: RangeSliderInput

    @ObservationIgnored private var onChange: (@MainActor (Double, Double) -> Void)?
    @ObservationIgnored private var formatValue: (@MainActor (Double) -> String)?
    @ObservationIgnored private let telemetry: any RangeSliderTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: RangeSliderInput,
        onChange: (@MainActor (Double, Double) -> Void)? = nil,
        formatValue: (@MainActor (Double) -> String)? = nil,
        telemetry: any RangeSliderTelemetry = OSLogRangeSliderTelemetry()
    ) {
        self.input = input
        self.onChange = onChange
        self.formatValue = formatValue
        self.telemetry = telemetry
    }

    /// The resolved, view-ready slider (web render output) — a pure function of the props.
    public var projection: RangeSliderProjection {
        RangeSliderProjector.resolve(input: input)
    }

    // MARK: Display + accessibility copy

    /// Formats one value for display — the web `formatValue ? formatValue(v) : String(v)`.
    public func display(_ value: Double) -> String {
        if let formatValue {
            return formatValue(value)
        }
        return RangeSliderProjector.defaultFormat(value)
    }

    /// The formatted low value (web `displayLow`).
    public var displayLow: String {
        display(input.low)
    }

    /// The formatted high value (web `displayHigh`).
    public var displayHigh: String {
        display(input.high)
    }

    /// The low thumb's accessible name — web `minThumbLabel ?? t('slider.thumbMin', …)`.
    public var lowThumbLabel: String {
        input.minThumbLabel ?? RangeSliderStrings.minThumbLabel(label: input.label)
    }

    /// The high thumb's accessible name — web `maxThumbLabel ?? t('slider.thumbMax', …)`.
    public var highThumbLabel: String {
        input.maxThumbLabel ?? RangeSliderStrings.maxThumbLabel(label: input.label)
    }

    /// The combined spoken summary for the label row.
    public var valueSummary: String {
        RangeSliderStrings.valueSummary(label: input.label, low: displayLow, high: displayHigh)
    }

    // MARK: Thumb changes (web handleLowChange / handleHighChange)

    /// Moves the LOW thumb to a raw value: snap + clamp it (the native `<input step>` behavior), apply the
    /// web swap rule, store optimistically, and emit. No-op while disabled.
    public func setLow(_ raw: Double) {
        guard !input.isDisabled else { return }
        let next = RangeSliderProjector.snapped(value: raw, min: input.min, max: input.max, step: input.step)
        commit(RangeSliderProjector.applyLowChange(next: next, high: input.high))
    }

    /// Moves the HIGH thumb to a raw value, mirroring ``setLow(_:)`` with the web `handleHighChange` swap.
    public func setHigh(_ raw: Double) {
        guard !input.isDisabled else { return }
        let next = RangeSliderProjector.snapped(value: raw, min: input.min, max: input.max, step: input.step)
        commit(RangeSliderProjector.applyHighChange(next: next, low: input.low))
    }

    /// Moves the low thumb to a 0…1 fraction across the track (drag).
    public func dragLow(toFraction fraction: Double) {
        setLow(RangeSliderProjector.value(fromFraction: fraction, min: input.min, max: input.max, step: input.step))
    }

    /// Moves the high thumb to a 0…1 fraction across the track (drag).
    public func dragHigh(toFraction fraction: Double) {
        setHigh(RangeSliderProjector.value(fromFraction: fraction, min: input.min, max: input.max, step: input.step))
    }

    /// The notch one VoiceOver / keyboard step moves — the prop `step`, or the fallback when non-positive
    /// (web Arrow keys step by `step`).
    private var adjustStep: Double {
        input.step > 0 ? input.step : RangeSliderMeta.fallbackStep
    }

    /// Nudges the low thumb up one step (VoiceOver increment / Arrow-up).
    public func incrementLow() {
        setLow(input.low + adjustStep)
    }

    /// Nudges the low thumb down one step (VoiceOver decrement / Arrow-down).
    public func decrementLow() {
        setLow(input.low - adjustStep)
    }

    /// Nudges the high thumb up one step.
    public func incrementHigh() {
        setHigh(input.high + adjustStep)
    }

    /// Nudges the high thumb down one step.
    public func decrementHigh() {
        setHigh(input.high - adjustStep)
    }

    private func commit(_ next: (low: Double, high: Double)) {
        input = input.updatingValue(low: next.low, high: next.high)
        onChange?(next.low, next.high)
    }

    // MARK: Lifecycle

    /// Replaces the props + the page closures — the native peer of React re-rendering with new props. The
    /// closures are always refreshed (they are recreated each parent render); the props reassign only when
    /// they actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(
        _ input: RangeSliderInput,
        onChange: (@MainActor (Double, Double) -> Void)?,
        formatValue: (@MainActor (Double) -> String)?
    ) {
        self.onChange = onChange
        self.formatValue = formatValue
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
            telemetry.viewOpened(surface: RangeSliderSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
