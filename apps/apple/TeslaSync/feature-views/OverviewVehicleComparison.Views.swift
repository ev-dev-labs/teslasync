//
//  OverviewVehicleComparison.Views.swift
//  TeslaSync — P4 feature view · 0060 · OverviewVehicleComparison (Apple)
//
//  The panel-level SwiftUI leaves the surface composes: the section title (web
//  `SectionTitle`), the per-panel empty state (web `EmptyState`), the glass panel
//  wrapper (web `GlassPanel`), the loading skeleton, the four data panels (Fleet
//  Usage donut, Efficiency Leaderboard, Vehicle Comparison radar, Energy & Activity
//  bars), the stale / offline banner, and the retry button. Token-driven so the
//  surface stays self-contained, reusing the shared `TSGlassPanel`, `TSPieChart`,
//  `TSSkeleton`, and typography atoms.
//

import SwiftUI

// MARK: - Shared metrics

/// Fixed chart-area height shared by the data panels + their empty states so the
/// 2×2 grid stays visually balanced (the web charts use a 280px `height`).
enum OverviewMetrics {
    static let chartHeight: CGFloat = 240
}

// MARK: - Section title (port of the web `SectionTitle`)

/// A panel section title — the web `SectionTitle` (`text-sm font-semibold`),
/// resolved through this surface's i18n table and marked as an a11y header.
struct OverviewSectionTitle: View {
    let key: String
    let fallback: String

    var body: some View {
        OverviewComparisonStrings.text(key, fallback)
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Empty state (native counterpart of the web `EmptyState`)

/// A compact, centered empty state for a single panel — the native counterpart of
/// the web `EmptyState message=…`. Fills the chart area so a data-less panel is
/// never a blank box.
struct OverviewEmptyState: View {
    let messageKey: String
    let messageFallback: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
            OverviewComparisonStrings.text(messageKey, messageFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: OverviewMetrics.chartHeight)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Panel wrapper (web `GlassPanel` + `SectionTitle`)

/// A titled glass panel — the web `<GlassPanel><SectionTitle/>…</GlassPanel>`
/// block shared by all four sections.
struct OverviewPanel<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                OverviewSectionTitle(key: titleKey, fallback: titleFallback)
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Loading skeleton

/// One panel's loading skeleton: a title bar + a chart-area block, honoring the
/// shimmer's Reduce Motion behavior via the shared `TSSkeleton`.
struct OverviewPanelSkeleton: View {
    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 140, height: 14, cornerRadius: TSRadius.sm)
                TSSkeleton(height: OverviewMetrics.chartHeight, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(OverviewComparisonStrings.text("overview.loading", "Loading comparison"))
    }
}

// MARK: - Fleet Usage donut (web Pie panel)

/// The Fleet Usage panel: a donut of each vehicle's distance in the display unit,
/// or the "No vehicle data" empty state.
struct OverviewFleetUsagePanel: View {
    let vehicles: [OverviewVehicle]
    let unit: OverviewDistanceUnit

    private var slices: [OverviewUsageSlice] {
        OverviewComparisonBuilder.fleetUsage(vehicles, unit: unit)
    }

    var body: some View {
        OverviewPanel(titleKey: "analytics.overview.fleetUsage", titleFallback: "Fleet Usage") {
            if slices.isEmpty {
                OverviewEmptyState(messageKey: "analytics.overview.noVehicles", messageFallback: "No vehicle data")
            } else {
                TSPieChart(slices: slices.map(Self.slice))
                    .frame(height: OverviewMetrics.chartHeight)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: summary))
            }
        }
    }

    private var summary: String {
        OverviewComparisonAccessibility.fleetUsageSummary(slices, unit: unit)
    }

    private static func slice(_ slice: OverviewUsageSlice) -> TSChartSlice {
        TSChartSlice(
            id: String(slice.id),
            name: LocalizedStringKey(slice.name),
            nameText: slice.name,
            value: slice.value,
            colorIndex: slice.colorIndex
        )
    }
}

// MARK: - Efficiency Leaderboard (web leaderboard panel)

/// The Efficiency Leaderboard panel: ranked rows with a fill bar, or the "No
/// efficiency data" empty state.
struct OverviewLeaderboardPanel: View {
    let vehicles: [OverviewVehicle]
    let unit: OverviewDistanceUnit

    private var entries: [OverviewLeaderboardEntry] {
        OverviewComparisonBuilder.leaderboard(vehicles, unit: unit)
    }

    var body: some View {
        OverviewPanel(titleKey: "analytics.overview.effLeaderboard", titleFallback: "Efficiency Leaderboard") {
            if entries.isEmpty {
                OverviewEmptyState(
                    messageKey: "analytics.overview.noEfficiency",
                    messageFallback: "No efficiency data"
                )
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(entries) { entry in
                        OverviewLeaderboardRow(entry: entry)
                    }
                }
                .padding(.top, TSSpacing.xs)
            }
        }
    }
}

// MARK: - Vehicle Comparison radar (web RadarChart panel)

/// The Vehicle Comparison panel: a multi-vehicle radar when 2+ vehicles exist, or
/// the "Need 2+ vehicles for comparison" empty state.
struct OverviewComparisonRadarPanel: View {
    let vehicles: [OverviewVehicle]

    private var radar: [OverviewRadarVehicle] {
        OverviewComparisonBuilder.radarVehicles(vehicles)
    }

    var body: some View {
        OverviewPanel(titleKey: "analytics.overview.vehicleComparison", titleFallback: "Vehicle Comparison") {
            if radar.isEmpty {
                OverviewEmptyState(
                    messageKey: "analytics.overview.noComparison",
                    messageFallback: "Need 2+ vehicles for comparison"
                )
            } else {
                OverviewComparisonRadar(vehicles: radar)
            }
        }
    }
}

// MARK: - Energy & Activity bars (web BarChart panel)

/// The Energy & Activity panel: grouped energy + drive-count bars per vehicle, or
/// the "No vehicle data" empty state.
struct OverviewEnergyActivityPanel: View {
    let vehicles: [OverviewVehicle]

    private var bars: [OverviewActivityBar] {
        OverviewComparisonBuilder.energyActivity(vehicles)
    }

    var body: some View {
        OverviewPanel(titleKey: "analytics.overview.energyActivity", titleFallback: "Energy & Activity") {
            if bars.isEmpty {
                OverviewEmptyState(messageKey: "analytics.overview.noVehicles", messageFallback: "No vehicle data")
            } else {
                OverviewEnergyActivityChart(bars: bars)
            }
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// A tappable stale / offline banner shown above the grid when the live feed is not
/// fresh — taps refresh. Mirrors the cache-then-network freshness contract.
struct OverviewConnectivityBanner: View {
    let connection: OverviewConnection
    var updatedAt: Date?
    let onRefresh: () -> Void

    private var isOffline: Bool {
        connection == .offline
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                    .font(.system(size: 11, weight: .semibold))
                OverviewComparisonStrings.text(bannerKey, bannerFallback)
                    .font(Font.TS.caption)
                if let updatedAt {
                    Text(verbatim: "· \(OverviewComparisonBuilder.relativeTime(since: updatedAt))")
                        .font(Font.TS.caption)
                        .monospacedDigit()
                }
            }
            .foregroundStyle(tone)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(OverviewComparisonStrings.text("overview.refresh", "Refresh"))
        .accessibilityValue(OverviewComparisonStrings.text(bannerKey, bannerFallback))
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var bannerKey: String {
        isOffline ? "overview.offlineBanner" : "overview.staleBanner"
    }

    private var bannerFallback: String {
        isOffline ? "Offline — showing the last cached comparison" : "Reconnecting — comparison may be out of date"
    }
}

// MARK: - Retry button

/// A capsule retry affordance for the error state (refreshes via the model).
struct OverviewRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            OverviewComparisonStrings.text("overview.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(OverviewComparisonStrings.text("overview.retry", "Retry"))
    }
}
