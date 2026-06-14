//
//  WidgetRankedList.Views.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  The presentational pieces of the ranked list — the native peers of the web elements: the ordered list
//  (web `<ul className="flex flex-col gap-1">`), the ranked row (web `<li>`: the muted rank number, the
//  optional magnitude bar behind the content, the truncated label, the optional badge chip, and the bold
//  tabular value), the badge chip (web `<Badge size="sm">`), and the freshness chip (P4 connectivity axis).
//  All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. Each row folds its rank / label /
//  value / badge into a single VoiceOver element; the magnitude bar is decorative and hidden from VoiceOver.
//

import SwiftUI

// MARK: - Tone bridges (web `barColor` / `badge.variant` → P1/S9 token)

extension RankedBarTone {
    /// The shared `TSTone` for the bar tint — the theme-aware projection of the web `barColor` class.
    var tsTone: TSTone {
        switch self {
        case .accent: .accent
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .info: .info
        case .neutral: .neutral
        }
    }

    /// The resolved bar color — reads from the design system so it recolors across light / dark /
    /// high-contrast (web bar uses `opacity-15`, applied at the call site).
    var color: Color {
        tsTone.color
    }
}

extension RankedBadgeTone {
    /// The shared `TSTone` for the badge tint — the native peer of the web `badgeVariantMap` (`success →
    /// success`, `warning → warning`, `error → danger`, `neutral → neutral`).
    var tsTone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .error: .danger
        case .neutral: .neutral
        }
    }
}

// MARK: - Ranked list (web `<ul>`)

/// The ordered list — the data render of the surface. Maps the arranged rows to ranked rows, exactly as
/// the web body maps each visible item to an `<li>`. The condensed inter-row gap mirrors the web
/// `flex flex-col gap-1`.
struct WidgetRankedListView: View {
    let rows: [RankedListRow]
    let hideBars: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(rows) { row in
                RankedListRowView(row: row, hideBars: hideBars)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Ranked row (web `<li>`)

/// A single ranked row — the native peer of the web `<li>`: the optional magnitude bar drawn behind the
/// content (web absolute background bar, `opacity-15`, width `barPct%`), the muted right-aligned rank
/// number (web `index + 1`), the truncated label, the optional trailing badge chip, and the bold tabular
/// value. The whole row is one VoiceOver element reading "Rank {rank}: {label}, {value}[, {badge}]"; the
/// bar is decorative and hidden.
struct RankedListRowView: View {
    let row: RankedListRow
    let hideBars: Bool

    private var rowShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: String(row.rank))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
                .frame(width: 20, alignment: .trailing)
                .accessibilityHidden(true)

            Text(verbatim: row.item.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let badge = row.item.badge {
                RankedListBadgeChip(badge: badge)
                    .accessibilityHidden(true)
            }

            Text(verbatim: row.item.formattedValue)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .monospacedDigit()
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44)
        .background(alignment: .leading) { barBackground }
        .clipShape(rowShape)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// The magnitude bar drawn behind the content — the native peer of the web absolute background bar.
    /// Hidden when `hideBars` (web `compact || !showBars`); otherwise a token-tinted fill at 15% opacity
    /// (web `opacity-15`) whose width is the row's `barFraction` of the available width.
    @ViewBuilder
    private var barBackground: some View {
        if !hideBars, row.barFraction > 0 {
            GeometryReader { geometry in
                rowShape
                    .fill(row.item.barTone.color.opacity(0.15))
                    .frame(width: geometry.size.width * row.barFraction)
            }
            .accessibilityHidden(true)
        }
    }

    /// The combined VoiceOver reading — "Rank {rank}: {label}, {value}" with the badge appended when present.
    private var accessibilityLabel: String {
        let base = WidgetRankedListStrings.rowAccessibilityLabel(
            rank: row.rank,
            label: row.item.label,
            value: row.item.formattedValue
        )
        guard let badge = row.item.badge, !badge.text.isEmpty else { return base }
        return WidgetRankedListStrings.rowWithBadge(base: base, badge: badge.text)
    }
}

// MARK: - Badge chip (web `<Badge size="sm">`)

/// The trailing badge chip — the native peer of the web `<Badge variant size="sm">{badge.text}>`. A
/// caller-supplied, already-localized runtime string rendered verbatim inside a token-tinted capsule, so it
/// recolors across light / dark / high-contrast. Mirrors the shared `TSBadge` styling at the condensed
/// `sm` size.
struct RankedListBadgeChip: View {
    let badge: RankedBadge

    private var tint: Color {
        badge.tone.tsTone.color
    }

    var body: some View {
        Text(verbatim: badge.text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tint)
            .lineLimit(1)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tint.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
            .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown above the list when the data is not live — a coloured dot + a label (`Stale` /
/// `Offline`). It is a button so VoiceOver and pointer users can re-request the data, with an explicit
/// spoken label.
struct WidgetRankedListFreshnessChip: View {
    let connection: WidgetRankedListConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: WidgetRankedListStrings.freshnessLabel(connection))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: WidgetRankedListStrings.freshnessAccessibility(connection)))
    }
}
