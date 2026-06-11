//
//  InsightsEngine.Views.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  The presentational subviews composed by `InsightsEngine`: the "Smart Insights" section header,
//  the responsive 1-/2-column insight grid (web `grid-cols-1 md:grid-cols-2`), and the individual
//  insight card (the web `GlassPanel` with a severity-coloured left border, a tinted icon chip, the
//  title + trend glyph, and the description). All consume the resolved model + the shared P1/S9
//  tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Section header (web h3 "Smart Insights" + Lightbulb)

/// The titled header row — the lightbulb + "Smart Insights" (web `section-title`), plus the P4 leaf
/// freshness chip + refresh affordance trailing.
struct InsightsEngineHeader: View {
    let connection: InsightsEngineConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "lightbulb.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: InsightsEngineStrings.string("insights.section.title", "Smart Insights"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            InsightsEngineFreshnessChip(connection: connection)
            InsightsEngineRefreshButton(action: onRefresh)
        }
    }
}

// MARK: - Insight grid (web `grid-cols-1 md:grid-cols-2 gap-4`)

/// The responsive insight grid: one column in a compact width, two otherwise (web `md:grid-cols-2`).
struct InsightsEngineGrid: View {
    let insights: [InsightsEngineResolvedInsight]

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var compact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var compact: Bool {
            false
        }
    #endif

    var body: some View {
        LazyVGrid(columns: InsightsEngineLayout.columns(compact: compact), alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(insights) { insight in
                InsightsEngineCard(insight: insight)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Shared grid geometry so the ready grid + the loading skeleton agree on column count.
enum InsightsEngineLayout {
    static func columns(compact: Bool) -> [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top),
            count: compact ? 1 : 2
        )
    }
}

// MARK: - Insight card (web `GlassPanel` + left severity border)

/// One insight card — the native port of the web `GlassPanel` insight tile: a frosted panel with a
/// 3pt severity-coloured leading border, a tinted icon chip, the title + trend glyph, and the
/// description. The whole card is one VoiceOver element reading title + trend + description.
struct InsightsEngineCard: View {
    let insight: InsightsEngineResolvedInsight

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: insight.title)
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    Image(systemName: insight.trend.symbol)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(trendColor)
                        .accessibilityHidden(true)
                }
                Text(verbatim: insight.description)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { panelBackground }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: insight.accessibilityLabel))
    }

    private var iconChip: some View {
        Image(systemName: insight.icon.symbol)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(insight.severity.tone)
            .frame(width: 36, height: 36)
            .background(
                insight.severity.tone.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var panelBackground: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .fill(TSMaterial.panel)
            Rectangle()
                .fill(insight.severity.tone)
                .frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
    }

    private var trendColor: Color {
        InsightsEngineColor.trend(insight.trend, trendGood: insight.trendGood)
    }
}

// MARK: - Token mappings (severity / trend / icon → P1/S9 tokens + SF Symbols)

/// Severity → status token (web `SEVERITY_BORDER`: info #00f0ff, success #10b981, warning #f59e0b,
/// alert #ef4444 — each an exact match to a generated status token, never raw hex).
extension InsightsEngineSeverity {
    var tone: Color {
        switch self {
        case .info: Color.TS.statusInfo
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .alert: Color.TS.statusDanger
        }
    }
}

/// Trend → SF Symbol (web lucide `TrendingUp` / `TrendingDown` / `ArrowRight`).
extension InsightsEngineTrend {
    var symbol: String {
        switch self {
        case .up: "arrow.up.right"
        case .down: "arrow.down.right"
        case .neutral: "arrow.right"
        }
    }
}

/// Per-insight icon → SF Symbol (web lucide glyphs).
extension InsightsEngineIcon {
    var symbol: String {
        switch self {
        case .chargingCost: "dollarsign.circle.fill"
        case .efficiency: "bolt.fill"
        case .battery: "battery.100"
        case .optimalCharging: "battery.100.bolt"
        case .vampireDrain: "shield.fill"
        case .drivingPatterns: "car.fill"
        case .costSavings: "leaf.fill"
        case .rangeOptimization: "clock.fill"
        }
    }
}

/// Trend colour — the web render rule: `trendGood ? TREND_ICON[trend] : trendColor(trend)`.
/// trendGood → up=success, down=danger, neutral=secondary; otherwise the inverted `trendColor` →
/// up=danger, down=success, neutral=muted.
enum InsightsEngineColor {
    static func trend(_ trend: InsightsEngineTrend, trendGood: Bool) -> Color {
        if trendGood {
            switch trend {
            case .up: return Color.TS.statusSuccess
            case .down: return Color.TS.statusDanger
            case .neutral: return Color.TS.textSecondary
            }
        }
        switch trend {
        case .up: return Color.TS.statusDanger
        case .down: return Color.TS.statusSuccess
        case .neutral: return Color.TS.textMuted
        }
    }
}
