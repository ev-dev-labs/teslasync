//
//  CostForecastSection.Views.swift
//  TeslaSync — P4 feature view · 0109 · CostForecastSection (Apple)
//
//  The presentational subviews composed by `CostForecastSection`: the panel shell
//  (web `GlassPanel` + `SectionTitle`, with the optional leading `TrendingUp`
//  icon), the two chart panels (each shows its chart or its own `EmptyState`,
//  matching the web), the per-panel empty state (web `EmptyState`), the freshness
//  banner (stale / offline), the hard-error state (web `QueryError`), and the
//  loading skeleton. All consume pre-localized strings from the P1/S10 facade + the
//  shared P1/S9 tokens — no Tailwind ports.
//

import SwiftUI

// MARK: - Panel shell (web `GlassPanel` + `SectionTitle`)

/// A small semibold section title (web `<h3 class="text-sm font-semibold
/// text-white">`) with an optional leading icon (web `<TrendingUp/>`), marked as an
/// accessibility header.
struct CostForecastSectionTitle: View {
    let title: String
    var systemImage: String?
    var iconColor: Color = CostForecastPalette.projected

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(Font.TS.body)
                    .foregroundStyle(iconColor)
                    .accessibilityHidden(true)
            }
            Text(verbatim: title)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// One glass panel with a title (and optional icon) above its content (web
/// `<GlassPanel className="p-6">` with an `<h3>` header). The panel never hides —
/// content vs. empty is the caller's decision inside `content`.
struct CostForecastPanel<Content: View>: View {
    let title: String
    var systemImage: String?
    var iconColor: Color = CostForecastPalette.projected
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            CostForecastSectionTitle(title: title, systemImage: systemImage, iconColor: iconColor)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }
}

/// The per-panel empty state (web `<EmptyState message=… />`) — a friendly,
/// never-blank fallback shown when a panel's source data is insufficient.
struct CostForecastEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "chart.line.uptrend.xyaxis")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }
}

// MARK: - The two chart panels (web's two `<GlassPanel>` blocks)

/// The "Cost Forecast" panel (web first `GlassPanel`): the `TrendingUp` title and,
/// when there are ≥ 3 historical months and a forecast, the composed forecast
/// chart; otherwise the `needData` empty state.
struct ForecastChartPanel: View {
    let chart: ForecastChartModel
    let hasForecast: Bool
    let localize: (String, String) -> String
    let formatting: any CostForecastFormatting

    var body: some View {
        CostForecastPanel(
            title: localize("costAnalysis.forecast.title", "Cost Forecast"),
            systemImage: "chart.line.uptrend.xyaxis",
            iconColor: CostForecastPalette.projected
        ) {
            if hasForecast {
                CostForecastChart(chart: chart, localize: localize, formatting: formatting)
            } else {
                CostForecastEmptyState(
                    message: localize(
                        "costAnalysis.forecast.needData",
                        "Need at least 3 months of charging data for cost forecasting."
                    )
                )
            }
        }
    }
}

/// The "Cost per kWh Trend" panel (web third `GlassPanel`): when there is more than
/// one historical month, the cost-per-kWh line chart; otherwise the `needTrendData`
/// empty state.
struct CostPerKwhPanel: View {
    let points: [CostPerKwhPoint]
    let upperBound: Double
    let hasTrend: Bool
    let localize: (String, String) -> String
    let formatting: any CostForecastFormatting

    var body: some View {
        CostForecastPanel(title: localize("costAnalysis.forecast.costPerKwhTrend", "Cost per kWh Trend")) {
            if hasTrend {
                CostForecastSectionPerKwhChart(
                    points: points,
                    upperBound: upperBound,
                    localize: localize,
                    formatting: formatting
                )
            } else {
                CostForecastEmptyState(
                    message: localize(
                        "costAnalysis.forecast.needTrendData",
                        "Need at least 2 months of charging data to show the cost per kWh trend."
                    )
                )
            }
        }
    }
}

// MARK: - Freshness banner (native chrome for stale / offline)

/// The freshness banner shown above the panels when the feed is stale or offline.
/// Cached data stays visible; the banner offers a manual refresh.
struct CostForecastFreshnessBanner: View {
    let connection: CostForecastConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("costAnalysis.forecast.offlineBanner", "Offline — showing the last known cost forecast")
            : ("costAnalysis.forecast.staleBanner", "Reconnecting — the cost forecast may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            CostForecastStrings.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                CostForecastStrings.text("costAnalysis.forecast.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CostForecastStrings.text("costAnalysis.forecast.refresh", "Refresh"))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Hard-error state (web `QueryError`)

/// The hard-error state shown when the feed fails with nothing cached to render
/// (web `QueryError`): an icon, title, the technical message, and a retry action.
struct CostForecastErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CostForecastStrings.text("costAnalysis.forecast.errorTitle", "Couldn't load the cost forecast")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                onRetry()
            } label: {
                CostForecastStrings.text("costAnalysis.forecast.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CostForecastStrings.text("costAnalysis.forecast.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: two redacted panels matching the loaded layout
/// so the transition is stable.
struct CostForecastSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            panelSkeleton(chartHeight: 300)
            panelSkeleton(chartHeight: 200)
        }
        .accessibilityElement()
        .accessibilityLabel(CostForecastStrings.text(
            "costAnalysis.forecast.loading",
            "Loading the cost forecast"
        ))
    }

    private func panelSkeleton(chartHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 160, height: 14)
            TSSkeleton(height: chartHeight)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }
}
