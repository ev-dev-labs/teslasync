//
//  BatteryDelta.Projection.swift
//  TeslaSync — P4 shared surface · 0077 · BatteryDelta (Apple)
//
//  The pure projection from the component props to the view-ready model the SwiftUI body renders —
//  the native port of the web `BatteryDelta` render body. The web component collapses
//  `(startPct, endPct, variant)` into either the muted "—" branch (`!hasData`) or a sign-/tone-
//  decorated delta; this projection bakes the same decision into a ``BatteryDeltaProjection`` whose
//  `hasData` flag is the web `hasData` guard, whose `tone` is the web emerald / amber / muted rule,
//  whose `displayText` is the already-resolved compact / pair string, and whose `accessibilityFrom`
//  / `accessibilityTo` carry the formatted endpoints for the VoiceOver label. The view is a pure
//  function of this value; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``BatteryDeltaProjector/resolve(startPct:endPct:variant:)`` takes the cached SoC endpoints (what a
//  drive / charging row already holds) and derives the rendered delta — no networking, no clock.
//

import Foundation

// MARK: - BatteryDeltaProjection (web `BatteryDelta` render output)

/// The resolved, view-ready delta — the native bundle of everything the web `BatteryDelta` render
/// body decides. `hasData` is the web `hasData` guard; when it is `false` the surface shows the muted
/// "—" with the "Battery delta unknown" VoiceOver label (the faithful "empty"). When `true`,
/// `displayText` is the compact (`±N%` / `—`) or pair (`A% → B%`) string, `tone` colors the value,
/// and `accessibilityFrom` / `accessibilityTo` feed the "Battery {from}% to {to}%" label.
public struct BatteryDeltaProjection: Sendable, Equatable {
    /// Whether both SoC endpoints are present + finite (web `hasData`).
    public let hasData: Bool
    /// The requested variant, carried through for the view + tests (web `variant`).
    public let variant: BatteryDeltaVariant
    /// Emerald on a rise, amber on a drop, muted on zero / missing (web tone rule).
    public let tone: BatteryDeltaTone
    /// The visible string — compact "+60%" / "−1%" / "—", or pair "79% → 78%" (web `visible`).
    public let displayText: String
    /// `true` when `displayText` is the muted dash (compact, zero delta) — informative for tests.
    public let showsDash: Bool
    /// The formatted start percent for the VoiceOver label, or `nil` when no data (web aria `from`).
    public let accessibilityFrom: String?
    /// The formatted end percent for the VoiceOver label, or `nil` when no data (web aria `to`).
    public let accessibilityTo: String?

    public init(
        hasData: Bool,
        variant: BatteryDeltaVariant,
        tone: BatteryDeltaTone,
        displayText: String,
        showsDash: Bool,
        accessibilityFrom: String?,
        accessibilityTo: String?
    ) {
        self.hasData = hasData
        self.variant = variant
        self.tone = tone
        self.displayText = displayText
        self.showsDash = showsDash
        self.accessibilityFrom = accessibilityFrom
        self.accessibilityTo = accessibilityTo
    }
}

// MARK: - Projection (props → resolved)

/// Pure projection to the view-ready delta — the verbatim port of the web `BatteryDelta` render
/// body. Kept as a pure function over the caller-owned endpoints so every branch (no data, rise,
/// drop, zero, compact vs pair) is unit tested without an `@Observable` model or a view.
public enum BatteryDeltaProjector {
    /// Resolves the delta exactly like the web component:
    ///   • `!hasData` (either endpoint `nil` or non-finite) → the muted "—" with no a11y endpoints
    ///     (web `if (!hasData) return <span aria-label="Battery delta unknown">…—</span>`).
    ///   • otherwise `delta = endPct − startPct`, tone is emerald (`delta > 0`) / amber
    ///     (`delta < 0`) / muted (`delta == 0`), the compact label is "—" at zero else
    ///     `{+|−}{|delta|}%` (the drop sign is U+2212), the pair label is always `{start}% → {end}%`,
    ///     and `visible` selects between them by variant (web `variant === 'pair' ? pairLabel :
    ///     compactLabel`). The a11y endpoints carry the raw, JS-formatted `startPct` / `endPct`.
    public static func resolve(
        startPct: Double?,
        endPct: Double?,
        variant: BatteryDeltaVariant = .defaultVariant
    ) -> BatteryDeltaProjection {
        guard let start = startPct, let end = endPct, start.isFinite, end.isFinite else {
            return BatteryDeltaProjection(
                hasData: false,
                variant: variant,
                tone: .neutral,
                displayText: BatteryDeltaGlyph.dash,
                showsDash: true,
                accessibilityFrom: nil,
                accessibilityTo: nil
            )
        }

        let delta = end - start
        let tone: BatteryDeltaTone = delta > 0 ? .positive : (delta < 0 ? .negative : .neutral)

        let compactText: String
        if delta == 0 {
            compactText = BatteryDeltaGlyph.dash
        } else {
            let sign = delta > 0 ? BatteryDeltaGlyph.plusSign : BatteryDeltaGlyph.minusSign
            compactText = "\(sign)\(BatteryDeltaNumber.string(abs(delta)))\(BatteryDeltaGlyph.percent)"
        }

        let startText = BatteryDeltaNumber.string(start)
        let endText = BatteryDeltaNumber.string(end)
        let pairText = "\(startText)\(BatteryDeltaGlyph.percent) "
            + "\(BatteryDeltaGlyph.arrow) "
            + "\(endText)\(BatteryDeltaGlyph.percent)"

        return BatteryDeltaProjection(
            hasData: true,
            variant: variant,
            tone: tone,
            displayText: variant == .pair ? pairText : compactText,
            showsDash: variant != .pair && delta == 0,
            accessibilityFrom: startText,
            accessibilityTo: endText
        )
    }
}
