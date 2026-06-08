//
//  BatteryPill.Model.swift
//  TeslaSync — P4 feature view · 0073 · BatteryPill (Apple)
//
//  The pure, host-free projection of a `BatteryPill`'s inputs into the structural
//  decisions the view renders — the native parity of the web component's three
//  branches:
//
//    • the `STATUS_COLORS` threshold ladder
//      (`level >= 60 ? good : level >= 30 ? warning : critical`),
//    • the `fmtInt(level)%` value (web `fmtInt` → `safeNumber`, so a non-finite
//      `level` formats as `0`, never "NaN"),
//    • the meter fill width (`Math.min(level, 100)`, with CSS clamping a
//      negative width to `0`).
//
//  Keeping these decisions in `Equatable` value types lets the XCTest suite cover
//  every configuration (and the accessibility policy) without a snapshot host —
//  the same approach the sibling presentational surfaces use.
//

import SwiftUI

// MARK: - Surface identity

/// Stable, non-identifying identity for the `BatteryPill` feature view. The slug
/// is the value emitted with the P1/S11 `view.opened` diagnostics contract and is
/// referenced by both the view and its tests so the two never drift.
public enum BatteryPillSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "BatteryPill"

    /// Reports the surface becoming visible. This is the exact code path the
    /// view runs from its `.task`, factored out so it is unit-testable without a
    /// rendering host.
    public static func reportOpen(to telemetry: any BatteryPillTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Tint (web STATUS_COLORS threshold ladder)

/// The traffic-light accent for a `BatteryPill`, mirroring the web component's
/// `level >= 60 ? STATUS_COLORS.good : level >= 30 ? STATUS_COLORS.warning :
/// STATUS_COLORS.critical` ladder.
///
/// Each case resolves to a generated design token (`Color.TS.status*`) whose dark
/// value is the exact web hex (`good #10b981`, `warning #f59e0b`, `critical
/// #ef4444`) while staying theme- and high-contrast-aware — so "green = good"
/// holds across light, dark, and increased-contrast appearances.
public enum BatteryPillTint: String, CaseIterable, Sendable {
    case good
    case warning
    case critical

    /// `level >= 60` ⇒ good (web `STATUS_COLORS.good`).
    public static let goodThreshold: Double = 60
    /// `level >= 30` ⇒ warning (web `STATUS_COLORS.warning`).
    public static let warningThreshold: Double = 30

    /// Resolves the tint from a charge level, reproducing the web ternary exactly.
    ///
    /// A non-finite or negative `level` fails both `>=` comparisons (just as in
    /// JavaScript, where `NaN >= n` is always `false`) and therefore resolves to
    /// ``critical`` — parity with the web `else` branch.
    public init(level: Double) {
        if level >= Self.goodThreshold {
            self = .good
        } else if level >= Self.warningThreshold {
            self = .warning
        } else {
            self = .critical
        }
    }

    /// The accent color (web `STATUS_COLORS[...]`), sourced from the generated
    /// status tokens so the hue matches the web hex in dark mode and adapts in
    /// light / increased-contrast appearances.
    public var color: Color {
        switch self {
        case .good: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }

    /// VoiceOver descriptor key (table `BatteryPill`). Color alone is not an
    /// accessible signal, so the resolved tint is also spoken as a word.
    public var accessibilityStatusKey: LocalizedStringKey {
        switch self {
        case .good: "battery.pill.status.good"
        case .warning: "battery.pill.status.warning"
        case .critical: "battery.pill.status.critical"
        }
    }
}

// MARK: - Number formatting (web `fmtInt` / `safeNumber` parity)

/// The native parity of the web `fmtInt` used for the pill's value.
///
/// `fmtInt(v)` is `safeNumber(v).toLocaleString(locale, { fractionDigits: 0 })`:
/// a non-finite input is coerced to `0` (never "NaN"/"Inf"), the result is
/// grouped for the active locale, and rounding is half-up (matching the
/// `Intl.NumberFormat` default of `halfExpand`).
public enum BatteryPillNumber {
    /// Formats `value` as a grouped integer, coercing non-finite input to `0`.
    public static func fmtInt(_ value: Double, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }
}

// MARK: - Presentation (pure projection of the inputs → render config)

/// The pure, `Equatable` projection of a `BatteryPill`'s `level` into the render
/// decisions: the resolved tint, the clamped meter fill, and the formatted value.
public struct BatteryPillPresentation: Equatable, Sendable {
    /// The raw `level` prop (kept so the value text reproduces `fmtInt(level)`).
    public let rawLevel: Double
    /// The resolved traffic-light tint.
    public let tint: BatteryPillTint
    /// The meter fill as a `0...1` fraction — web `Math.min(level, 100)` with a
    /// negative (or non-finite) width clamped to `0`, divided by 100.
    public let fillFraction: Double

    public init(level: Double) {
        rawLevel = level
        tint = BatteryPillTint(level: level)
        if level.isFinite {
            fillFraction = Swift.min(Swift.max(level, 0), 100) / 100
        } else {
            fillFraction = 0
        }
    }

    /// The numeric value used for the percent text and VoiceOver — web
    /// `safeNumber(level)` (non-finite ⇒ `0`).
    public var displayLevel: Double {
        rawLevel.isFinite ? rawLevel : 0
    }

    /// The grouped-integer percent magnitude (web `fmtInt(level)`), without the
    /// trailing percent sign.
    public func percentText(locale: Locale = .current) -> String {
        BatteryPillNumber.fmtInt(rawLevel, locale: locale)
    }

    /// The decorative battery glyph. The web renders a single static Lucide
    /// `Battery` outline tinted by status; the native analogue is the always-
    /// present `battery.100` SF Symbol, tinted by ``tint`` — the level itself is
    /// carried by the meter, exactly as on the web.
    public var iconSystemName: String {
        "battery.100"
    }

    /// The diagnostics slug this presentation belongs to.
    public var surfaceSlug: String {
        BatteryPillSurface.slug
    }
}
