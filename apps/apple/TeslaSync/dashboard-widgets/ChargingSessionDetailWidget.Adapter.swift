//
//  ChargingSessionDetailWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0024 · ChargingSessionDetailWidget (Apple)
//
//  The testable projection core: the latest-session selector (web `latestSessionId`
//  reduce), the charger classifier (web `classifyCharger`), the cached session +
//  watt telemetry → view-ready `ChargingSessionDetailSummary`/`…Point` projection
//  (kWh + kW + duration label + peak power, parity with the web `stats` memos), the
//  dual-axis scale that maps SoC% into the kW plotting space (web right `YAxis`),
//  the number/time/duration formatters, and the VoiceOver summary builders. All
//  pure + dependency-free (only SwiftUI's `Color`) so the adapter can be
//  unit-tested without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Charger classification (web `classifyCharger`)

/// The classified charger for the latest session — the native port of the web
/// `classifyCharger` switch (Supercharger / DC Fast warning chips, AC-Home neutral).
/// Carries the i18n key + web English fallback + chip tone so the badge localizes.
public enum ChargingSessionDetailCharger: String, Sendable, Equatable, CaseIterable {
    case supercharger
    case dcFast
    case acHome

    /// Web `variant: 'warning' | 'neutral'` — Supercharger / DC Fast warn, AC neutral.
    public enum Tone: Sendable, Equatable {
        case warning
        case neutral
    }

    public var tone: Tone {
        switch self {
        case .supercharger, .dcFast: .warning
        case .acHome: .neutral
        }
    }

    /// The i18n key for the chip label (web hardcoded literals, localized natively).
    public var labelKey: String {
        switch self {
        case .supercharger: "widget.chargingSessionDetail.chargerSupercharger"
        case .dcFast: "widget.chargingSessionDetail.chargerDcFast"
        case .acHome: "widget.chargingSessionDetail.chargerAcHome"
        }
    }

    /// The web English fallback label (web `'Supercharger' | 'DC Fast' | 'AC / Home'`).
    public var fallbackLabel: String {
        switch self {
        case .supercharger: "Supercharger"
        case .dcFast: "DC Fast"
        case .acHome: "AC / Home"
        }
    }

    /// The localized chip label resolved through the injected localizer.
    public func localizedLabel(_ localize: (String, String) -> String) -> String {
        localize(labelKey, fallbackLabel)
    }
}

// MARK: - Point projection (web `chartData` row)

/// One time bucket of the power/SoC chart — the native port of the web `ChartDatum`,
/// carrying the charger power in kilowatts (web divides the watt sample by 1000) and
/// the state-of-charge percentage. Both nullable so the chart connects across gaps.
public struct ChargingSessionDetailPoint: Identifiable, Equatable, Sendable {
    public let id: String
    public let date: Date
    public let powerKw: Double?
    public let soc: Double?

    public init(date: Date, powerKw: Double?, soc: Double?) {
        id = String(date.timeIntervalSince1970)
        self.date = date
        self.powerKw = powerKw
        self.soc = soc
    }
}

// MARK: - Summary projection (web `stats` memo)

/// The four header stats (web `WidgetChartSummary` stats): energy added (kWh), the
/// duration label, peak charger power (kW), and the classified charger. Projected
/// from the session detail + its telemetry.
public struct ChargingSessionDetailSummary: Equatable, Sendable {
    public let energyKwh: Double
    public let durationMinutes: Int
    public let peakPowerKw: Double
    public let charger: ChargingSessionDetailCharger

    public init(energyKwh: Double, durationMinutes: Int, peakPowerKw: Double, charger: ChargingSessionDetailCharger) {
        self.energyKwh = energyKwh
        self.durationMinutes = durationMinutes
        self.peakPowerKw = peakPowerKw
        self.charger = charger
    }
}

// MARK: - Dual-axis scale (web left power `YAxis` + right SoC `YAxis`)

/// Maps the SoC% series (0…100, web right axis `domain={[0, 100]}`) into the kW
/// plotting space (web left axis `domain={[0, 'dataMax + 5']}`) so a single Swift
/// Charts y-scale renders both series and the trailing SoC axis lines up exactly.
public struct ChargingSessionDetailScale: Equatable, Sendable {
    /// The top of the power axis in kW (web `dataMax + 5`, floored so a flat/empty
    /// curve still has a sane range).
    public let powerMax: Double

    public init(peakPowerKw: Double) {
        powerMax = max(peakPowerKw, 0) + 5
    }

    /// Projects a SoC percentage into the kW plotting space.
    public func socToPower(_ soc: Double) -> Double {
        (soc / 100) * powerMax
    }

    /// Inverse of `socToPower` for the trailing axis tick labels.
    public func powerToSoc(_ value: Double) -> Double {
        powerMax > 0 ? (value / powerMax) * 100 : 0
    }
}

// MARK: - Projection core

/// Pure projection from the cached session + watt telemetry to the view-ready
/// summary stats and chart points. Mirrors the web `latestSessionId`, `chartData`,
/// `durationStr`, `peakPower`, `charger`, and `stats` memos.
public enum ChargingSessionDetailProjection {
    /// Picks the id of the most-recent session (web `latestSessionId` reduce over
    /// `useChargingSessions` by `startedAt`). Returns nil for an empty list.
    public static func latestSessionID(from refs: [ChargingSessionRef]) -> Int64? {
        refs.max(by: { $0.startedAt < $1.startedAt })?.id
    }

    /// Classifies the charger from its raw type (web `classifyCharger`): nil/empty →
    /// AC-Home; contains "supercharger"/"tesla" → Supercharger; "<invalid>" →
    /// AC-Home; any other non-empty value → DC Fast.
    public static func classifyCharger(_ chargerType: String?) -> ChargingSessionDetailCharger {
        guard let raw = chargerType, !raw.isEmpty else { return .acHome }
        let normalized = raw.lowercased()
        if normalized.contains("supercharger") || normalized.contains("tesla") {
            return .supercharger
        }
        if normalized != "<invalid>" {
            return .dcFast
        }
        return .acHome
    }

    /// Converts the watt telemetry samples to chart points, applying the web
    /// `power_kw` (watt → kilowatt) conversion and the `battery_level ?? soc`
    /// state-of-charge already resolved on the sample.
    public static func points(from samples: [ChargingSessionDetailSampleInput]) -> [ChargingSessionDetailPoint] {
        samples.map { sample in
            ChargingSessionDetailPoint(
                date: sample.timestamp,
                powerKw: sample.powerW.map { $0 / 1000 },
                soc: sample.socPercent
            )
        }
    }

    /// The peak charger power in kW across the telemetry (web `peakPower` reduce of
    /// `max(power_kw)`, defaulting to 0).
    public static func peakPowerKw(from samples: [ChargingSessionDetailSampleInput]) -> Double {
        samples.reduce(0.0) { max($0, ($1.powerW ?? 0) / 1000) }
    }

    /// Whole minutes from SI seconds (web `duration_min`), truncated like the
    /// server-computed integer minute count.
    public static func durationMinutes(fromSeconds seconds: Double) -> Int {
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return Int(seconds / 60)
    }

    /// Projects the four header stats from the session detail + its telemetry.
    public static func summary(
        detail: ChargingSessionDetailInput,
        samples: [ChargingSessionDetailSampleInput]
    ) -> ChargingSessionDetailSummary {
        ChargingSessionDetailSummary(
            energyKwh: detail.energyAddedWh / 1000,
            durationMinutes: durationMinutes(fromSeconds: detail.durationS),
            peakPowerKw: peakPowerKw(from: samples),
            charger: classifyCharger(detail.chargerType)
        )
    }

    /// The dual-axis scale for the chart (peak power → top of the kW axis).
    public static func scale(for summary: ChargingSessionDetailSummary) -> ChargingSessionDetailScale {
        ChargingSessionDetailScale(peakPowerKw: summary.peakPowerKw)
    }

    /// Whether any point carries a power or SoC reading (web `<Area>`/`<Line>`
    /// connectNulls render nothing when every value is null); gates the chart body.
    public static func hasSeries(_ points: [ChargingSessionDetailPoint]) -> Bool {
        points.contains { $0.powerKw != nil || $0.soc != nil }
    }
}

// MARK: - Formatters (web `fmtNumber` / `shortTime` / `durationStr`)

/// Locale-aware number, time, and duration formatting for the surface, kept pure so
/// the rendered strings can be asserted deterministically with an explicit locale.
public enum ChargingSessionDetailFormat {
    /// One-decimal value (web `fmtNumber(value, 1)`) used for kWh + kW. Non-finite
    /// input renders an em dash rather than "nan".
    public static func decimal1(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 1
        // Half-up (away from zero) so display matches the web `Intl`/`toFixed`
        // rounding rather than `NumberFormatter`'s default banker's rounding.
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.1f", value)
    }

    /// The duration label (web `durationStr`): `Xm` under an hour, else `Hh Mm`
    /// (or `Hh` on the hour).
    public static func duration(minutes: Int, localize: (String, String) -> String) -> String {
        let minuteUnit = localize("widget.chargingSessionDetail.unitMinute", "m")
        let hourUnit = localize("widget.chargingSessionDetail.unitHour", "h")
        guard minutes >= 60 else { return "\(minutes)\(minuteUnit)" }
        let hours = minutes / 60
        let mins = minutes % 60
        return mins > 0 ? "\(hours)\(hourUnit) \(mins)\(minuteUnit)" : "\(hours)\(hourUnit)"
    }

    /// Zero-padded 24-hour `HH:mm` bucket label (web `shortTime` built from
    /// `getHours()`/`getMinutes()`). `calendar` is injectable for deterministic tests.
    public static func shortTime(_ date: Date, calendar: Calendar = .current) -> String {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the chart + stat row. Pure + public so the
/// spoken content can be unit-tested without rendering the view.
public enum ChargingSessionDetailAccessibility {
    /// One spoken stat fragment, e.g. "Energy Added: 12.4 kWh".
    public static func statLabel(value: String, labelKey _: String, fallback: String, unit: String?) -> String {
        let unitSuffix = unit.map { " \($0)" } ?? ""
        return "\(fallback): \(value)\(unitSuffix)"
    }

    /// The combined VoiceOver summary for the surface (title + the four stats),
    /// using the injected localizer + locale so it is deterministic in tests.
    public static func summary(
        _ summary: ChargingSessionDetailSummary,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let energy = ChargingSessionDetailFormat.decimal1(summary.energyKwh, locale: locale)
        let peak = ChargingSessionDetailFormat.decimal1(summary.peakPowerKw, locale: locale)
        let duration = ChargingSessionDetailFormat.duration(minutes: summary.durationMinutes, localize: localize)
        let parts = [
            localize("widget.chargingSessionDetail.title", "Charge Session Detail"),
            "\(localize("widget.chargingSessionDetail.energy", "Energy Added")): "
                + "\(energy) \(localize("widget.chargingSessionDetail.unitKwhSymbol", "kWh"))",
            "\(localize("widget.chargingSessionDetail.duration", "Duration")): \(duration)",
            "\(localize("widget.chargingSessionDetail.peakPower", "Peak Power")): "
                + "\(peak) \(localize("widget.chargingSessionDetail.unitKw", "kW"))",
            "\(localize("widget.chargingSessionDetail.charger", "Charger")): "
                + summary.charger.localizedLabel(localize)
        ]
        return parts.joined(separator: ". ")
    }
}
