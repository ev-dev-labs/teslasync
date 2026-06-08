//
//  HighlightCard.Model.swift
//  TeslaSync — P4 feature view · 0076 · HighlightCard (Apple)
//
//  Pure, host-free projection layer for the HighlightCard surface — SwiftUI
//  parity of features/analytics/components/weekly-digest/HighlightCard.tsx.
//
//  HighlightCard is a *presentational* component: the web source fetches nothing
//  (its only dependencies are the `@/components/ui` GlassPanel + two lucide trend
//  glyphs). So, exactly like the sibling `ToolCard` surface, the remote phases
//  (loading / error / stale / offline) belong to whatever data-bound caller
//  embeds the card (e.g. the weekly-digest `SummaryHeroCards`), not to the card
//  itself. The branches the card *does* own — the `color` → accent + glow map,
//  the optional `change` trend (up/down), the optional subtitle, and an empty
//  value rendered as an em dash instead of a blank box — are modelled here as
//  equatable value types so every branch is unit-testable without a render host.
//

import Foundation
import SwiftUI

// MARK: - Surface identity (P1/S11 view.opened)

/// Stable, non-identifying identity for the `HighlightCard` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract;
/// the view and its tests both read it from here so the two never drift.
public enum HighlightCardSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "HighlightCard"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any HighlightCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Accent (web `color` prop → design-token accent + glow map)

/// The colour accent for a `HighlightCard`, mirroring the web `color` prop
/// (`'cyan' | 'green' | 'purple' | 'amber' | 'red'`, default `'cyan'`) and its
/// `glowMap` (`cyan/green/purple` keep their hue as a glow; `amber/red` map to
/// `none`). Each case resolves to a generated design token so the hues match the
/// other surfaces and stay theme-aware instead of hardcoding hex values.
public enum HighlightCardAccent: String, CaseIterable, Sendable {
    case cyan
    case green
    case purple
    case amber
    case red

    /// The accent used when the web `color` prop is missing or unrecognised —
    /// parity with the web `color = 'cyan'` default.
    public static let fallback: HighlightCardAccent = .cyan

    /// Maps a web `color` string to an accent, lower-casing first and falling
    /// back to ``fallback`` for any value outside the known set.
    public init(web raw: String) {
        self = HighlightCardAccent(rawValue: raw.lowercased()) ?? Self.fallback
    }

    /// The full-strength accent colour, sourced from the generated chart palette
    /// so the hues line up with the other feature surfaces (same mapping the
    /// `ToolCard` tint uses).
    public var accent: Color {
        switch self {
        case .cyan: Color.TS.chartSeriesRegen
        case .green: Color.TS.chartSeriesBattery
        case .purple: Color.TS.chartSeriesPower
        case .amber: Color.TS.chartSeriesEnergy
        case .red: Color.TS.chartSeriesTemperature
        }
    }

    /// Whether this accent carries a glow, parity with the web `glowMap`
    /// (`cyan/green/purple` → glow, `amber/red` → none).
    public var hasGlow: Bool {
        switch self {
        case .cyan, .green, .purple: true
        case .amber, .red: false
        }
    }

    /// The glow colour for the panel, or `nil` when this accent does not glow.
    public var glowColor: Color? {
        hasGlow ? accent : nil
    }
}

// MARK: - Change (web `change?: { value: string; positive: boolean }`)

/// The optional trend chip shown under the value — parity with the web `change`
/// prop. `value` is a caller-formatted, ready-to-render string (e.g. `"+12.3%"`);
/// `isPositive` drives the glyph (up / down) and the success / danger tint
/// (web `text-emerald-400` / `text-red-400`).
public struct HighlightCardChange: Equatable, Sendable {
    /// The caller-formatted delta string, rendered verbatim.
    public let value: String
    /// Whether the change reads as positive (web `change.positive`).
    public let isPositive: Bool

    public init(value: String, isPositive: Bool) {
        self.value = value
        self.isPositive = isPositive
    }

    /// SF Symbol for the trend glyph — the native analogue of the web lucide
    /// `TrendingUp` / `TrendingDown` icons.
    public var systemImage: String {
        isPositive ? "arrow.up.right" : "arrow.down.right"
    }

    /// The tint for the chip (web `text-emerald-400` positive / `text-red-400`
    /// negative), resolved to the semantic status tokens.
    public var tint: Color {
        isPositive ? Color.TS.statusSuccess : Color.TS.statusDanger
    }
}

// MARK: - Presentation (pure projection of inputs → render decisions)

/// The pure, `Equatable` projection of a `HighlightCard`'s inputs into the
/// structural decisions the view renders. Holding these decisions in a value
/// type lets the XCTest suite cover every configuration (and the accessibility
/// policy) without a snapshot library — the same approach the `ToolCard` and
/// dashboard-widget surfaces use.
public struct HighlightCardPresentation: Equatable, Sendable {
    /// The SF Symbol shown beside the label (native analogue of the web `icon`).
    public let iconSystemName: String
    /// The resolved colour accent.
    public let accent: HighlightCardAccent
    /// Whether a non-empty value is present. When `false` the view renders the
    /// em-dash empty form instead of a blank box.
    public let hasValue: Bool
    /// Whether the trend change chip renders (web `change && …`).
    public let showsChange: Bool
    /// The change direction when present, else `nil` (web `change.positive`).
    public let changeIsPositive: Bool?
    /// Whether the subtitle line renders (web `subtitle && …`).
    public let showsSubtitle: Bool

    public init(
        iconSystemName: String,
        accent: HighlightCardAccent,
        value: String,
        change: HighlightCardChange?,
        hasSubtitle: Bool
    ) {
        self.iconSystemName = iconSystemName
        self.accent = accent
        hasValue = !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        showsChange = change != nil
        changeIsPositive = change?.isPositive
        showsSubtitle = hasSubtitle
    }

    /// Whether the panel carries a glow (delegates to the accent's glow map).
    public var hasGlow: Bool {
        accent.hasGlow
    }

    /// The icon is decorative — its meaning is carried by the label — so it is
    /// hidden from VoiceOver.
    public var iconIsDecorative: Bool {
        true
    }

    /// The label, value, change, and subtitle are merged into a single VoiceOver
    /// element so the card is announced as one coherent metric.
    public var combinesForVoiceOver: Bool {
        true
    }

    /// The diagnostics slug this presentation belongs to.
    public var surfaceSlug: String {
        HighlightCardSurface.slug
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's *own* strings by key with a web-style English
/// fallback, so the view holds no hardcoded literals. The caller-supplied label,
/// value, and subtitle are localised by the embedding surface (the card is a
/// reusable container, exactly like the web component); only the card's intrinsic
/// chrome — the empty em dash and the trend accessibility phrasing — lives here.
/// Keys live in the "HighlightCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum HighlightCardStrings {
    public static let table = "HighlightCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver phrasing for the surface. Kept pure + injectable so the
/// a11y contract can be asserted without rendering.
public enum HighlightCardAccessibility {
    /// The em dash shown in place of a missing value (never a blank box).
    public static var emptyValueGlyph: String {
        HighlightCardStrings.string("highlightCard.value.empty", "—")
    }

    /// The spoken form of a missing value, so VoiceOver says "No data" rather
    /// than reading the em-dash glyph.
    public static var emptyValueLabel: String {
        HighlightCardStrings.string("highlightCard.value.empty.a11y", "No data")
    }

    /// "Increased by {value}" / "Decreased by {value}" — the spoken form of the
    /// trend chip, so VoiceOver announces direction instead of the arrow glyph.
    public static func changeLabel(isPositive: Bool, value: String) -> String {
        let format = isPositive
            ? HighlightCardStrings.string("highlightCard.change.increase.a11y", "Increased by %@")
            : HighlightCardStrings.string("highlightCard.change.decrease.a11y", "Decreased by %@")
        return String(format: format, value)
    }
}
