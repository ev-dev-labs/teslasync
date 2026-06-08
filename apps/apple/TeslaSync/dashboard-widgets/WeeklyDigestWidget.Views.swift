//
//  WeeklyDigestWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0116 · WeeklyDigestWidget (Apple)
//
//  The presentational subviews composed by `WeeklyDigestWidget`: one comparison-metric row (label +
//  value + percent delta), the stale/offline connectivity banner, and the loading skeleton list. All
//  consume pre-projected rows + pre-localized strings (P1/S10) and the shared P1/S9 tokens — no
//  networking, no Tailwind.
//

import SwiftUI

// MARK: - Token bridges for the projected delta enums

extension WeeklyDigestDeltaDirection {
    /// The SF Symbol that stands in for the web `Delta` lucide arrow (ArrowUp / ArrowDown / ArrowRight).
    var systemImage: String {
        switch self {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .flat: "arrow.right"
        }
    }
}

extension WeeklyDigestDeltaTone {
    /// The semantic colour the web `colorForDelta` resolves (emerald / rose / muted), mapped to the
    /// shared P1/S9 status tokens.
    var color: Color {
        switch self {
        case .positive: Color.TS.statusSuccess
        case .negative: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Comparison metric row (web `WidgetComparisonCard` `MetricRow`)

/// One comparison row: the metric label over its current value (+ unit), with the direction-aware
/// percent delta trailing. Mirrors the web `MetricRow` (`label`, `formattedCurrent + unit`,
/// `<Delta percent>`).
struct WeeklyDigestMetricRowView: View {
    let row: WeeklyDigestMetricRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: row.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                valueLine
            }
            Spacer(minLength: TSSpacing.sm)
            deltaBadge
        }
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
    }

    /// The current value with an optional smaller, muted unit suffix (web value `<span>`).
    private var valueLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(verbatim: row.valueText)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            if let unit = row.unit, !unit.isEmpty {
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
    }

    /// The web `<Delta display="percent">` — arrow + |percent| (or em-dash) tinted by semantic tone.
    private var deltaBadge: some View {
        HStack(spacing: 3) {
            Image(systemName: row.deltaDirection.systemImage)
                .font(.system(size: 10, weight: .bold))
                .accessibilityHidden(true)
            Text(verbatim: row.deltaText)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(row.deltaTone.color)
        .layoutPriority(1)
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the card when the bound source is not live, so the cached
/// comparison is clearly labeled (web freshness-indicator intent).
struct WeeklyDigestConnectivityBanner: View {
    let connection: WeeklyDigestConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.weeklyDigest.offlineBanner" : "widget.weeklyDigest.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known digest"
            : "Reconnecting — digest may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: WeeklyDigestStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton list

/// The initial-fetch skeleton: a stack of shimmer rows matching the loaded card's rhythm (web
/// `WidgetShell` `loading`). Honors Reduce Motion via `TSSkeleton`.
struct WeeklyDigestLoadingRows: View {
    var rowCount = 4

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0 ..< rowCount, id: \.self) { index in
                HStack(spacing: TSSpacing.sm) {
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(width: 56, height: 9, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 92, height: 14, cornerRadius: TSRadius.sm)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 44, height: 12, cornerRadius: TSRadius.sm)
                }
                .padding(.vertical, TSSpacing.sm)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                if index < rowCount - 1 {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: WeeklyDigestStrings.string(
            "widget.weeklyDigest.loading",
            "Loading weekly digest"
        )))
    }
}
