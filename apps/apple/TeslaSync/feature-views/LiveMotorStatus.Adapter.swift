//
//  LiveMotorStatus.Adapter.swift
//  TeslaSync — P4 feature view · 0170 · LiveMotorStatus (Apple)
//
//  The testable projection core: a cached `MotorSnapshotInput` + `LiveMotorUnitPrefs` → the
//  three view-ready radial-gauge tiles (Torque / Front RPM / Motor temperature) plus the shift
//  state badge, reproducing the web source's numeric pipeline VERBATIM so the native surface
//  shows the exact same values as
//  features/driving/components/driving-dynamics/LiveMotorStatus.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the conversion + formatting + projection +
//  accessibility compile and run on a plain host and are pinned by unit tests. `MotorAccent`
//  carries only the web colour identity (blue/purple/amber); the design-token mapping lives in
//  LiveMotorStatus.Views.swift.
//

import Foundation

// MARK: - Temperature conversion (ported 1:1 from web lib/unitConversion.ts)

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)` in
/// `lib/unitConversion.ts` (the function behind the web `toTemperatureDisplay` prop): Celsius
/// passes through; Fahrenheit is `c * 9 / 5 + 32`. The backend `motor_temp_c_*` values arrive
/// in degrees Celsius (the SI floor the Phase-42 pipeline stores), exactly the input the web
/// converter expects.
func convertLiveMotorTempFromSI(_ celsius: Double, to unit: LiveMotorTemperatureUnit) -> Double {
    switch unit {
    case .celsius:
        celsius
    case .fahrenheit:
        celsius * 9 / 5 + 32
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half away from
/// zero to match `Intl.NumberFormat`'s default `halfExpand`.
public enum LiveMotorFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }
}

// MARK: - Accent (web `RadialGauge color`) — token mapping lives in the view layer

/// The colour identity the web `RadialGauge` carries for a gauge's progress arc — torque blue
/// (`#3b82f6`), RPM purple (`#a855f7`), and motor-temperature amber (`#f59e0b`). Kept as a pure
/// value here so the projection stays SwiftUI-free; the SwiftUI token mapping is in
/// `LiveMotorStatus.Views.swift`.
public enum MotorAccent: String, Sendable, Equatable {
    case torqueBlue
    case rpmPurple
    case tempAmber
}

// MARK: - Projected gauge tile (web `RadialGauge` + its caption span)

/// One projected radial gauge: a localized label, the formatted ring-centre value + optional
/// unit suffix, the 0...1 ring fill fraction (`clamped / max`), the accent for its progress arc,
/// and the caption span the web renders beneath the gauge. Mirrors one web `<RadialGauge value
/// max label unit color>` plus its sibling `<span>` caption.
public struct MotorGaugeTile: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let centerValue: String
    public let unit: String?
    public let caption: String
    public let fraction: Double
    public let accent: MotorAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        centerValue: String,
        unit: String?,
        caption: String,
        fraction: Double,
        accent: MotorAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.centerValue = centerValue
        self.unit = unit
        self.caption = caption
        self.fraction = fraction
        self.accent = accent
    }

    /// The resolved (localized) label for display + accessibility (P1/S10 facade).
    public var label: String {
        LiveMotorStatusStrings.string(labelKey, labelFallback)
    }

    /// The descriptive value spoken for VoiceOver — the web caption span (e.g. "123.00 Nm",
    /// "5,000 RPM", "21.5 °C", or "Awaiting data" when the reading is absent).
    public var spokenValue: String {
        caption
    }
}

// MARK: - Projected shift badge (web `Badge` with the Cog glyph)

/// The shift-state badge the web renders as `<Badge variant={shift === 'D' ? 'success' :
/// 'neutral'}><Cog/> {shift ?? 'Unknown'}</Badge>` over a "Shift State" caption. `state` is the
/// raw gear letter (`nil` when absent); `isDrive` drives the success/neutral tone.
public struct MotorShiftBadge: Equatable, Sendable {
    public let state: String?

    public init(state: String?) {
        self.state = state
    }

    /// Web `motorLatest.shift_state === 'D'` → the success tone, anything else → neutral.
    public var isDrive: Bool {
        state == "D"
    }

    /// Web `motorLatest.shift_state ?? t('dynamics.unknown', 'Unknown')` — the gear letter or the
    /// localized fallback.
    public var displayText: String {
        if let state, !state.isEmpty {
            return state
        }
        return LiveMotorStatusStrings.string("dynamics.unknown", "Unknown")
    }

    /// The localized "Shift State" caption shown beneath the badge.
    public var label: String {
        LiveMotorStatusStrings.string("dynamics.shiftState", "Shift State")
    }
}

// MARK: - Projection

/// The fully-projected surface content: the three radial gauges (web render order — Torque,
/// Front RPM, Motor temperature) plus the shift-state badge that closes the row.
public struct LiveMotorProjection: Equatable, Sendable {
    public let gauges: [MotorGaugeTile]
    public let shift: MotorShiftBadge

    public init(gauges: [MotorGaugeTile], shift: MotorShiftBadge) {
        self.gauges = gauges
        self.shift = shift
    }
}

/// Pure projector: `MotorSnapshotInput` + `LiveMotorUnitPrefs` → `LiveMotorProjection`. Every
/// value is computed with the exact same arithmetic + formatting as the web component so the web
/// and native surfaces show identical numbers side by side.
public enum LiveMotorProjector {
    /// Projects a live snapshot into the three gauge tiles + shift badge.
    public static func project(motor: MotorSnapshotInput, units: LiveMotorUnitPrefs) -> LiveMotorProjection {
        let context = Context(motor: motor, units: units)
        return LiveMotorProjection(gauges: context.gauges(), shift: MotorShiftBadge(state: motor.shiftState))
    }

    /// Pure per-projection context bundling the inputs so the gauge math stays short while keeping
    /// every value byte-for-byte identical to the web source.
    private struct Context {
        let motor: MotorSnapshotInput
        let units: LiveMotorUnitPrefs

        private var locale: String {
            units.localeIdentifier
        }

        /// Web `torqueTotal = (torque_nm_front ?? 0) + (torque_nm_rear ?? 0)`.
        private var torqueTotal: Double {
            (motor.torqueFrontNm ?? 0) + (motor.torqueRearNm ?? 0)
        }

        /// Web `rpmFront = motorLatest?.motor_rpm_front ?? 0`.
        private var rpmFront: Double {
            motor.rpmFront ?? 0
        }

        /// Web `motorTempC = max(motor_temp_c_front ?? -Infinity, motor_temp_c_rear ?? -Infinity)`,
        /// then `isFinite(motorTempC) ? motorTempC : null` — `nil` when neither axle reports.
        private var motorTempC: Double? {
            let maxTemp = max(motor.motorTempCFront ?? -.infinity, motor.motorTempCRear ?? -.infinity)
            return maxTemp.isFinite ? maxTemp : nil
        }

        /// Web `motorTempDisplay = motorTempC != null && isFinite ? toTemperatureDisplay(motorTempC) : 0`.
        private var motorTempDisplay: Double {
            guard let motorTempC else { return 0 }
            return convertLiveMotorTempFromSI(motorTempC, to: units.temperature)
        }

        /// The three radial gauges in the web's render order (Torque, Front RPM, Motor).
        func gauges() -> [MotorGaugeTile] {
            [torqueSpec(), rpmSpec(), motorTempSpec()].map(gauge)
        }

        /// Torque gauge spec — web `<RadialGauge value={torqueTotal} max={1000} unit="Nm"
        /// color="#3b82f6">` with the caption `${fmtNumber(torqueTotal)} Nm` (default precision).
        private func torqueSpec() -> GaugeSpec {
            let caption = LiveMotorFormat.number(torqueTotal, decimals: units.precision, localeIdentifier: locale)
            return GaugeSpec(
                id: "torque",
                labelKey: "dynamics.torque",
                labelFallback: "Torque",
                value: torqueTotal,
                maxValue: 1000,
                unit: "Nm",
                accent: .torqueBlue,
                caption: "\(caption) Nm"
            )
        }

        /// Front-RPM gauge spec — web `<RadialGauge value={rpmFront} max={18000} unit="RPM"
        /// color="#a855f7">` with the caption `${fmtNumber(rpmFront, 0)} RPM` (no decimals).
        private func rpmSpec() -> GaugeSpec {
            let caption = LiveMotorFormat.number(rpmFront, decimals: 0, localeIdentifier: locale)
            return GaugeSpec(
                id: "rpm-front",
                labelKey: "dynamics.rpmFront",
                labelFallback: "Front RPM",
                value: rpmFront,
                maxValue: 18000,
                unit: "RPM",
                accent: .rpmPurple,
                caption: "\(caption) RPM"
            )
        }

        /// Motor-temperature gauge spec — web `<RadialGauge value={motorTempDisplay} max={200}
        /// unit={tempUnit} color="#f59e0b">`. The caption is the converted reading at one decimal
        /// (`${fmtNumber(toTemperatureDisplay(motorTempC), 1)}${tempUnit}`) or the localized
        /// "Awaiting data" when neither axle reports, exactly as the web ternary renders.
        private func motorTempSpec() -> GaugeSpec {
            let symbol = units.temperature.symbol
            let caption: String = if motorTempC != nil {
                "\(LiveMotorFormat.number(motorTempDisplay, decimals: 1, localeIdentifier: locale))\(symbol)"
            } else {
                LiveMotorStatusStrings.string("dynamics.awaiting", "Awaiting data")
            }
            return GaugeSpec(
                id: "motor-temp",
                labelKey: "dynamics.motorTemp",
                labelFallback: "Motor",
                value: motorTempDisplay,
                maxValue: 200,
                unit: symbol,
                accent: .tempAmber,
                caption: caption
            )
        }

        /// Builds one gauge the way the web `RadialGauge` renders: `clamped = max(0, min(value,
        /// max))`, the ring centre reads `fmtNumber(clamped, d)` where `d = isInteger(clamped) ? 0
        /// : globalPrecision`, the unit suffixes the centre, and the arc fills `clamped / max`.
        private func gauge(_ spec: GaugeSpec) -> MotorGaugeTile {
            let safeValue = LiveMotorFormat.safeNumber(spec.value)
            let safeMax = LiveMotorFormat.safeNumber(spec.maxValue)
            let clamped = min(max(safeValue, 0), safeMax)
            let decimals = clamped == clamped.rounded(.towardZero) ? 0 : units.precision
            return MotorGaugeTile(
                id: spec.id,
                labelKey: spec.labelKey,
                labelFallback: spec.labelFallback,
                centerValue: LiveMotorFormat.number(clamped, decimals: decimals, localeIdentifier: locale),
                unit: spec.unit,
                caption: spec.caption,
                fraction: safeMax <= 0 ? 0 : clamped / safeMax,
                accent: spec.accent
            )
        }
    }

    /// The inputs for one web `<RadialGauge value max unit color>` plus its caption span, before
    /// clamping/formatting — bundled so the gauge builder stays within the parameter budget while
    /// every value remains byte-for-byte identical to the web source.
    private struct GaugeSpec {
        let id: String
        let labelKey: String
        let labelFallback: String
        let value: Double
        let maxValue: Double
        let unit: String
        let accent: MotorAccent
        let caption: String
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the gauge grid. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum LiveMotorAccessibility {
    /// One spoken phrase per gauge plus the shift badge, e.g.
    /// "Torque 123.00 Nm. Front RPM 5,000 RPM. Motor 21.5 °C. Shift State D".
    public static func summary(for projection: LiveMotorProjection) -> String {
        let gaugePhrases = projection.gauges.map { "\($0.label) \($0.spokenValue)" }
        let shiftPhrase = "\(projection.shift.label) \(projection.shift.displayText)"
        return (gaugePhrases + [shiftPhrase]).joined(separator: ". ")
    }
}
