//
//  StatusHero.Views.swift
//  TeslaSync — P4 shared surface · 0199 · StatusHero (Apple)
//
//  The presentational pieces of the at-a-glance status card: the status → semantic-tone token
//  projection (the web `*-400/500` hues + glow), the tinted-and-ringed medallion (web
//  `rounded-full ring-2` with the lucide glyph), the status text region (web `role="status"` heading +
//  sub-line + the optional "Live" chip), the primary CTA (web `<Button>` + `<RefreshCw>`), and the
//  composable ``StatusHeroContainer`` (the web `<GlassPanel>` with the status glow + the responsive
//  medallion / text / CTA layout). All chrome is token-driven (P1/S9); the only non-token style is the
//  status-coloured glow, a dynamic computed value. No raw hex, no Tailwind ports.
//
//  Web-parity detail, reproduced faithfully:
//    • the status drives the medallion glyph + tint, the headline colour, the ring, and the glow (web
//      `STATUS_CONFIG`), mapped to the shared ``TSTone`` tokens so it recolours across themes.
//    • the layout is a centered column on compact width (web mobile `flex-col … text-center`) and a
//      leading-aligned row on regular width (web `md:flex-row … md:text-left`).
//    • the "Live" chip renders inside the sub-line region only (web nesting), via the shared
//      ``TSLiveIndicator`` (the web `LiveIndicator`).
//    • the CTA's loading state swaps its content for a spinner and disables it (web spinning icon +
//      `disabled={cta.loading}`).
//

import SwiftUI

// MARK: - HeroStatus → semantic tone tokens (web `STATUS_CONFIG` hues)

extension HeroStatus {
    /// The semantic tone — the theme-aware token projection of the web status hues (`healthy → success`,
    /// `degraded → warning`, `unhealthy → danger`, `unknown → neutral`, `maintenance → info`). Reuses the
    /// shared ``TSTone`` so the medallion, headline, ring, and glow recolour across light / dark /
    /// high-contrast, where the web fixed `*-400/500` hues did not.
    var tone: TSTone {
        switch self {
        case .healthy: .success
        case .degraded: .warning
        case .unhealthy: .danger
        case .unknown: .neutral
        case .maintenance: .info
        }
    }

    /// The resolved status colour for the medallion glyph + ring, the headline, and the glow (web
    /// `cfg.text` / `cfg.ring` / `cfg.glowRgba`).
    var tint: Color {
        tone.color
    }

    /// The glow alpha behind the panel — the web `cfg.glowRgba` opacity: `0.25` for the muted `unknown`
    /// tier, `0.35` for the rest, so the resting / alerting tiers read a touch louder than "no answer".
    var glowOpacity: Double {
        self == .unknown ? 0.25 : 0.35
    }
}

// MARK: - StatusHeroMedallion (web ringed icon `<div className="h-14 w-14 … ring-2">`)

/// The status medallion — the native peer of the web tinted, ringed icon disc: a 56pt circle filled with
/// the status tint at low opacity, stroked with the status ring, holding the status SF Symbol. Decorative
/// for VoiceOver (web `aria-hidden`); the status is spoken via the headline in ``StatusHeroTextBlock``.
struct StatusHeroMedallion: View {
    let status: HeroStatus

    var body: some View {
        Image(systemName: status.iconSystemName)
            .font(.system(size: 28, weight: .semibold))
            .foregroundStyle(status.tint)
            .frame(width: 56, height: 56)
            .background(status.tint.opacity(0.15), in: Circle())
            .overlay(Circle().strokeBorder(status.tint.opacity(0.4), lineWidth: 2))
            .accessibilityHidden(true)
    }
}

// MARK: - StatusHeroTextBlock (web `<div role="status" aria-live="polite">`)

/// The headline + sub-line region — the native peer of the web `role="status"` block. The headline reads
/// in the status tint (web `cfg.text`, `text-xl md:text-2xl font-bold`); the sub-line (when present)
/// reads in the secondary token with the optional trailing "Live" chip (the shared ``TSLiveIndicator``,
/// the web `LiveIndicator`). Composed as one VoiceOver element carrying the projection's accessibility
/// label — the spoken peer of the live region — and marked `updatesFrequently` (the native peer of the
/// web `aria-live="polite"`), so the colour-encoded status is announced as words.
struct StatusHeroTextBlock: View {
    let projection: StatusHeroProjection
    let alignment: HorizontalAlignment

    var body: some View {
        VStack(alignment: alignment, spacing: TSSpacing.sm) {
            Text(verbatim: projection.headline)
                .font(Font.TS.title)
                .foregroundStyle(projection.status.tint)
                .multilineTextAlignment(textAlignment)
                .fixedSize(horizontal: false, vertical: true)
            if let subline = projection.subline {
                sublineRow(subline)
            }
        }
        .frame(maxWidth: .infinity, alignment: frameAlignment)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// The sub-line row — the web `{subline}` plus the nested `{live && …}` chip. The chip is the shared
    /// ``TSLiveIndicator`` (a pulsing dot + the localized "Live" word), shown only when the projection
    /// gates it on (web `subline && live`).
    private func sublineRow(_ subline: String) -> some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: subline)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(textAlignment)
                .fixedSize(horizontal: false, vertical: true)
            if projection.showsLive {
                TSLiveIndicator(isLive: true)
            }
        }
    }

    private var textAlignment: TextAlignment {
        alignment == .center ? .center : .leading
    }

    private var frameAlignment: Alignment {
        alignment == .center ? .center : .leading
    }
}

// MARK: - StatusHeroCTAButton (web `<Button variant="primary">` + `<RefreshCw>`)

/// The trailing action button — the native peer of the web primary `<Button>` with the `<RefreshCw>`
/// glyph. A leading refresh arrow + the caller's label invoke the host handler; the loading state swaps
/// the content for a spinner and disables the control (the native peer of the web spinning icon +
/// `disabled={cta.loading}`), via the shared ``TSButton``'s built-in loading affordance.
struct StatusHeroCTAButton: View {
    let label: String
    let isLoading: Bool
    let onTap: (@MainActor () -> Void)?

    var body: some View {
        TSButton(variant: .primary, size: .medium, isLoading: isLoading) {
            onTap?()
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .accessibilityHidden(true)
                Text(verbatim: label)
            }
        }
    }
}

// MARK: - StatusHeroContainer (web `<GlassPanel>`)

/// The status card container — the native peer of the web `<GlassPanel>`: a frosted panel carrying a
/// status-tinted glow (web `boxShadow: 0 0 60px cfg.glowRgba`) over an adaptive layout of the medallion,
/// the status text region, and the optional CTA. The layout is a centered column on compact width (web
/// mobile `flex-col … text-center`) and a leading-aligned row on regular width (web `md:flex-row …
/// md:text-left`) — the native peer of the web responsive breakpoint. A pure function of its projection +
/// the CTA closure, so it composes in every branch for preview / snapshot / test.
struct StatusHeroContainer: View {
    let projection: StatusHeroProjection
    let onActivate: (@MainActor () -> Void)?

    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        TSGlassPanel {
            layout
        }
        .shadow(color: projection.status.tint.opacity(projection.status.glowOpacity), radius: 28)
        .accessibilityIdentifier(projection.anchorID ?? StatusHeroSurface.slug)
    }

    /// Picks the responsive layout — the centered column on compact width, the leading row otherwise
    /// (macOS / iPad / iPhone landscape report `.regular`).
    @ViewBuilder
    private var layout: some View {
        if sizeClass == .compact {
            columnLayout
        } else {
            rowLayout
        }
    }

    /// The web `md:flex-row` layout — medallion, the flex-grow text region, then the CTA.
    private var rowLayout: some View {
        HStack(alignment: .center, spacing: TSSpacing.x2xl) {
            StatusHeroMedallion(status: projection.status)
            StatusHeroTextBlock(projection: projection, alignment: .leading)
            cta
        }
    }

    /// The web mobile `flex-col` layout — medallion over the centered text region over the CTA.
    private var columnLayout: some View {
        VStack(alignment: .center, spacing: TSSpacing.lg) {
            StatusHeroMedallion(status: projection.status)
            StatusHeroTextBlock(projection: projection, alignment: .center)
            cta
        }
    }

    /// The optional CTA (web `{cta && …}`).
    @ViewBuilder
    private var cta: some View {
        if projection.showsCTA, let label = projection.ctaLabel {
            StatusHeroCTAButton(label: label, isLoading: projection.ctaIsLoading, onTap: onActivate)
        }
    }
}
