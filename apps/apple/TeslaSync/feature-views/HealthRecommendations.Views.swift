//
//  HealthRecommendations.Views.swift
//  TeslaSync — P4 feature view · 0156 · HealthRecommendations (Apple)
//
//  The content chrome composed by `HealthRecommendations`: the `GlassPanel` of prioritized
//  maintenance tips — a shield-headed, uppercase title over a staggered list of priority-tinted
//  recommendation cards (web `GlassPanel` + `Shield` header + `StaggerContainer` of cards). The
//  freshness chip, connectivity banner, and loading / empty / error states live in
//  HealthRecommendations.States.swift. All consume pre-localized strings from the P1/S10 facade and
//  the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Priority → token tint + icon (web priority color + icon map)

extension HealthRecommendationPriority {
    /// The shared status tone for the card glyph (web `text-neon-red` for high, `text-neon-amber` for
    /// medium, `text-neon-cyan` for low).
    var iconTone: TSTone {
        switch self {
        case .high: .danger
        case .medium: .warning
        case .low: .info
        }
    }

    /// The leading glyph (web `AlertTriangle` for high/medium, `TrendingUp` for low).
    var iconSystemName: String {
        switch self {
        case .high, .medium: "exclamationmark.triangle.fill"
        case .low: "chart.line.uptrend.xyaxis"
        }
    }

    /// Low-priority tips use a neutral card (web `border-[var(--border-subtle)] bg-white/[0.02]`), not
    /// a status-tinted one; only the trend glyph carries the cyan accent.
    var usesNeutralCard: Bool {
        self == .low
    }
}

// MARK: - Content (web `GlassPanel` of recommendations)

/// The populated state: the shield-headed title over the staggered recommendation list (web
/// `<GlassPanel><div header/><StaggerContainer>…</StaggerContainer></GlassPanel>`).
struct HealthRecommendationsContent: View {
    let projection: HealthRecommendationsProjection

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HealthRecommendationsHeader(title: projection.title.text)
                recommendationList
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    /// The staggered list of recommendation cards (web `StaggerContainer` + `StaggerItem`). The index
    /// drives the per-item cascade delay, exactly like the web stagger.
    private var recommendationList: some View {
        TSStaggerContainer(spacing: TSSpacing.md) {
            ForEach(Array(projection.recommendations.enumerated()), id: \.element.id) { index, recommendation in
                TSStaggerItem(index: index) {
                    HealthRecommendationRow(recommendation: recommendation)
                }
            }
        }
    }
}

// MARK: - Header (web `Shield` + uppercase title)

/// The panel header: a cyan shield glyph beside the uppercase, letter-spaced title (web `<Shield/>` +
/// `<h3 class="uppercase tracking-wider text-[var(--text-muted)]">`).
struct HealthRecommendationsHeader: View {
    let title: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "shield.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusInfo)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.label)
                .tracking(TSTypeMetrics.labelTracking)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(verbatim: title))
    }
}

// MARK: - Recommendation card (web priority-tinted tip row)

/// One recommendation card: the priority glyph beside the tip text, in a priority-tinted, ringed
/// rounded box (web `flex items-start gap-3 rounded-lg border px-4 py-3` with the priority border +
/// fill). High/medium cards take the status tint; low cards take a neutral surface with only the
/// glyph carrying the cyan accent.
struct HealthRecommendationRow: View {
    let recommendation: HealthRecommendation

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: recommendation.priority.iconSystemName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(recommendation.priority.iconTone.color)
                .padding(.top, 1)
                .accessibilityHidden(true)
            Text(verbatim: recommendation.text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardFill, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(cardStroke, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: HealthRecommendationsAccessibility.rowSummary(for: recommendation)))
    }

    /// The card fill — a faint status tint for high/medium (web `bg-neon-{tone}/5`), a neutral surface
    /// for low (web `bg-white/[0.02]`).
    private var cardFill: Color {
        recommendation.priority.usesNeutralCard
            ? Color.TS.textMuted.opacity(0.06)
            : recommendation.priority.iconTone.color.opacity(0.05)
    }

    /// The card ring — a status tint for high/medium (web `border-neon-{tone}/20`), the subtle border
    /// token for low (web `border-[var(--border-subtle)]`).
    private var cardStroke: Color {
        recommendation.priority.usesNeutralCard
            ? Color.TS.border
            : recommendation.priority.iconTone.color.opacity(0.2)
    }
}
