//
//  ChargingTab.Views.swift
//  TeslaSync — P4 feature view · 0054 · ChargingTab (Apple)
//
//  The presentational chrome composed by `ChargingTab`: the freshness chip, the stale/offline
//  connectivity banner, the glass section panel (web `GlassPanel` + `SectionTitle`), the six
//  summary cards + their responsive grid (web `MetricCard` ×6), the per-chart empty row (web
//  `EmptyState`), the initial-load skeleton, and the shared error state (web `QueryError`). All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports. The three chart panels live in `ChargingTab.Charts.swift`.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ChargingTabFreshnessChip: View {
    let connection: ChargingTabConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ChargingTabStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChargingTabStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: ChargingTabConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "analytics.charging.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "analytics.charging.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "analytics.charging.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached
/// cards/charts are clearly labeled while reconnecting / offline (web `DataFreshness` intent).
struct ChargingTabConnectivityBanner: View {
    let connection: ChargingTabConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "analytics.charging.offlineBanner" : "analytics.charging.staleBanner"
        let fallback = offline
            ? "Offline — showing last known charging analytics"
            : "Reconnecting — charging analytics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ChargingTabStrings.text(key, fallback).font(Font.TS.caption)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Section panel (web `GlassPanel` + `SectionTitle`)

/// A glass section card with a heading above its content, the native parity of the web
/// `<GlassPanel className="p-4">` wrapping a `<SectionTitle>`.
struct ChargingTabGlassPanel<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ChargingTabStrings.text(titleKey, titleFallback)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Summary card (web `MetricCard`)

/// One summary card — the native parity of the web `<MetricCard label value subtitle icon
/// color />`: a muted label, a bold monospaced value, an optional unit subtitle, and a tinted
/// SF Symbol glyph in a rounded chip (web `c.bg`/`c.ring`/`c.text`). The whole card is one
/// VoiceOver element reading "{label}: {value} {subtitle}".
struct ChargingTabSummaryCard: View {
    let label: String
    let value: String
    var subtitle: String?
    let systemImage: String
    let tint: Color

    private var a11yLabel: String {
        ChargingTabAccessibility.summaryCardLabel(label: label, value: value, subtitle: subtitle)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
                .accessibilityHidden(true)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: a11yLabel))
    }
}

// MARK: - Summary grid (web `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6`)

/// The responsive six-card grid above the charts. The cards always render (web parity — they are
/// never gated on data), showing zeros when no totals exist and an em dash for an absent average.
struct ChargingTabSummaryGrid: View {
    let metrics: ChargingTabSummaryMetrics
    let localize: (String, String) -> String
    let formatting: any ChargingTabFormatting

    private static let emDash = "—"
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    private func averageValue(_ value: Double?, decimals: Int) -> String {
        guard let value else { return Self.emDash }
        return formatting.formatNumber(value, decimals: decimals)
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ChargingTabSummaryCard(
                label: localize("analytics.charging.sessions", "Sessions"),
                value: formatting.formatInt(metrics.sessions),
                systemImage: "powerplug.fill",
                tint: Color.TS.accent
            )
            ChargingTabSummaryCard(
                label: localize("analytics.charging.totalEnergy", "Total Energy"),
                value: formatting.formatNumber(metrics.energyKwh, decimals: 1),
                subtitle: "kWh",
                systemImage: "bolt.fill",
                tint: Color.TS.statusSuccess
            )
            ChargingTabSummaryCard(
                label: localize("analytics.charging.totalCost", "Total Cost"),
                value: formatting.formatCurrency(metrics.totalCost, decimals: 2),
                systemImage: "dollarsign.circle.fill",
                tint: Color.TS.statusWarning
            )
            ChargingTabSummaryCard(
                label: localize("analytics.charging.avgPower", "Avg Power"),
                value: averageValue(metrics.avgPower, decimals: 1),
                subtitle: "kW",
                systemImage: "gauge.medium",
                tint: Color.TS.chartSeriesPower
            )
            ChargingTabSummaryCard(
                label: localize("analytics.charging.avgDuration", "Avg Duration"),
                value: averageValue(metrics.avgDuration, decimals: 0),
                subtitle: localize("analytics.charging.min", "min"),
                systemImage: "timer",
                tint: Color.TS.accent
            )
            ChargingTabSummaryCard(
                label: localize("analytics.charging.chargeEff", "Charge Efficiency"),
                value: averageValue(metrics.avgEfficiency, decimals: 1),
                subtitle: "%",
                systemImage: "chart.line.uptrend.xyaxis",
                tint: Color.TS.statusSuccess
            )
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Per-chart empty row (web `EmptyState`)

/// A centered, muted empty row a chart panel shows when its series is absent (web
/// `<EmptyState message=… />`). Sized so the panel never collapses to a blank box.
struct ChargingTabEmptyRow: View {
    let key: String
    let fallback: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.slash")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ChargingTabStrings.text(key, fallback)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChargingTabStrings.text(key, fallback))
    }
}

// MARK: - Initial-load skeleton (web `<Skeleton>`)

/// The initial-fetch skeleton chrome shown before the first payload: a redacted row of cards
/// above two redacted chart panels, respecting Reduce Motion (the shimmer is owned by
/// `TSSkeleton`).
struct ChargingTabLoadingPanels: View {
    private let cardColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            LazyVGrid(columns: cardColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        TSSkeleton(width: 70, height: 10)
                        TSSkeleton(width: 100, height: 20)
                    }
                    .padding(TSSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
                }
            }
            ForEach(0 ..< 2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSSkeleton(width: 180, height: 16)
                    TSSkeleton(height: 220)
                }
                .padding(TSSpacing.lg)
                .tsGlassPanel()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(ChargingTabStrings.text("analytics.charging.loading", "Loading charging analytics"))
    }
}

// MARK: - Error state (web `QueryError`)

/// The whole-surface error state with a retry affordance (web `QueryError`), shown when the
/// analytics query failed and there is no cached payload to keep on screen.
struct ChargingTabErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ChargingTabStrings.text("analytics.charging.errorTitle", "Couldn't load charging analytics")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                ChargingTabStrings.text("analytics.charging.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargingTabStrings.text("analytics.charging.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}
