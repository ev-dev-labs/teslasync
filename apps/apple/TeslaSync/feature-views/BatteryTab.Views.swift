//
//  BatteryTab.Views.swift
//  TeslaSync — P4 feature view · 0052 · BatteryTab (Apple)
//
//  The presentational chrome composed by `BatteryTab`: the freshness chip, the stale/offline
//  connectivity banner, the reusable glass chart panel, the metric-card grid (web `MetricCard`
//  ×5), and the shared loading / empty / error states. All consume pre-localized strings from
//  the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports. The four
//  charts live in `BatteryTab.Charts.swift`.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct BatteryFreshnessChip: View {
    let connection: BatteryConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            BatteryTabStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(BatteryTabStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: BatteryConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "analytics.battery.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "analytics.battery.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "analytics.battery.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached
/// values are clearly labeled (web `DataFreshness` indicator intent).
struct BatteryConnectivityBanner: View {
    let connection: BatteryConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "analytics.battery.offlineBanner" : "analytics.battery.staleBanner"
        let fallback = offline
            ? "Offline — showing last known battery analytics"
            : "Reconnecting — battery analytics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: offline ? "wifi.slash" : "arrow.triangle.2.circlepath")
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            BatteryTabStrings.text(key, fallback)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Reusable chart panel (web `GlassPanel` + `SectionTitle`)

/// A frosted panel with a section heading and free-form content — the web `GlassPanel(p-4)` with a
/// `SectionTitle` header that every chart block uses.
struct BatteryPanel<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                BatteryTabStrings.text(titleKey, titleFallback)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Metric cards (web `MetricCard` ×5)

/// Maps the decorative metric tint to a shared status token (web `MetricCard color`).
extension BatteryMetricTone {
    var token: TSTone {
        switch self {
        case .success: .success
        case .info: .info
        case .warning: .warning
        case .accent: .accent
        }
    }
}

/// One metric card: a muted label, a large mono value with an optional unit subtitle, and a tinted
/// SF Symbol chip — the SwiftUI parity of the web `MetricCard`.
struct BatteryMetricCardView: View {
    let metric: BatteryMetric

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    BatteryTabStrings.text(metric.labelKey, metric.labelFallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: metric.systemImage, tone: metric.tone.token)
                }
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(verbatim: metric.value)
                        .font(Font.TS.title)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                    if !metric.subtitle.isEmpty {
                        Text(verbatim: metric.subtitle)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        let unit = metric.subtitle.isEmpty ? "" : " \(metric.subtitle)"
        return "\(metric.label) \(metric.value)\(unit)"
    }
}

/// The responsive metric-card grid (web `grid-cols-2 md:grid-cols-3 lg:grid-cols-5`).
struct BatteryMetricsGrid: View {
    let metrics: [BatteryMetric]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(metrics) { metric in
                BatteryMetricCardView(metric: metric)
            }
        }
    }
}

// MARK: - Loading / empty / error states

/// Skeleton chrome shown on the initial fetch (prompt "loading — skeleton chrome"): the five metric
/// tiles above the four chart blocks.
struct BatteryLoadingState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSStatGridSkeleton(count: 5)
            TSChartBlockSkeleton()
            TSChartBlockSkeleton()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(BatteryTabStrings.text("analytics.battery.loading", "Loading battery analytics"))
    }
}

/// The no-data state (web `EmptyState` inside a `GlassPanel`): a battery glyph + friendly message.
struct BatteryEmptyState: View {
    var body: some View {
        TSGlassPanel {
            TSEmptyState(
                title: BatteryTabStrings.label("analytics.battery.noData", "No battery trend data available"),
                systemImage: "minus.plus.batteryblock"
            )
            .frame(maxWidth: .infinity)
        }
    }
}

/// The query-failure state with a retry affordance (web `QueryError` equivalent), shown only when
/// there is no cached trend to fall back to.
struct BatteryErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                BatteryTabStrings.text("analytics.battery.errorTitle", "Couldn't load battery analytics")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                }
                TSButton(
                    BatteryTabStrings.label("analytics.battery.retry", "Retry"),
                    variant: .secondary,
                    size: .small,
                    action: onRetry
                )
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.sm)
        }
        .accessibilityElement(children: .contain)
    }
}
