//
//  SuperchargerHistoryWidget.RankedList.swift
//  TeslaSync — P4 dashboard widget · 0098 · SuperchargerHistoryWidget (Apple)
//
//  The native subviews that compose the surface: the freshness chip (web
//  `DataFreshness`), the sessions ranked list (web `WidgetRankedList`) with its
//  per-row energy value + cost badge, the 30-day totals row, and the compact
//  spend hero (web `WidgetBigNumber`). They lean on the shared design tokens so
//  they read identically to the rest of the app.
//

import SwiftUI

// MARK: - Freshness chip (web `DataFreshness`)

/// The live / stale / offline freshness chip shown in the header, mirroring the
/// shared `DataFreshness` dot the web `WidgetShell` renders.
struct SuperchargerFreshnessChip: View {
    let connection: SuperchargerHistoryConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SuperchargerHistoryStrings.string("widget.superchargerHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SuperchargerHistoryStrings.string("widget.superchargerHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SuperchargerHistoryStrings.string("widget.superchargerHistory.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Connectivity banner (web stale / offline shell states)

/// The stale / offline banner shown above the list when the feed is not live,
/// so cached sessions stay visible with an honest freshness cue.
struct SuperchargerConnectivityBanner: View {
    let connection: SuperchargerHistoryConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline
            ? "widget.superchargerHistory.offlineBanner"
            : "widget.superchargerHistory.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last synced sessions"
            : "Reconnecting — sessions may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SuperchargerHistoryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Cost badge (web `Badge` variant="neutral")

/// The per-session cost chip — the native port of the web row `badge`
/// (`{ text: formatCurrency(cost), variant: 'neutral' }`). Only shown when the
/// session has a positive cost.
struct SuperchargerCostBadge: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Sessions ranked list (web `WidgetRankedList`)

/// The Supercharger sessions ranked list — a native port of the web
/// `WidgetRankedList`. The rows arrive already sorted + sliced by the adapter;
/// this view sizes each row's relative background bar against the visible
/// maximum.
struct SuperchargerRankedList: View {
    let items: [SuperchargerRankedItem]
    let maxValue: Double

    var body: some View {
        ScrollView {
            LazyVStack(spacing: TSSpacing.xs) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    SuperchargerRankedRow(
                        rank: index + 1,
                        item: item,
                        fraction: maxValue > 0 ? item.value / maxValue : 0
                    )
                }
            }
        }
    }
}

/// One session row: rank · site name · "42.6 kWh" + optional "$12.50" chip, over
/// a relative-width background bar (web `bg-yellow-400` at 15% opacity). Honors
/// the web 44pt minimum hit target.
struct SuperchargerRankedRow: View {
    let rank: Int
    let item: SuperchargerRankedItem
    let fraction: Double

    var body: some View {
        ZStack(alignment: .leading) {
            if fraction > 0 {
                GeometryReader { proxy in
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .fill(Color.TS.chartSeriesEnergy.opacity(0.15))
                        .frame(width: max(0, proxy.size.width * fraction))
                }
                .accessibilityHidden(true)
            }
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: "\(rank)")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 20, alignment: .trailing)
                Text(verbatim: item.label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let badge = item.badge {
                    SuperchargerCostBadge(text: badge)
                }
                Text(verbatim: item.formattedValue)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        let rankPart = SuperchargerHistoryStrings.count("widget.superchargerHistory.rankA11y", "Rank %lld", rank)
        let badgePart = item.badge.map { ". \($0)" } ?? ""
        return "\(rankPart). \(item.label). \(item.formattedValue)\(badgePart)"
    }
}

// MARK: - Totals row (web `30-day totals` footer)

/// The footer totals row — the web `border-t` summary: a muted "30-day totals"
/// label with the rolling energy + spend on the trailing edge.
struct SuperchargerTotalsRow: View {
    let energyText: String
    let spendText: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            SuperchargerHistoryStrings.text("widget.superchargerHistory.totals", "30-day totals")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: energyText)
                Text(verbatim: spendText)
            }
            .font(Font.TS.bodySm)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.top, TSSpacing.sm)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.TS.border).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Compact spend hero (web `WidgetBigNumber`)

/// The compact layout's 30-day Supercharger spend hero — the native port of the
/// web `WidgetBigNumber` (`value={totalSpend} unit="$"
/// label="30-day Supercharger"`). Animates value changes and honors Reduce
/// Motion.
struct SuperchargerSpendHero: View {
    let unit: String
    let number: String
    let label: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(verbatim: unit)
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: number)
                    .font(Font.TS.display)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: number)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label). \(unit)\(number)"))
    }
}
