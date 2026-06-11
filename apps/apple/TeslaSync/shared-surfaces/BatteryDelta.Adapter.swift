//
//  BatteryDelta.Adapter.swift
//  TeslaSync — P4 shared surface · 0077 · BatteryDelta (Apple)
//
//  The testable, dependency-light core for the battery state-of-charge delta — the SwiftUI parity of
//  components/data-display/BatteryDelta.tsx. This file is the Foundation-only heart of the native
//  peer: the surface identity (the diagnostics slug), the props value type (``BatteryDeltaInputs``),
//  the display axes (``BatteryDeltaVariant`` / ``BatteryDeltaTone``), the literal glyph tokens, and
//  the JS-faithful number formatter. No SwiftUI, no `@Observable` — so every rule is unit testable in
//  isolation.
//
//  Faithful-parity note: the web `BatteryDelta` is a PURE presentational component. Its only data
//  source is `useTranslation` (the i18n facade) — there is no fetch, no React-Query cache, no
//  Promise. It maps `(startPct, endPct, variant, showIcon) → <span>` with exactly two render
//  branches: a muted "—" when either endpoint is missing / non-finite (`!hasData`), and a
//  sign-/tone-decorated delta otherwise. It therefore has NO loading, error, stale, or offline
//  branch — there is nothing to load, fail, go stale, or lose connectivity to. Inventing such chrome
//  would fabricate states the source does not have (and contradict the web spec), so this surface
//  reproduces only the source's REAL branches — exactly as the sibling presentational primitives
//  TimeMarker (0074) and ChartTimeRangeContext (0069) did. The two real branches are:
//    • no data  — `startPct`/`endPct` absent or non-finite → a muted "—" (the faithful "empty").
//    • populated — both present + finite → the delta (compact `±N%` / `—`, or pair `A% → B%`),
//                  emerald on a rise (charging), amber on a drop (driving), muted on zero.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is named `BatteryDelta`; this surface keeps the same slug here (SwiftUI-free) so
/// the state-holder can emit telemetry without depending on the view layer.
public enum BatteryDeltaSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "BatteryDelta"
}

// MARK: - BatteryDeltaVariant (web `variant: 'compact' | 'pair'`)

/// The display variant — the native peer of the web `variant` prop. `compact` (the web default)
/// shows just the change ("−1%", "+12%", "—"); `pair` shows both endpoints ("79% → 78%", the legacy
/// charging-card style).
public enum BatteryDeltaVariant: String, Sendable, Equatable, CaseIterable {
    /// Just the delta — "−1%", "+12%", "—" (web default).
    case compact
    /// Both endpoints — "79% → 78%".
    case pair

    /// The default the web component applies when no variant is supplied (`variant = 'compact'`).
    public static let defaultVariant: BatteryDeltaVariant = .compact
}

// MARK: - BatteryDeltaTone (web emerald / amber / muted)

/// The semantic tone driving the value color — the native peer of the web tone rules. A rise in SoC
/// (charging) renders ``positive`` (emerald), a drop (driving) renders ``negative`` (amber), and a
/// zero or missing delta renders ``neutral`` (muted). Mapped to theme-aware design tokens (P1/S9) in
/// BatteryDelta.Views.swift, so the value recolors across light / dark / high-contrast — an
/// improvement over the web source's fixed `text-emerald-300` / `text-amber-300`.
public enum BatteryDeltaTone: String, Sendable, Equatable, CaseIterable {
    /// SoC rose — charging (web `text-emerald-300`).
    case positive
    /// SoC dropped — driving (web `text-amber-300`).
    case negative
    /// Zero change or no data (web `text-[var(--text-muted)]`).
    case neutral
}

// MARK: - Glyph tokens (web string literals)

/// The literal glyphs the web component renders verbatim. Kept as named constants so the projection
/// and its tests share one source of truth — in particular the drop sign is the Unicode MINUS SIGN
/// (U+2212), exactly as the web `'−'` literal, NOT an ASCII hyphen.
public enum BatteryDeltaGlyph {
    /// The em dash shown for a zero or missing delta (web `dash = '—'`).
    public static let dash = "—"
    /// The arrow between endpoints in the `pair` variant (web `→`).
    public static let arrow = "→"
    /// The rise sign (web `'+'`).
    public static let plusSign = "+"
    /// The drop sign — Unicode MINUS SIGN U+2212, matching the web `'−'` literal exactly.
    public static let minusSign = "\u{2212}"
    /// The percent unit suffix (web literal `%`).
    public static let percent = "%"
}

// MARK: - BatteryDeltaInputs (web props)

/// The component's props — the native peer of `BatteryDeltaProps`. A value type so the view, the
/// state-holder, and the pure projection all agree on one shape, and so a SwiftUI `.onChange` can
/// detect a prop change cheaply. `startPct` / `endPct` are `Double?` (the web `number | null |
/// undefined`); a `nil` maps the web `null`/`undefined`, and a non-finite `Double` (`.nan` /
/// `.infinity`) maps the web `!Number.isFinite` case — both resolve to the muted "—" branch.
public struct BatteryDeltaInputs: Sendable, Equatable {
    /// Starting state-of-charge percentage 0–100 (web `startPct`); `nil` / non-finite → no data.
    public let startPct: Double?
    /// Ending state-of-charge percentage 0–100 (web `endPct`); `nil` / non-finite → no data.
    public let endPct: Double?
    /// The display variant (web `variant`, default `compact`).
    public let variant: BatteryDeltaVariant
    /// Whether to render the battery icon to the left (web `showIcon`, default `true`).
    public let showIcon: Bool

    public init(
        startPct: Double?,
        endPct: Double?,
        variant: BatteryDeltaVariant = .defaultVariant,
        showIcon: Bool = true
    ) {
        self.startPct = startPct
        self.endPct = endPct
        self.variant = variant
        self.showIcon = showIcon
    }
}

// MARK: - Number formatting (web `${number}` template-literal stringification)

/// Formats a finite percentage the way a JavaScript template literal does (web `${startPct}` /
/// `${magnitude}`): an integer-valued number prints with no decimals and no trailing ".0" (`60` →
/// "60"), and a fractional value prints its shortest decimal with trailing zeros trimmed (`78.5` →
/// "78.5"). This keeps the rendered "+60%" / "79% → 78%" byte-identical to the web for the
/// SoC-percentage domain (whole percents, occasionally one decimal place), where Tesla SoC endpoints
/// always arrive. Non-finite input returns "" (the projection never reaches this — `hasData` already
/// excludes it).
public enum BatteryDeltaNumber {
    public static func string(_ value: Double) -> String {
        guard value.isFinite else { return "" }
        let rounded = value.rounded()
        if value == rounded, abs(value) < 1e15 {
            return String(Int64(rounded))
        }
        var text = String(format: "%.10f", value)
        while text.contains("."), text.hasSuffix("0") {
            text.removeLast()
        }
        if text.hasSuffix(".") {
            text.removeLast()
        }
        return text
    }
}
