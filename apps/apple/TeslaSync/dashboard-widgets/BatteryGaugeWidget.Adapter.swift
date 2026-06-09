//
//  BatteryGaugeWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0013 · BatteryGaugeWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `BatteryGaugeWidgetStateDTO` + number prefs → the
//  radial-gauge config (arc fill fraction, centre readout, "%" unit, "Battery" label, colour band)
//  and the charging flag, reproducing the web source's colour-banding + numeric pipeline VERBATIM so
//  the native surface shows the exact same value as
//  features/dashboard/widgets/BatteryGaugeWidget.tsx.
//
//  Deliberately free of SwiftUI so the banding/formatting compiles and executes on a plain host and
//  is pinned by unit tests. The view layers SwiftUI chrome (the ring, chip, tokens) on top in
//  BatteryGaugeWidget.swift / .Views.swift.
//

import Foundation

// MARK: - Battery colour bands (ported 1:1 from the web `batteryColor` thresholds)

/// The four colour bands the web widget maps a battery percentage onto. SwiftUI-free so the threshold
/// logic is host-testable; the concrete colours (`#10b981` / `#f59e0b` / `#ef4444` / `#374151`) are
/// applied in the view via `BatteryGaugeWidgetBand.color`.
public enum BatteryGaugeWidgetBand: String, Sendable, Equatable, CaseIterable {
    /// `> 50%` — green (`#10b981`).
    case high
    /// `> 20%` and `<= 50%` — amber (`#f59e0b`).
    case medium
    /// `<= 20%` — red (`#ef4444`).
    case low
    /// No vehicle state available — neutral grey (`#374151`). The gauge only renders when a state is
    /// present, so this band backs the web `!state` colour branch for parity + testability; the
    /// surface itself shows the empty state instead.
    case unknown

    /// Web `batteryColor()`: `!state` grey, then `> 50` green, `> 20` amber, else red. A `nil` level
    /// (no state) collapses to `unknown`; a non-finite level collapses to `low` (matching JS where
    /// `NaN > 50` and `NaN > 20` are both `false`).
    public static func classify(_ level: Double?) -> BatteryGaugeWidgetBand {
        guard let level else { return .unknown }
        guard level.isFinite else { return .low }
        if level > 50 { return .high }
        if level > 20 { return .medium }
        return .low
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts + RadialGauge readout)

/// Locale-aware number formatting that mirrors the web `RadialGauge` centre readout: `fmtNumber`
/// (`Intl.NumberFormat`, grouped, fixed fraction digits) over the value clamped into `0...max`.
public enum BatteryGaugeWidgetFormat {
    /// The web's literal `unit: '%'` — a symbol, not localized copy (matches the web source verbatim).
    public static let percentUnit = "%"

    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// The web `RadialGauge` centre readout: `fmtNumber(clamped, d)` where `clamped` is the value
    /// pinned into `0...max` and `d = Number.isInteger(clamped) ? 0 : getGlobalPrecision()`. Grouped +
    /// rounded half away from zero to match `Intl.NumberFormat`'s default for these non-negative
    /// percentages.
    public static func gaugeValue(
        _ value: Double,
        max: Double,
        precision: Int,
        localeIdentifier: String
    ) -> String {
        let clamped = Swift.max(0, Swift.min(safeNumber(value), max))
        let decimals = clamped == clamped.rounded() ? 0 : Swift.max(0, precision)
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: clamped)) ?? String(format: "%.\(decimals)f", clamped)
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs (the gauge label, the charging caption, and the
/// VoiceOver template). Injected so the projection stays Foundation-only and host-testable (the
/// view/model resolve these from `BatteryGaugeWidgetStrings`).
public struct BatteryGaugeWidgetCopy: Sendable, Equatable {
    /// Web `label: t('widget.battery', 'Battery')` — the caption beneath the ring.
    public var batteryLabel: String
    /// Web `t('widget.charging', 'Charging')` — the charging chip caption.
    public var charging: String
    /// VoiceOver template for the gauge. Arg (1) is the battery percentage value.
    public var batteryA11y: String

    public init(
        batteryLabel: String = "Battery",
        charging: String = "Charging",
        batteryA11y: String = "Battery %1$@ percent"
    ) {
        self.batteryLabel = batteryLabel
        self.charging = charging
        self.batteryA11y = batteryA11y
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = BatteryGaugeWidgetCopy()
}

// MARK: - Projected pieces (web `WidgetGaugeHero` / `RadialGauge`)

/// The projected radial-gauge hero: the arc fill fraction, the centre readout + "%" unit, the
/// "Battery" caption below, the colour band, and a spoken accessibility label. Mirrors the web
/// `RadialGauge` (`value` / `max` / `label` / `unit` / `color`) inside `WidgetGaugeHero`.
public struct BatteryGaugeWidgetGauge: Equatable {
    public let fraction: Double
    public let valueText: String
    public let unit: String
    public let label: String
    public let band: BatteryGaugeWidgetBand
    public let accessibilityLabel: String

    public init(
        fraction: Double,
        valueText: String,
        unit: String,
        label: String,
        band: BatteryGaugeWidgetBand,
        accessibilityLabel: String
    ) {
        self.fraction = fraction
        self.valueText = valueText
        self.unit = unit
        self.label = label
        self.band = band
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully projected widget content: the gauge hero + the charging flag/caption + a combined
/// accessibility summary. Computed once per snapshot.
public struct BatteryGaugeWidgetProjection: Equatable {
    public let gauge: BatteryGaugeWidgetGauge
    public let isCharging: Bool
    public let chargingText: String
    public let accessibilityLabel: String

    public init(
        gauge: BatteryGaugeWidgetGauge,
        isCharging: Bool,
        chargingText: String,
        accessibilityLabel: String
    ) {
        self.gauge = gauge
        self.isCharging = isCharging
        self.chargingText = chargingText
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Projection

/// Pure projector: a cached `BatteryGaugeWidgetStateDTO` + number prefs → a
/// `BatteryGaugeWidgetProjection`. Every value is computed with the same arithmetic + formatting +
/// colour banding as the web widget so a user with the web and native dashboards open side by side
/// sees an identical gauge.
public enum BatteryGaugeWidgetProjector {
    /// The gauge domain ceiling — web `max: 100`.
    public static let maxLevel = 100.0

    public static func project(
        state: BatteryGaugeWidgetStateDTO,
        format: BatteryGaugeWidgetFormatPrefs = BatteryGaugeWidgetFormatPrefs(),
        copy: BatteryGaugeWidgetCopy = .fallback
    ) -> BatteryGaugeWidgetProjection {
        // Web: gauge value = state.battery_level; colour = batteryColor(); a present state always
        // renders a gauge (the empty state replaces it only when there is no state at all).
        let level = state.batteryLevel
        let band = BatteryGaugeWidgetBand.classify(level)

        let valueText = BatteryGaugeWidgetFormat.gaugeValue(
            level,
            max: maxLevel,
            precision: format.precision,
            localeIdentifier: format.localeIdentifier
        )

        let gauge = BatteryGaugeWidgetGauge(
            fraction: fillFraction(level),
            valueText: valueText,
            unit: BatteryGaugeWidgetFormat.percentUnit,
            label: copy.batteryLabel,
            band: band,
            accessibilityLabel: String(format: copy.batteryA11y, valueText)
        )

        let chargingA11y = state.isCharging ? "\(gauge.accessibilityLabel). \(copy.charging)" : gauge.accessibilityLabel

        return BatteryGaugeWidgetProjection(
            gauge: gauge,
            isCharging: state.isCharging,
            chargingText: copy.charging,
            accessibilityLabel: chargingA11y
        )
    }

    /// The arc fill fraction in `0...1`. Web `RadialGauge` uses `clamped / max` where
    /// `clamped = max(0, min(value, max))`. A non-finite value collapses to 0.
    static func fillFraction(_ value: Double, max: Double = maxLevel) -> Double {
        let safe = BatteryGaugeWidgetFormat.safeNumber(value)
        return Swift.max(0, Swift.min(safe, max)) / max
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the gauge surface. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum BatteryGaugeWidgetAccessibility {
    /// The gauge readout, then the charging caption when charging:
    /// "Battery 85 percent" or "Battery 85 percent. Charging".
    public static func summary(for projection: BatteryGaugeWidgetProjection) -> String {
        projection.accessibilityLabel
    }
}
