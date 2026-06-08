//
//  EnvironmentSlide.Adapter.swift
//  TeslaSync — P4 feature view · 0063 · EnvironmentSlide (Apple)
//
//  Pure (Foundation-only) projection: cached `EnvironmentReviewDTO` + locale → the display values the
//  slide renders, reproducing the web source's arithmetic VERBATIM so the native surface shows the
//  exact same figures as features/analytics/components/review/EnvironmentSlide.tsx:
//
//      treesPlanted = Math.round(co2_offset_kg / 21)
//      treeIcons    = Array.from({ length: Math.min(treesPlanted, 30) })
//      overflow     = treesPlanted > 30 ? `+${treesPlanted - 30} more` : —
//      co2 figure   = <AnimatedNumber value={co2_offset_kg} decimals={0} suffix=" kg" />
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Constants (ported from the web source)

private enum EnvironmentSlideConstants {
    /// Kilograms of CO₂ a single tree offsets per year — the web source's `/ 21` divisor used to turn
    /// the recap's CO₂ offset into a "trees planted" equivalent.
    static let kgCO2PerTree = 21.0

    /// The web slide caps the rendered tree glyphs at 30 and shows a "+N more" chip for the remainder
    /// (`Math.min(treesPlanted, 30)`), so a huge recap does not paint thousands of emoji.
    static let maxTreeIcons = 30
}

/// JavaScript `Math.round` parity: round half toward +∞ (`floor(x + 0.5)`), so 2.5 → 3 and -2.5 → -2.
/// Differs from Swift's `.toNearestOrAwayFromZero` only for negatives; CO₂ offset is non-negative in
/// practice, but we port the exact semantics so the equivalence holds for every input.
private func jsRound(_ value: Double) -> Double {
    (value + 0.5).rounded(.down)
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber` / `fmtInt`
/// (`Number.toLocaleString`).
public enum EnvironmentSlideFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from zero
    /// to match `Number.toLocaleString`'s default `halfExpand`.
    public static func number(
        _ value: Double,
        decimals: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
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

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        number(Double(value), decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Projection

/// The fully-projected slide content: the headline CO₂ figure (raw + formatted + unit), the
/// trees-planted equivalent, and the capped glyph count with its overflow remainder. Computed once
/// per snapshot by the model.
public struct EnvironmentSlideProjection: Equatable {
    /// The raw CO₂ offset in kilograms — the count-up target for the animated headline (web
    /// `AnimatedNumber value`).
    public let co2OffsetKg: Double
    /// The grouped, zero-decimal CO₂ figure (web `fmtNumber(co2, 0)`), e.g. "1,840".
    public let co2Value: String
    /// The localized unit shown after the figure (web literal " kg").
    public let co2Unit: String
    /// The trees-planted equivalent (web `Math.round(co2 / 21)`), used for the caption.
    public let treesPlanted: Int
    /// The number of tree glyphs actually rendered (web `Math.min(treesPlanted, 30)`, floored at 0).
    public let treeIconCount: Int
    /// The remainder past the 30-glyph cap (web `treesPlanted - 30`), 0 when there is no overflow.
    public let overflow: Int

    public init(
        co2OffsetKg: Double,
        co2Value: String,
        co2Unit: String,
        treesPlanted: Int,
        treeIconCount: Int,
        overflow: Int
    ) {
        self.co2OffsetKg = co2OffsetKg
        self.co2Value = co2Value
        self.co2Unit = co2Unit
        self.treesPlanted = treesPlanted
        self.treeIconCount = treeIconCount
        self.overflow = overflow
    }

    /// Whether the "+N more" overflow chip should render (web `treesPlanted > 30`).
    public var hasOverflow: Bool {
        overflow > 0
    }

    /// The trailing suffix appended to the animated figure (web `suffix=" kg"`).
    public var co2Suffix: String {
        " \(co2Unit)"
    }
}

/// Pure projector: `EnvironmentReviewDTO` + locale → `EnvironmentSlideProjection`. Every value is
/// computed with the exact same arithmetic + formatting as the web slide.
public enum EnvironmentSlideProjector {
    public static func project(
        stats: EnvironmentReviewDTO,
        localeIdentifier: String = "en_US"
    ) -> EnvironmentSlideProjection {
        let co2 = EnvironmentSlideFormat.safeNumber(stats.co2OffsetKg)

        // treesPlanted = Math.round(co2_offset_kg / 21)
        let treesPlanted = Int(jsRound(co2 / EnvironmentSlideConstants.kgCO2PerTree))

        // treeIcons length = Math.min(treesPlanted, 30); a negative/NaN-derived count paints nothing
        // (Array.from coerces a non-positive length to 0).
        let cap = EnvironmentSlideConstants.maxTreeIcons
        let treeIconCount = max(0, min(treesPlanted, cap))

        // overflow chip = treesPlanted > 30 ? treesPlanted - 30 : —
        let overflow = treesPlanted > cap ? treesPlanted - cap : 0

        return EnvironmentSlideProjection(
            co2OffsetKg: co2,
            co2Value: EnvironmentSlideFormat.number(co2, decimals: 0, localeIdentifier: localeIdentifier),
            co2Unit: EnvironmentSlideStrings.string("environment.co2Unit", "kg"),
            treesPlanted: treesPlanted,
            treeIconCount: treeIconCount,
            overflow: overflow
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the slide. Pure + public so the a11y label content can be
/// unit-tested without rendering the view.
public enum EnvironmentSlideAccessibility {
    /// One spoken sentence: the offset label, the figure with its unit, then the trees-planted
    /// equivalent — e.g. "CO₂ offset, 1,840 kg. Like planting 88 trees."
    public static func summary(for projection: EnvironmentSlideProjection) -> String {
        let label = EnvironmentSlideStrings.string("yearReview.co2Offset", "CO₂ offset")
        let trees = EnvironmentSlideStrings.trees(projection.treesPlanted)
        return "\(label), \(projection.co2Value) \(projection.co2Unit). \(trees)"
    }
}
