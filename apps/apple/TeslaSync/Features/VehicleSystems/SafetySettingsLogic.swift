//
//  SafetySettingsLogic.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple) — Derived logic
//
//  The pure, unit-testable logic peers of the web page's module-scope functions
//  and `lib/safetyEnum.ts`: the nine ADAS feature descriptors (`SafetyFeatureKind`,
//  web `buildFeatureCards`), the safety-state chart series, the enum normalisation
//  choke point (`AdasEnum.clean` / `.isActive`), the SI distance converter
//  (`SafetyConvert`, web `convertDistanceFromSI`, P1/S5) and the display formatters
//  (`SafetyFormat`, web `fmtNumber` / `fmtInt` / `formatDateTime`). No display-unit
//  branching leaks into storage — distances live as meters until the boundary.
//

import Foundation
import SwiftUI

// MARK: - ADAS feature card (web FeatureCardDef)

/// One ADAS feature card view input (web `FeatureCardDef`): label, plain-English
/// description, enabled flag and the rendered value text.
struct SafetyFeatureCard: Identifiable, Equatable, Sendable {
    let key: String
    let label: String
    let detail: String
    let enabled: Bool
    let valueText: String

    var id: String { key }
}

// MARK: - ADAS feature descriptors (web buildFeatureCards order)

/// The nine ADAS features, in the exact web `buildFeatureCards` order. Each case
/// owns its localized label/detail and the on/value derivation, so the model maps
/// `SafetyFeatureKind.allCases` into cards in a single expression.
enum SafetyFeatureKind: String, CaseIterable, Identifiable, Equatable, Sendable {
    case aeb
    case bsc
    case fcw
    case lda
    case cfd
    case slw
    case ptd
    case bscw
    case elda

    var id: String { rawValue }

    /// The card title (web `t('Auto Emergency Braking')` etc.).
    var label: String {
        switch self {
        case .aeb: return safetyText("Auto Emergency Braking")
        case .bsc: return safetyText("Blind Spot Camera")
        case .fcw: return safetyText("Forward Collision Warning")
        case .lda: return safetyText("Lane Departure Avoidance")
        case .cfd: return safetyText("Cruise Follow Distance")
        case .slw: return safetyText("Speed Limit Warning")
        case .ptd: return safetyText("Pin to Drive")
        case .bscw: return safetyText("Blind Spot Collision Warning")
        case .elda: return safetyText("Emergency Lane Departure Avoidance")
        }
    }

    /// The card description (web `t('Automatic collision mitigation')` etc.).
    var detail: String {
        switch self {
        case .aeb: return safetyText("Automatic collision mitigation")
        case .bsc: return safetyText("Camera view when signaling")
        case .fcw: return safetyText("Warns of potential frontal collisions")
        case .lda: return safetyText("Prevents unintentional lane changes")
        case .cfd: return safetyText("Adaptive cruise headway setting")
        case .slw: return safetyText("Alerts when exceeding speed limit")
        case .ptd: return safetyText("Requires PIN before driving")
        case .bscw: return safetyText("Alerts for blind-spot hazards")
        case .elda: return safetyText("Steers back on unintentional departure")
        }
    }

    /// Whether the feature is enabled for the snapshot (web `enabled`).
    func isEnabled(_ snapshot: SafetySnapshot) -> Bool {
        switch self {
        case .aeb: return AdasEnum.isAebEnabled(snapshot.automaticEmergencyBrakingOff ?? false)
        case .bsc: return snapshot.automaticBlindSpotCamera ?? false
        case .fcw: return AdasEnum.isActive(snapshot.forwardCollisionWarning, field: .forwardCollisionWarning)
        case .lda: return AdasEnum.isActive(snapshot.laneDepartureAvoidance, field: .laneDepartureAvoidance)
        case .cfd: return AdasEnum.isActive(snapshot.cruiseFollowDistance, field: .cruiseFollowDistance)
        case .slw: return AdasEnum.isActive(snapshot.speedLimitWarning, field: .speedLimitWarning)
        case .ptd: return snapshot.pinToDriveEnabled ?? false
        case .bscw: return snapshot.blindSpotCollisionWarning ?? false
        case .elda: return snapshot.emergencyLaneDepartureAvoidance ?? false
        }
    }

    /// The value text (web `valueText`): "Enabled"/"Disabled" for the boolean
    /// features, the prefix-stripped level for the four enum features.
    func valueText(_ snapshot: SafetySnapshot) -> String {
        switch self {
        case .fcw: return AdasEnum.clean(snapshot.forwardCollisionWarning, field: .forwardCollisionWarning)
        case .lda: return AdasEnum.clean(snapshot.laneDepartureAvoidance, field: .laneDepartureAvoidance)
        case .cfd: return AdasEnum.clean(snapshot.cruiseFollowDistance, field: .cruiseFollowDistance)
        case .slw: return AdasEnum.clean(snapshot.speedLimitWarning, field: .speedLimitWarning)
        default: return isEnabled(snapshot) ? safetyText("Enabled") : safetyText("Disabled")
        }
    }

    /// Build the full card for a snapshot.
    func card(for snapshot: SafetySnapshot) -> SafetyFeatureCard {
        SafetyFeatureCard(
            key: rawValue,
            label: label,
            detail: detail,
            enabled: isEnabled(snapshot),
            valueText: valueText(snapshot)
        )
    }
}

// MARK: - Chart series (web three `Line` dataKeys)

/// The three step-line series charted over time (web AEB / BSCW / ELDA lines).
enum SafetyChartSeries: String, CaseIterable, Identifiable, Equatable, Sendable {
    case aeb
    case bscw
    case elda

    var id: String { rawValue }

    /// The legend label (web `name={t('AEB')}` etc.) — reuses the table headers.
    var label: String {
        switch self {
        case .aeb: return safetyText("AEB")
        case .bscw: return safetyText("BSCW")
        case .elda: return safetyText("ELDA")
        }
    }

    /// Series color (web CHART_COLORS[0..2]).
    var color: Color {
        let palette = Color.TS.chartCategorical
        switch self {
        case .aeb: return palette.indices.contains(0) ? palette[0] : Color.TS.accent
        case .bscw: return palette.indices.contains(1) ? palette[1] : Color.TS.statusWarning
        case .elda: return palette.indices.contains(2) ? palette[2] : Color.TS.statusSuccess
        }
    }
}

// MARK: - Chart point (web ChartPoint)

/// One charted instant for the safety-states line chart (web `ChartPoint`):
/// the three boolean ADAS series collapsed to 0/1, plus the timestamp.
struct SafetyChartPoint: Identifiable, Equatable, Sendable {
    let id: Int64
    let time: Date
    let aeb: Double
    let bscw: Double
    let elda: Double

    /// Series identity → value, mirroring the web three `Line` `dataKey`s.
    func value(for series: SafetyChartSeries) -> Double {
        switch series {
        case .aeb: return aeb
        case .bscw: return bscw
        case .elda: return elda
        }
    }
}

// MARK: - Safety-enum + score helpers (web lib/safetyEnum.ts + module scope)

/// Safety-enum normalisation + score helpers. Pure and unit-testable; the single
/// choke point so a disabled-by-bool feature is never mis-classified as on.
enum AdasEnum {
    /// The fixed ADAS feature count (web `TOTAL_FEATURES`).
    static let totalFeatures = 9

    /// AEB uses inverted logic: `off == false` means the feature IS enabled
    /// (web `isAebEnabled`).
    static func isAebEnabled(_ off: Bool) -> Bool {
        !off
    }

    /// Convert a raw safety-enum value into a human-renderable, prefix-stripped
    /// string (web `cleanSafetyEnum`).
    static func clean(_ value: AdasEnumValue, field: AdasEnumField, fallback: String = "—") -> String {
        switch value {
        case let .boolean(flag):
            return flag ? safetyText("On") : safetyText("Off")
        case let .number(num):
            return numberString(num)
        case let .text(raw):
            return cleanString(raw, field: field, fallback: fallback)
        case .absent:
            return fallback
        }
    }

    /// Whether a safety-enum value represents an ENABLED feature (web
    /// `isSafetyEnumActive`).
    static func isActive(_ value: AdasEnumValue, field: AdasEnumField) -> Bool {
        switch value {
        case .absent:
            return false
        case let .boolean(flag):
            return flag
        case .number, .text:
            let cleaned = clean(value, field: field, fallback: "")
            if cleaned.isEmpty { return false }
            let lower = cleaned.lowercased()
            if lower == "off" || lower == "none" || lower == "disabled" || lower == "0" { return false }
            return true
        }
    }

    /// The nine boolean ADAS feature states (web `boolFeatures`), in web order.
    static func boolFeatures(_ snapshot: SafetySnapshot) -> [Bool] {
        SafetyFeatureKind.allCases.map { $0.isEnabled(snapshot) }
    }

    /// How many of the nine features are enabled (web `enabledCount`).
    static func enabledCount(_ snapshot: SafetySnapshot) -> Int {
        boolFeatures(snapshot).filter { $0 }.count
    }

    /// The 0–100 safety score (web `scorePct = enabled / TOTAL_FEATURES * 100`).
    static func scorePercent(enabled: Int) -> Double {
        guard totalFeatures > 0 else { return 0 }
        return Double(enabled) / Double(totalFeatures) * 100
    }

    /// The score tone (web `scoreColor`: ≥80 green, ≥50 amber, else red).
    static func scoreTone(percent: Double) -> SafetyTone {
        if percent >= 80 { return .success }
        if percent >= 50 { return .warning }
        return .danger
    }

    /// JS `String(num)` parity: integral values drop the decimal point.
    private static func numberString(_ num: Double) -> String {
        guard num.isFinite else { return "—" }
        if num == num.rounded() && abs(num) < 1e15 {
            return String(Int(num))
        }
        return String(num)
    }

    /// Web `cleanSafetyEnum` string branch: strip the Tesla prefix; the
    /// `speed_limit_warning` `None` suffix maps to "Off".
    private static func cleanString(_ raw: String, field: AdasEnumField, fallback: String) -> String {
        guard !raw.isEmpty else { return fallback }
        let prefix = field.prefix
        if !prefix.isEmpty, raw.hasPrefix(prefix) {
            let stripped = String(raw.dropFirst(prefix.count))
            if field == .speedLimitWarning, stripped == "None" {
                return safetyText("Off")
            }
            return stripped.isEmpty ? raw : stripped
        }
        return raw
    }
}

// MARK: - SI → display conversion (web convertDistanceFromSI, P1/S5)

/// Pure SI → display-unit distance conversion. Mirrors
/// `web/src/lib/unitConversion.ts` `convertDistanceFromSI` exactly: the input is
/// meters (SI on disk), divided by the unit's meters-per constant at the boundary.
enum SafetyConvert {
    /// 1 mile = 1609.344 m (NIST SP 811).
    private static let metersPerMile: Double = 1609.344
    /// 1 km = 1000 m.
    private static let metersPerKilometer: Double = 1000
    /// 1 ft = 0.3048 m (international foot).
    private static let metersPerFoot: Double = 0.3048

    /// Convert meters (on-disk SI) to the display distance unit.
    static func distanceFromSI(_ meters: Double, to unit: SafetyDistanceUnit) -> Double {
        switch unit {
        case .km: return meters / metersPerKilometer
        case .mi: return meters / metersPerMile
        case .ft: return meters / metersPerFoot
        }
    }
}

// MARK: - Display formatting (web fmtNumber / fmtInt / formatDateTime)

/// Locale-aware number + date formatting at the display boundary (web
/// `fmtNumber` / `fmtInt` / `formatDateTime`). Kept tiny and dependency-free.
enum SafetyFormat {
    /// Web `fmtNumber(value)` — grouped decimal with one fraction digit.
    static func number(_ value: Double, fractionDigits: Int = 1) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// Web `fmtInt(value)` — grouped integer, no fraction digits.
    static func int(_ value: Double) -> String {
        number(value, fractionDigits: 0)
    }

    /// Web `formatDateTime` — abbreviated date + short time, locale-aware.
    static func dateTime(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// The self-driving subtitle (web `t('safety.distanceAutopilot', { unit })` →
    /// catalog value `"%1$@ (autopilot)"`).
    static func autopilotSubtitle(unit: SafetyDistanceUnit) -> String {
        String(format: safetyKey("safety.distanceAutopilot", "%1$@ (autopilot)"), unit.label)
    }
}
