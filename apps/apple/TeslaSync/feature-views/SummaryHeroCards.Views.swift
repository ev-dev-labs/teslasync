//
//  SummaryHeroCards.Views.swift
//  TeslaSync — P4 feature view · 0077 · SummaryHeroCards (Apple)
//
//  The composable sub-views for the weekly-digest "Week Summary" grid — the native
//  port of the web `HighlightCard` plus the freshness / offline / error chrome the
//  page owner contributes. Every view is token-driven (P1/S9), localizes through
//  `SummaryHeroStrings` (P1/S10), reuses the shared component library
//  (`@/components/ui`, `@/components/motion`), and carries VoiceOver labels. No view
//  performs networking — they read the bound `SummaryHeroCardsModel`.
//

import SwiftUI

// MARK: - Accent → glow (web `GlassPanel glow={…}` / `glowMap`)

extension SummaryHeroAccent {
    /// The glow tint for the card panel, or `nil` when the web `glowMap` renders no
    /// glow (amber / red). Cyan / green / purple map to the brand series colors.
    var glowColor: Color? {
        guard hasGlow else { return nil }
        switch self {
        case .cyan: return Color.TS.chartSeriesRegen
        case .green: return Color.TS.statusSuccess
        case .purple: return Color.TS.chartSeriesPower
        case .amber, .red: return nil
        }
    }
}

/// Applies the web `glow` shadow when the accent lights one; a no-op otherwise.
private struct SummaryGlow: ViewModifier {
    let color: Color?

    func body(content: Content) -> some View {
        if let color {
            content.shadow(color: color.opacity(0.28), radius: 14, x: 0, y: 4)
        } else {
            content
        }
    }
}

// MARK: - Hero card (web `HighlightCard`)

/// A frosted metric card: icon + label, a bold value, an optional trend chip, and
/// an optional subtitle — the native port of the web `HighlightCard`. Read as a
/// single VoiceOver element with the composed label.
struct SummaryHighlightCard: View {
    let item: HighlightItem

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                label
                Text(verbatim: item.value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let trend = item.trend {
                    SummaryTrendChip(trend: trend)
                }
                if let subtitle = item.subtitle {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .modifier(SummaryGlow(color: item.accent.glowColor))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SummaryHeroAccessibility.cardLabel(item)))
    }

    private var label: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: item.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: SummaryHeroStrings.string(item.labelKey, item.labelFallback))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }
}

// MARK: - Trend chip (web `change` row + `TrendingUp` / `TrendingDown`)

/// The week-over-week trend row. The arrow + color follow `trend.positive` (the
/// good/bad polarity, already inverted for cost/energy), exactly as the web
/// `change.positive ? TrendingUp : TrendingDown` + emerald/red does. Folded into
/// the parent card's accessibility label.
struct SummaryTrendChip: View {
    let trend: Trend

    private var tone: Color {
        trend.positive ? Color.TS.statusSuccess : Color.TS.statusDanger
    }

    private var symbol: String {
        trend.positive ? "arrow.up.right" : "arrow.down.right"
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
            Text(verbatim: trend.value)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
        }
        .foregroundStyle(tone)
        .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (native connectivity chrome)

/// The surface freshness chip (stale / offline) — a colored dot + label. Shown only
/// when degraded; a fresh surface carries no chip (web has no such chrome).
struct SummaryFreshnessChip: View {
    let connection: SummaryHeroConnection

    private var tone: Color {
        switch connection {
        case .online: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        SummaryHeroAccessibility.freshnessLabel(connection)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Offline banner (cached summary stays visible)

/// Shown above the grid while offline: the last summary remains visible behind this
/// notice (web cache-then-network keep-last behavior).
struct SummaryOfflineBanner: View {
    var body: some View {
        SummaryNoticeBanner(
            systemImage: "wifi.slash",
            tone: Color.TS.statusWarning,
            titleKey: SummaryHeroKeys.offline,
            titleFallback: "Offline",
            messageKey: SummaryHeroKeys.offlineMessage,
            messageFallback: "You're offline. Showing the last saved summary."
        )
    }
}

// MARK: - Error banner (failed with a cached summary)

/// Shown above the grid when a refresh fails but a previous summary is still on
/// screen: a retry affordance that keeps the cached data visible.
struct SummaryErrorBanner: View {
    let onRetry: () -> Void

    var body: some View {
        SummaryNoticeBanner(
            systemImage: "exclamationmark.triangle.fill",
            tone: Color.TS.statusDanger,
            titleKey: SummaryHeroKeys.errorTitle,
            titleFallback: "Couldn't refresh",
            messageKey: SummaryHeroKeys.errorMessage,
            messageFallback: "Showing the last saved summary."
        ) {
            TSButton(
                SummaryHeroStrings.key(SummaryHeroKeys.refresh, "Refresh"),
                variant: .secondary,
                size: .small,
                action: onRetry
            )
            .accessibilityHint(SummaryHeroStrings.key(SummaryHeroKeys.refreshHint, "Re-pull the weekly digest"))
        }
    }
}

// MARK: - Notice banner shell

/// A leading-icon notice row with a title, message, and optional trailing accessory
/// — the shared shell behind the offline + error banners.
struct SummaryNoticeBanner<Accessory: View>: View {
    let systemImage: String
    let tone: Color
    let titleKey: String
    let titleFallback: String
    let messageKey: String
    let messageFallback: String
    @ViewBuilder var accessory: () -> Accessory

    init(
        systemImage: String,
        tone: Color,
        titleKey: String,
        titleFallback: String,
        messageKey: String,
        messageFallback: String,
        @ViewBuilder accessory: @escaping () -> Accessory = { EmptyView() }
    ) {
        self.systemImage = systemImage
        self.tone = tone
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.messageKey = messageKey
        self.messageFallback = messageFallback
        self.accessory = accessory
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: SummaryHeroStrings.string(titleKey, titleFallback))
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: SummaryHeroStrings.string(messageKey, messageFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            accessory()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            tone.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (initial-mount chrome)

/// A skeleton hero card shown while the surface resolves its first snapshot.
struct SummaryHeroSkeletonCard: View {
    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 92, height: 12)
                }
                TSSkeleton(width: 116, height: 22)
                TSSkeleton(width: 60, height: 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityHidden(true)
    }
}
