import SwiftUI

// MARK: - Surface identity

/// Stable, non-identifying identity for the `ToolCard` feature view. The slug is
/// the value emitted with the P1/S11 `view.opened` diagnostics contract and is
/// referenced by both the view and its tests so the two never drift.
public enum ToolCardSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "ToolCard"

    /// Reports the surface becoming visible. This is the exact code path the
    /// view runs from its `.task`, factored out so it is unit-testable without a
    /// rendering host.
    public static func reportOpen(to telemetry: any ToolCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Tint (web color string → design-token accent)

/// The icon accent for a `ToolCard`, mirroring the web `ICON_COLOR_MAP` keys.
///
/// The web component keys its decorative neon accent off a free-form `color`
/// string and falls back to `cyan` for anything unknown
/// (`ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan`). This type reproduces that
/// behaviour in a type-safe way and resolves every case to a generated design
/// token (so the surface stays theme-aware and never hardcodes a hex value).
public enum ToolCardTint: String, CaseIterable, Sendable {
    case cyan
    case green
    case purple
    case amber
    case red

    /// The accent used when the web `color` prop is missing or unrecognised —
    /// parity with the web `?? ICON_COLOR_MAP.cyan` fallback.
    public static let fallback: ToolCardTint = .cyan

    /// Background fill opacity for the icon chip (web `bg-{color}/10`).
    public static let backgroundOpacity = 0.10
    /// Ring/border opacity for the icon chip (web `ring-{color}/20`).
    public static let borderOpacity = 0.20

    /// Maps a web `color` string to a tint, lower-casing first and falling back
    /// to ``fallback`` for any value outside the known set.
    public init(web raw: String) {
        self = ToolCardTint(rawValue: raw.lowercased()) ?? Self.fallback
    }

    /// The full-strength accent color (web `text-{color}`), sourced from the
    /// generated chart palette so the hues match across platforms.
    public var accent: Color {
        switch self {
        case .cyan: Color.TS.chartSeriesRegen
        case .green: Color.TS.chartSeriesBattery
        case .purple: Color.TS.chartSeriesPower
        case .amber: Color.TS.chartSeriesEnergy
        case .red: Color.TS.chartSeriesTemperature
        }
    }

    /// The icon chip background (web `bg-{color}/10`).
    public var iconBackground: Color {
        accent.opacity(Self.backgroundOpacity)
    }

    /// The icon chip ring/border (web `ring-{color}/20`).
    public var iconBorder: Color {
        accent.opacity(Self.borderOpacity)
    }
}

// MARK: - Presentation (pure projection of the inputs → render config)

/// The pure, `Equatable` projection of a `ToolCard`'s inputs into the structural
/// decisions the view renders. Keeping these decisions in a value type lets the
/// XCTest suite cover every configuration (and the accessibility policy) without
/// a snapshot library — the same approach the dashboard-widget surfaces use.
public struct ToolCardPresentation: Equatable, Sendable {
    /// The SF Symbol shown in the accent chip (the native analogue of the web
    /// Lucide icon component passed via the `icon` prop).
    public let iconSystemName: String
    /// The resolved icon accent.
    public let tint: ToolCardTint
    /// Whether the secondary description line renders (the web always renders the
    /// `<p>`, but native omits an empty line so VoiceOver stays terse).
    public let showsDescription: Bool

    public init(iconSystemName: String, tint: ToolCardTint, hasDescription: Bool) {
        self.iconSystemName = iconSystemName
        self.tint = tint
        showsDescription = hasDescription
    }

    /// The icon chip is decorative — its meaning is carried by the title — so it
    /// is hidden from VoiceOver.
    public var iconIsDecorative: Bool {
        true
    }

    /// The title and description are merged into a single VoiceOver element so
    /// the card is announced as one coherent header.
    public var combinesHeaderForVoiceOver: Bool {
        true
    }

    /// The diagnostics slug this presentation belongs to.
    public var surfaceSlug: String {
        ToolCardSurface.slug
    }

    /// Builds a presentation from the raw web-style inputs: a free-form color
    /// string (resolved via ``ToolCardTint/init(web:)``) and whether a
    /// description is present (absent/empty ⇒ no description line).
    public static func make(
        iconSystemName: String,
        colorName: String,
        hasDescription: Bool
    ) -> ToolCardPresentation {
        ToolCardPresentation(
            iconSystemName: iconSystemName,
            tint: ToolCardTint(web: colorName),
            hasDescription: hasDescription
        )
    }
}
