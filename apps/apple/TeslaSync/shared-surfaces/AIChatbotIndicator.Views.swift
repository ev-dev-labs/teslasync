//
//  AIChatbotIndicator.Views.swift
//  TeslaSync — P4 shared surface · 0012 · AIChatbotIndicator (Apple)
//
//  The presentational subviews composed by `AIChatbotIndicator`: the Helix brand mark (the native
//  parity of `components/branding/HelixMark.tsx`, reproduced as a stroked SwiftUI `Shape` from the
//  same 24×24 SVG path), the cyan "Helix" badge (web `InnerIndicator`'s chip), the freshness dot
//  (P4 connectivity axis), the neutral loading skeleton chip, and the neutral unavailable / retry
//  chip. All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens; the
//  shared `TSSkeleton` / `TSButton` primitives are reused. No networking, no Tailwind ports, no raw
//  hex.
//
//  The mark is named `AIChatbotHelixMark` (not the bare `HelixMark`) so the surface stays
//  self-contained and does not collide with another shared surface's internal mark in the single
//  app module.
//

import SwiftUI

// MARK: - Helix brand mark (native parity of `components/branding/HelixMark.tsx`)

/// The Helix brand glyph — two intertwined quadratic strands crossing at the centre with two
/// horizontal rungs, the native port of the web `HelixMark` SVG (`viewBox 0 0 24 24`). Decorative;
/// the brand name is voiced by the surrounding badge label.
struct AIChatbotHelixMark: View {
    var size: CGFloat = 14
    var tint: Color = .TS.accent

    var body: some View {
        AIChatbotHelixMarkShape()
            .stroke(
                tint,
                style: StrokeStyle(lineWidth: max(1, size * (1.75 / 24)), lineCap: .round, lineJoin: .round)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The double-helix path — the verbatim port of the web `HelixMark` SVG geometry, scaled from its
/// 24-unit viewBox to the requested frame: strand A `M 8 2 Q 18 7 12 12 Q 6 17 16 22`, strand B
/// (mirrored about x=12) `M 16 2 Q 6 7 12 12 Q 18 17 8 22`, and two rungs at y=7 and y=17.
struct AIChatbotHelixMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        func point(_ pathX: CGFloat, _ pathY: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + pathX * scale, y: rect.minY + pathY * scale)
        }
        var path = Path()
        // Strand A: top-left → centre → bottom-right.
        path.move(to: point(8, 2))
        path.addQuadCurve(to: point(12, 12), control: point(18, 7))
        path.addQuadCurve(to: point(16, 22), control: point(6, 17))
        // Strand B: mirrored about x=12, crossing strand A at the centre.
        path.move(to: point(16, 2))
        path.addQuadCurve(to: point(12, 12), control: point(6, 7))
        path.addQuadCurve(to: point(8, 22), control: point(18, 17))
        // Two rungs where the strands run nearly parallel.
        path.move(to: point(10, 7))
        path.addLine(to: point(14, 7))
        path.move(to: point(10, 17))
        path.addLine(to: point(14, 17))
        return path
    }
}

// MARK: - Helix badge (web `InnerIndicator` chip)

/// The cyan "Helix" pill — the native parity of the web `InnerIndicator` span
/// (`rounded-full border border-cyan-300/30 bg-cyan-300/10 … text-cyan-300`). Non-interactive like
/// the web span; the brand name is voiced as one VoiceOver element with a freshness-aware label, and
/// the long-form explanation rides the pointer tooltip (web `title`).
struct AIChatbotBadge: View {
    let connection: AIChatbotConnection

    private var brand: String {
        AIChatbotStrings.string("helix.ariaLabel", "Helix")
    }

    private var freshnessNote: String {
        switch connection {
        case .live:
            AIChatbotStrings.string("chatbot.indicator.live", "Live")
        case .stale:
            AIChatbotStrings.string("chatbot.indicator.staleA11y", "Stale — tap to refresh")
        case .offline:
            AIChatbotStrings.string("chatbot.indicator.offlineA11y", "Offline — showing the last known state")
        }
    }

    private var tooltip: String {
        AIChatbotStrings.string(
            "helix.tooltip",
            "Helix is your AI assistant. It generates responses using your redacted fleet context."
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            AIChatbotHelixMark(size: 14)
            Text(verbatim: AIChatbotStrings.string("helix.badge", "Helix"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.accent)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.accent.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.3), lineWidth: 1))
        .help(tooltip)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AIChatbotAccessibility.badgeLabel(
            brand: brand,
            connection: connection,
            freshnessNote: freshnessNote
        )))
    }
}

// MARK: - Freshness dot (P4 connectivity axis)

/// The freshness affordance shown beside the badge when the snapshot is not live — a coloured dot
/// that re-requests the gate context on tap (so pointer + VoiceOver users can recover a stale /
/// offline state). Hidden entirely when live.
struct AIChatbotFreshnessDot: View {
    let connection: AIChatbotConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var accessibilityText: String {
        switch connection {
        case .live:
            AIChatbotStrings.string("chatbot.indicator.live", "Live")
        case .stale:
            AIChatbotStrings.string("chatbot.indicator.staleA11y", "Stale — tap to refresh")
        case .offline:
            AIChatbotStrings.string("chatbot.indicator.offlineA11y", "Offline — showing the last known state")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .padding(TSSpacing.xs)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Presented (gate enabled → the cyan badge + freshness)

/// The presented surface — the cyan Helix badge, plus the freshness dot when the snapshot is not
/// live. The native parity of the web rendered `InnerIndicator`, extended with the P4 leaf axis.
struct AIChatbotPresentedView: View {
    let connection: AIChatbotConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            AIChatbotBadge(connection: connection)
            if connection != .live {
                AIChatbotFreshnessDot(connection: connection, onRefresh: onRefresh)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading (settings resolving → neutral skeleton chip)

/// The neutral skeleton chip shown while the settings resolve — a pill-shaped shimmer that carries
/// no AI branding, so nothing leaks before the fail-closed gate has decided. Shimmer + label respect
/// Reduce Motion / VoiceOver via the shared `TSSkeleton`.
struct AIChatbotLoadingChip: View {
    var body: some View {
        TSSkeleton(width: 68, height: 24, cornerRadius: TSRadius.pill)
            .frame(width: 68, height: 24)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: AIChatbotStrings.string(
                "chatbot.indicator.loadingA11y", "Loading"
            )))
    }
}

// MARK: - Unavailable (settings failed → neutral retry chip)

/// The neutral retry chip shown when the settings query fails — a `QueryError` peer scaled to the
/// indicator's footprint. Carries no AI branding (the gate verdict is unknown), and re-requests the
/// context on tap.
struct AIChatbotUnavailableChip: View {
    let onRetry: () -> Void

    var body: some View {
        TSButton(variant: .secondary, size: .small, action: onRetry) {
            Text(verbatim: AIChatbotStrings.string("chatbot.indicator.unavailable", "Indicator unavailable"))
        }
        .accessibilityLabel(Text(verbatim: AIChatbotStrings.string(
            "chatbot.indicator.unavailableA11y", "Indicator unavailable — tap to retry"
        )))
    }
}
