//
//  RecentActivity.Views.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  The three panels composed by `RecentActivity`: the shared glass-panel shell + section title,
//  the activity-feed panel (timeline rows + internal empty), the battery-trend panel (chart +
//  internal empty), and the fleet-performance panel (metric rows + most-efficient card). The
//  freshness chip, connectivity banner, and the surface-level loading / empty / error states live
//  in RecentActivity.States.swift. All copy resolves through the P1/S10 facade and all chrome is
//  token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Palette (web value/tint colors → adaptive tokens)

/// Maps the surface's tones + feed kinds to design-token colors. The web uses Tailwind values
/// (cyan / emerald / amber / purple); native uses the theme-adaptive semantic tokens so light /
/// dark / high-contrast all resolve correctly.
enum RecentActivityPalette {
    static func metricColor(for tone: RecentActivityTone) -> Color {
        switch tone {
        case .primary: Color.TS.textPrimary
        case .warning: Color.TS.statusWarning
        case .success: Color.TS.statusSuccess
        }
    }

    /// The feed row's icon tint (web drive `#00f0ff` cyan / charge `#10b981` emerald).
    static func kindTint(_ kind: RecentActivityKind) -> Color {
        switch kind {
        case .drive: Color.TS.accent
        case .charge: Color.TS.statusSuccess
        }
    }

    /// The feed row glyph (web Route / Zap).
    static func kindIcon(_ kind: RecentActivityKind) -> String {
        switch kind {
        case .drive: "road.lanes"
        case .charge: "bolt.fill"
        }
    }
}

// MARK: - Glass panel shell (web `GlassPanel`)

/// A glass card mirroring the web `<GlassPanel className="p-5">` — the shared shell each of the
/// three panels renders inside.
struct RecentActivityGlassPanel<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            content()
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// A panel's section title: the tinted glyph + the localized heading (web `h3.section-title`).
struct RecentActivitySectionTitle: View {
    let systemImage: String
    let tint: Color
    let titleKey: String
    let titleFallback: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            RecentActivityStrings.text(titleKey, titleFallback)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}

// MARK: - Activity feed panel (web Activity Feed `GlassPanel`)

/// The unified activity feed: the header (title + "View all") over the timeline rows, or the
/// friendly empty state (web "No activity yet. Start driving!"). Never a blank box.
struct RecentActivityFeedPanel: View {
    let items: [RecentActivityItem]
    let onViewAll: () -> Void

    var body: some View {
        RecentActivityGlassPanel {
            HStack(alignment: .firstTextBaseline) {
                RecentActivitySectionTitle(
                    systemImage: "waveform.path.ecg",
                    tint: Color.TS.accent,
                    titleKey: "activity.title",
                    titleFallback: "Recent Activity"
                )
                Spacer(minLength: TSSpacing.sm)
                Button(action: onViewAll) {
                    RecentActivityStrings.text("activity.viewAll", "View all")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(RecentActivityStrings.text("activity.viewAll", "View all"))
            }
            if items.isEmpty {
                RecentActivityFeedEmpty()
            } else {
                VStack(spacing: TSSpacing.md) {
                    ForEach(items) { RecentActivityRow(item: $0) }
                }
                .accessibilityElement(children: .contain)
            }
        }
    }
}

/// One feed row: the kind-tinted icon circle + the title/subtitle + the relative time (web
/// `Timeline` item). The whole row is a single VoiceOver element.
struct RecentActivityRow: View {
    let item: RecentActivityItem

    private var tint: Color {
        RecentActivityPalette.kindTint(item.kind)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: RecentActivityPalette.kindIcon(item.kind))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(tint.opacity(0.18), in: Circle())
                .overlay(Circle().strokeBorder(tint.opacity(0.45), lineWidth: 1.5))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.title)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                if !item.subtitle.isEmpty {
                    Text(verbatim: item.subtitle)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: item.timeAgo)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .fixedSize()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: RecentActivityAccessibility.itemLabel(item)))
    }
}

/// The empty activity feed (web Clock glyph + "No activity yet. Start driving!").
struct RecentActivityFeedEmpty: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "clock")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            RecentActivityStrings.text("activity.empty", "No activity yet. Start driving!")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Battery trend panel (web Battery Trend `GlassPanel`)

/// The battery-trend panel: the header over the area chart (web `AreaChartWrapper`) when there is
/// more than one point, else the friendly empty state.
struct RecentActivityBatteryPanel: View {
    let points: [RecentActivityBatteryPoint]
    let locale: Locale

    var body: some View {
        RecentActivityGlassPanel {
            RecentActivitySectionTitle(
                systemImage: "battery.100.bolt",
                tint: Color.TS.statusSuccess,
                titleKey: "battery.title",
                titleFallback: "Battery Trend"
            )
            if points.count > 1 {
                RecentActivityBatteryChart(points: points, locale: locale)
            } else {
                RecentActivityStrings.text("battery.empty", "Charge data will appear here")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, minHeight: 160)
                    .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - Fleet performance panel (web Fleet Performance `GlassPanel`)

/// The fleet-performance panel: the header over the metric rows + the optional most-efficient
/// highlight card.
struct RecentActivityPerformancePanel: View {
    let performance: RecentActivityPerformance

    var body: some View {
        RecentActivityGlassPanel {
            RecentActivitySectionTitle(
                systemImage: "chart.line.uptrend.xyaxis",
                tint: Color.TS.chartSeriesPower,
                titleKey: "perf.title",
                titleFallback: "Fleet Performance"
            )
            VStack(spacing: TSSpacing.md) {
                ForEach(performance.metrics) { RecentActivityPerformanceRow(metric: $0) }
                if let highlight = performance.mostEfficient {
                    RecentActivityEfficientCard(highlight: highlight)
                }
            }
            .accessibilityElement(children: .contain)
        }
    }
}

/// One performance row: the muted label + the bold tone-colored value (web `flex justify-between`).
struct RecentActivityPerformanceRow: View {
    let metric: RecentActivityMetric

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            RecentActivityStrings.text(metric.labelKey, metric.labelFallback)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: metric.value)
                .font(Font.TS.body)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(RecentActivityPalette.metricColor(for: metric.tone))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: RecentActivityAccessibility.metricLabel(metric, localize: RecentActivityStrings.string))
        )
    }
}

/// The most-efficient highlight card (web `bg-neon-green/5 border-neon-green/10` block).
struct RecentActivityEfficientCard: View {
    let highlight: RecentActivityEfficientHighlight

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            RecentActivityStrings.text("perf.mostEfficient", "Most Efficient")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: highlight.name)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.statusSuccess)
            Text(verbatim: highlight.value)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusSuccess.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.15), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
