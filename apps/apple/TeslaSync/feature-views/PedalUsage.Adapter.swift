//
//  PedalUsage.Adapter.swift
//  TeslaSync — P4 feature view · 0173 · PedalUsage (Apple)
//
//  The testable projection core: a cached `PedalSnapshotInput` + `PedalUnitPrefs` → the two
//  view-ready radial-gauge tiles (Throttle / Brake position) plus the brake-active status badge,
//  reproducing the web source's numeric pipeline VERBATIM so the native surface shows the exact same
//  values as features/driving/components/driving-dynamics/PedalUsage.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + projection + accessibility
//  compile and run on a plain host and are pinned by unit tests. `PedalAccent` carries only the web
//  colour identity (cyan / red); the design-token mapping lives in PedalUsage.Views.swift.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half away from zero
/// to match `Intl.NumberFormat`'s default `halfExpand`.
public enum PedalFormat {
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

/// The colour identity the web `RadialGauge` carries for a gauge's progress arc — throttle cyan
/// (`#06b6d4`) and brake red (`#ef4444`). Kept as a pure value here so the projection stays
/// SwiftUI-free; the SwiftUI token mapping is in `PedalUsage.Views.swift`.
public enum PedalAccent: String, Sendable, Equatable {
    case throttleCyan
    case brakeRed
}

// MARK: - Projected gauge tile (web `RadialGauge` + its caption span)

/// One projected radial gauge: a localized label (the web `RadialGauge label`), the formatted
/// ring-centre value + its unit suffix (`%` when a reading is present, the web `'—'` sentinel
/// when absent), the 0…1 ring fill fraction (`clamped / max`), the accent for its progress arc, and
/// the descriptive caption span the web renders beneath the gauge. Mirrors one web `<RadialGauge
/// value max label unit color>` plus its sibling `<span>` caption.
public struct PedalGaugeTile: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let captionKey: String
    public let captionFallback: String
    public let centerValue: String
    public let unit: String
    public let fraction: Double
    public let accent: PedalAccent
    public let hasReading: Bool

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        captionKey: String,
        captionFallback: String,
        centerValue: String,
        unit: String,
        fraction: Double,
        accent: PedalAccent,
        hasReading: Bool
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.captionKey = captionKey
        self.captionFallback = captionFallback
        self.centerValue = centerValue
        self.unit = unit
        self.fraction = fraction
        self.accent = accent
        self.hasReading = hasReading
    }

    /// The resolved (localized) gauge label (web `RadialGauge label`, e.g. "Throttle" / "Brake").
    public var label: String {
        PedalUsageStrings.string(labelKey, labelFallback)
    }

    /// The resolved (localized) descriptive caption beneath the gauge (web `<span>`, e.g.
    /// "Throttle Position" / "Brake Pedal Position").
    public var caption: String {
        PedalUsageStrings.string(captionKey, captionFallback)
    }

    /// The reading spoken for VoiceOver: the percentage when present (e.g. "42%"), otherwise the
    /// localized "no reading" phrase rather than the visual `'—'` sentinel.
    public var spokenValue: String {
        hasReading
            ? "\(centerValue)\(unit)"
            : PedalUsageStrings.string("dynamics.pedal.noReading", "No reading")
    }
}

// MARK: - Projected brake-active badge (web `Badge` with the Footprints glyph)

/// The brake-active status the web renders as `<Badge variant={brakeActive ? 'danger' : 'success'}>
/// {brakeActive ? 'Brake Active' : 'Brake Inactive'}</Badge>` over a "Brake Pedal Status" caption.
/// A `nil` `brake_pedal_active` reads as inactive exactly like the web falsy branch.
public struct PedalBrakeStatus: Equatable, Sendable {
    public let isActive: Bool

    public init(isActive: Bool) {
        self.isActive = isActive
    }

    /// Web `variant={brakeActive ? 'danger' : 'success'}` — danger while the pedal is depressed.
    public var isDanger: Bool {
        isActive
    }

    /// Web `brakeActive ? t('dynamics.brakeActive', 'Brake Active') : t('dynamics.brakeInactive',
    /// 'Brake Inactive')`.
    public var displayText: String {
        isActive
            ? PedalUsageStrings.string("dynamics.brakeActive", "Brake Active")
            : PedalUsageStrings.string("dynamics.brakeInactive", "Brake Inactive")
    }

    /// The localized "Brake Pedal Status" caption shown beneath the badge (web `<span>`).
    public var label: String {
        PedalUsageStrings.string("dynamics.brakePedal", "Brake Pedal Status")
    }
}

// MARK: - Projection

/// The fully-projected surface content: the two radial gauges (web render order — Throttle, Brake)
/// plus the brake-active status badge that closes the row.
public struct PedalProjection: Equatable, Sendable {
    public let gauges: [PedalGaugeTile]
    public let brake: PedalBrakeStatus

    public init(gauges: [PedalGaugeTile], brake: PedalBrakeStatus) {
        self.gauges = gauges
        self.brake = brake
    }
}

/// Pure projector: `PedalSnapshotInput` + `PedalUnitPrefs` → `PedalProjection`. Every value is
/// computed with the exact same arithmetic + formatting as the web component so the web and native
/// surfaces show identical numbers side by side.
public enum PedalProjector {
    /// Projects a live snapshot into the two gauge tiles (web render order — Throttle, Brake) + the
    /// brake-active badge.
    public static func project(pedal: PedalSnapshotInput, units: PedalUnitPrefs) -> PedalProjection {
        let specs = [
            GaugeSpec(
                id: "throttle",
                labelKey: "dynamics.throttle",
                labelFallback: "Throttle",
                captionKey: "dynamics.throttlePosition",
                captionFallback: "Throttle Position",
                reading: pedal.throttlePosition,
                accent: .throttleCyan
            ),
            GaugeSpec(
                id: "brake",
                labelKey: "dynamics.brake",
                labelFallback: "Brake",
                captionKey: "dynamics.brakePedalPosition",
                captionFallback: "Brake Pedal Position",
                reading: pedal.brakePedalPosition,
                accent: .brakeRed
            )
        ]
        let gauges = specs.map { gauge($0, units: units) }
        return PedalProjection(gauges: gauges, brake: PedalBrakeStatus(isActive: pedal.brakePedalActive == true))
    }

    /// Builds one gauge the way the web `RadialGauge` renders for a 0…100 pedal position: the value
    /// is `reading ?? 0`, `clamped = max(0, min(value, 100))`, the ring centre reads
    /// `fmtNumber(clamped, d)` where `d = isInteger(clamped) ? 0 : globalPrecision`, the unit suffixes
    /// the centre (`'%'` when a reading is present, the web `'—'` sentinel otherwise), and the arc
    /// fills `clamped / 100`.
    private static func gauge(_ spec: GaugeSpec, units: PedalUnitPrefs) -> PedalGaugeTile {
        let maxValue: Double = 100
        let hasReading = spec.reading != nil
        let safeValue = PedalFormat.safeNumber(spec.reading ?? 0)
        let clamped = min(max(safeValue, 0), maxValue)
        let decimals = clamped == clamped.rounded(.towardZero) ? 0 : units.precision
        return PedalGaugeTile(
            id: spec.id,
            labelKey: spec.labelKey,
            labelFallback: spec.labelFallback,
            captionKey: spec.captionKey,
            captionFallback: spec.captionFallback,
            centerValue: PedalFormat.number(clamped, decimals: decimals, localeIdentifier: units.localeIdentifier),
            unit: hasReading ? "%" : "—",
            fraction: clamped / maxValue,
            accent: spec.accent,
            hasReading: hasReading
        )
    }

    /// The inputs for one web `<RadialGauge value max label unit color>` plus its caption span, before
    /// clamping/formatting — bundled so the gauge builder stays within the parameter budget while
    /// every value remains byte-for-byte identical to the web source.
    private struct GaugeSpec {
        let id: String
        let labelKey: String
        let labelFallback: String
        let captionKey: String
        let captionFallback: String
        let reading: Double?
        let accent: PedalAccent
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the pedal grid. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum PedalAccessibility {
    /// One spoken phrase per gauge plus the brake badge, e.g.
    /// "Throttle 42%. Brake 0%. Brake Pedal Status Brake Inactive".
    public static func summary(for projection: PedalProjection) -> String {
        let gaugePhrases = projection.gauges.map { "\($0.label) \($0.spokenValue)" }
        let brakePhrase = "\(projection.brake.label) \(projection.brake.displayText)"
        return (gaugePhrases + [brakePhrase]).joined(separator: ". ")
    }
}
