//
//  DrivingTips.Adapter.swift
//  TeslaSync — P4 feature view · 0168 · DrivingTips (Apple)
//
//  The pure, Foundation-only adapter layer for the Driving Tips surface — the SwiftUI
//  parity of
//  web/src/features/driving/components/driving-dynamics/DrivingTips.tsx.
//
//  The web component is a presentational leaf fed the computed `motorStats`
//  (helpers.ts `MotorStats`) and `throttleStyle` (helpers.ts `ThrottleStyle`) its
//  parent (the /driving dynamics page) already derived from the SI signal_log. It
//  builds a list of localized driving-style recommendations with a `useMemo` keyed on
//  `motorStats` (average power + max motor temperature) and chooses each row's leading
//  icon from `throttleStyle`. Everything here is SwiftUI-free so it is exhaustively
//  unit-testable in isolation.
//
//  Unit semantics (mirrors the web prop contract — the parent page already computed
//  these from the SI signal_log via the P1/S8 holders, so this leaf treats them as
//  presentation values, not raw SI):
//    • power — kilowatts (kW)        (the > 20 / > 80 tip thresholds are in kW)
//    • temp  — degrees Celsius (°C)  (the > 120 high-temperature tip threshold)
//

import Foundation

// MARK: - Throttle style (web helpers.ts `ThrottleStyle` + `getThrottleStyle`)

/// The driving-style classification the web derives from average motor power
/// (`getThrottleStyle`) and passes to the component as the `throttleStyle` prop. The
/// surface reads only whether it is `.conservative` (to pick the row icon), but the
/// full three-case shape is modelled for parity with the web `ThrottleStyle` union.
public enum DrivingThrottleStyle: String, Sendable, Equatable, CaseIterable {
    case conservative
    case moderate
    case aggressive
}

/// Derivation of the throttle style from average power — the exact port of web
/// `getThrottleStyle(avgPower)` (`< 20` conservative, `< 80` moderate, else
/// aggressive). The web parent computes the `throttleStyle` prop with this helper; the
/// projection reuses it as a null-safe fallback when the source omits the prop.
///
/// Raw `<` comparisons (no coercion) so Swift's NaN/∞ semantics match JS exactly:
/// `NaN`/`+∞` fall through to aggressive, `-∞` is conservative — identical to the web.
public enum DrivingThrottle {
    public static func style(forAveragePowerKW avgPowerKW: Double) -> DrivingThrottleStyle {
        if avgPowerKW < 20 { return .conservative }
        if avgPowerKW < 80 { return .moderate }
        return .aggressive
    }
}

// MARK: - Motor metrics (web helpers.ts `MotorStats`, the subset this surface reads)

/// The computed motor statistics the web `DrivingTips` consumes. Only the two fields
/// the `useMemo` actually reads are carried: average motor power (kW) and the maximum
/// motor temperature (°C). A null value is the web `motorStats === null` branch.
public struct DrivingTipsMetrics: Sendable, Equatable {
    public var averagePowerKW: Double
    public var maxMotorTempC: Double

    public init(averagePowerKW: Double, maxMotorTempC: Double) {
        self.averagePowerKW = averagePowerKW
        self.maxMotorTempC = maxMotorTempC
    }
}

// MARK: - Recommendation catalog (web `t(key, default)` tip strings)

/// One driving-style recommendation. Each case carries its P1/S10 i18n key and the web
/// `t(key, default)` English fallback verbatim, so the view holds no hardcoded prose.
public enum DrivingTip: String, Sendable, Equatable, CaseIterable {
    case noData
    case easeAccel
    case brakeEarly
    case smoothThrottle
    case coast
    case great
    case keep
    case thermal

    /// The i18n key resolved through the P1/S10 facade (web `t(key, …)`).
    public var key: String {
        switch self {
        case .noData: "dynamics.tipNoData"
        case .easeAccel: "dynamics.tipEaseAccel"
        case .brakeEarly: "dynamics.tipBrakeEarly"
        case .smoothThrottle: "dynamics.tipSmoothThrottle"
        case .coast: "dynamics.tipCoast"
        case .great: "dynamics.tipGreat"
        case .keep: "dynamics.tipKeep"
        case .thermal: "dynamics.tipThermal"
        }
    }

    /// The web English fallback (the `t(key, default)` default), verbatim.
    public var fallback: String {
        switch self {
        case .noData:
            "Drive your vehicle to start collecting dynamics data."
        case .easeAccel:
            "Ease into the accelerator — gradual inputs save energy and tire wear."
        case .brakeEarly:
            "Brake earlier and lighter to improve regen capture."
        case .smoothThrottle:
            "Smooth throttle transitions can improve efficiency by 10–15%."
        case .coast:
            "Lift off the pedal earlier to let regen do the work."
        case .great:
            "Excellent driving style! Maintaining this maximizes range and comfort."
        case .keep:
            "Keep monitoring your scores — consistency is key."
        case .thermal:
            "Motor temps are running high — consider easing off sustained high power."
        }
    }
}

/// Pure port of the web component's `useMemo` recommendation builder. Given the metrics
/// (or `nil`) it returns the ordered recommendation list. Mirrors the web branch order
/// and the RAW `>` thresholds (so Swift NaN/∞ semantics match JS: a non-finite average
/// falls through to the "great" branch and never appends the thermal tip).
public enum DrivingTipsCatalog {
    /// Average power above which the web emits the "ease accelerator" tips (`avgPower > 80`).
    public static let highPowerThresholdKW: Double = 80
    /// Average power above which the web emits the "smooth throttle" tips (`avgPower > 20`).
    public static let moderatePowerThresholdKW: Double = 20
    /// Max motor temperature above which the web appends the thermal tip (`maxMotorTemp > 120`).
    public static let highMotorTempThresholdC: Double = 120

    public static func tips(for metrics: DrivingTipsMetrics?) -> [DrivingTip] {
        // Web `if (!motorStats) { list.push(tipNoData); return list; }`.
        guard let metrics else { return [.noData] }

        var list: [DrivingTip] = []
        if metrics.averagePowerKW > highPowerThresholdKW {
            list.append(.easeAccel)
            list.append(.brakeEarly)
        } else if metrics.averagePowerKW > moderatePowerThresholdKW {
            list.append(.smoothThrottle)
            list.append(.coast)
        } else {
            list.append(.great)
            list.append(.keep)
        }
        // Web `if (motorStats.maxMotorTemp > 120) { list.push(tipThermal); }`.
        if metrics.maxMotorTempC > highMotorTempThresholdC {
            list.append(.thermal)
        }
        return list
    }
}

// MARK: - Row icon (web `throttleStyle === 'conservative' ? ShieldCheck : AlertTriangle`)

/// The leading icon shared by every recommendation row. The web picks it purely from
/// the `throttleStyle` prop: a reassuring shield for `conservative`, otherwise a
/// caution triangle. A null style (the web `motorStats === null` branch passes no
/// style) is therefore `.caution`, matching `null !== 'conservative'`.
public enum DrivingTipIcon: String, Sendable, Equatable, CaseIterable {
    case reassuring
    case caution

    public static func from(throttleStyle: DrivingThrottleStyle?) -> DrivingTipIcon {
        throttleStyle == .conservative ? .reassuring : .caution
    }
}

// MARK: - Accessibility summaries

/// Builds the combined VoiceOver string for the recommendation list, joining the
/// already-localized rows so the label stays translation-driven.
public enum DrivingTipsAccessibility {
    /// Joins non-empty parts with ", " (the standard VoiceOver list separator).
    public static func join(_ parts: [String]) -> String {
        parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
