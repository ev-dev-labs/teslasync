//
//  KpiOverviewCard.Views.swift
//  TeslaSync — P4 shared surface · 0093 · KpiOverviewCard (Apple)
//
//  The presentational subviews composed by `KpiOverviewCard`, reproducing the web
//  `KpiOverviewCard.tsx` body: the ComparisonHeader (title + period strip + optional headline delta +
//  the freshness affordance in the web `actions` slot), the responsive KPI grid of MetricCard-shaped
//  tiles, the muted secondary fold-down line, and the footer InlineCallout. All copy arrives either
//  pre-resolved from the host (titles / labels / values) or through the P1/S10 facade (the native
//  chrome); all colour comes from the P1/S9 tokens — no Tailwind ports, no raw hex. The headline /
//  per-tile deltas reuse the shared `TSDelta` atom; the panel reuses `TSGlassPanel` (web `GlassPanel`).
//

import SwiftUI

// MARK: - Header (web `<ComparisonHeader>`)

/// The section header — the title (compact uppercase, the web `text-sm font-semibold uppercase
/// tracking-wide`), the muted period strip beneath it, and the trailing cluster (the headline delta +
/// the freshness chip, occupying the web `actions` slot). The header keeps its frame across every
/// phase so the shell never reflows.
struct KpiOverviewHeaderView: View {
    let header: KpiOverviewResolvedHeader
    let connection: KpiOverviewConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: header.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if !header.periodText.isEmpty {
                    Text(verbatim: header.periodText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityLabel(Text(verbatim: header.periodAccessibilityLabel))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: TSSpacing.sm) {
                if let delta = header.delta {
                    TSDelta(value: delta.value, formatted: delta.formatted, invertColors: delta.lowerIsBetter)
                        .accessibilityLabel(Text(verbatim: header.deltaAccessibilityLabel ?? delta.formatted))
                }
                if connection != .live {
                    KpiOverviewFreshnessChip(connection: connection, onRefresh: onRefresh)
                }
            }
        }
    }
}

// MARK: - KPI grid + tile (web grid of `<MetricCard>`)

/// The responsive KPI grid — the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` rendered as an
/// adaptive `LazyVGrid` so the tiles reflow from two-up on compact width to many-up on regular width.
struct KpiOverviewGridView: View {
    let items: [KpiOverviewItem]

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: TSSpacing.md, alignment: .topLeading)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(items) { item in
                KpiOverviewTileView(item: item)
            }
        }
        .accessibilityIdentifier("kpiOverview-kpis")
    }
}

/// One KPI tile — the web `<MetricCard>`: a muted rounded panel with the label, the value, and an
/// optional per-tile delta. The label + value read as one VoiceOver phrase ("Drives, 4"); the delta is
/// a separate element with its direction spoken.
struct KpiOverviewTileView: View {
    let item: KpiOverviewItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: item.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            TSMetricValue(item.value)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let delta = item.delta {
                TSDelta(value: delta.value, formatted: delta.formatted, invertColors: delta.lowerIsBetter)
                    .accessibilityLabel(Text(verbatim: KpiOverviewAccessibility.deltaLabel(
                        delta, strings: KpiOverviewStrings.string
                    )))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: KpiOverviewAccessibility.itemLabel(
            label: item.label, value: item.value
        )))
    }
}

// MARK: - Secondary line (web muted fold-down stats)

/// The optional secondary fold-down stats line — the web `text-xs text-[var(--text-muted)]` row
/// (e.g. "Top speed 152 mph · Longest 29.1 mi · Avg trip 11.5 mi"). Caller-composed text, rendered
/// verbatim and muted.
struct KpiOverviewSecondaryView: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Footer callout (web `<InlineCallout>`)

/// The optional footer insight — the web `<InlineCallout>`: a single-line, low-chrome tinted row with
/// a leading severity icon, the message, and an optional trailing action affordance (label + chevron).
/// When an action handler is supplied it becomes a button (web clickable callout); otherwise it is a
/// status row (web `role="status"`).
struct KpiOverviewFooterView: View {
    let callout: KpiOverviewCallout
    let onAction: (() -> Void)?

    private var tone: TSTone {
        switch callout.tone {
        case .info: .info
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        }
    }

    private var systemImage: String {
        switch callout.tone {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "xmark.octagon.fill"
        }
    }

    private var accessibilityText: String {
        KpiOverviewAccessibility.calloutLabel(callout, strings: KpiOverviewStrings.string)
    }

    var body: some View {
        Group {
            if let onAction, callout.actionLabel != nil {
                Button(action: onAction) { row }
                    .buttonStyle(.plain)
            } else {
                row
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
        .accessibilityAddTraits((onAction != nil && callout.actionLabel != nil) ? .isButton : [])
    }

    private var row: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            Text(verbatim: callout.message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let actionLabel = callout.actionLabel {
                HStack(spacing: 2) {
                    Text(verbatim: actionLabel)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                }
                .foregroundStyle(tone.color)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            tone.color.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(tone.color.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown in the header trailing slot when the feed is not live — a coloured dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit spoken label.
struct KpiOverviewFreshnessChip: View {
    let connection: KpiOverviewConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: KpiOverviewStrings.string("kpiOverview.live", "Live")
        case .stale: KpiOverviewStrings.string("kpiOverview.stale", "Stale")
        case .offline: KpiOverviewStrings.string("kpiOverview.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            KpiOverviewStrings.string("kpiOverview.staleA11y", "Stale — tap to refresh")
        case .offline:
            KpiOverviewStrings.string("kpiOverview.offlineA11y", "Offline — showing the last known values")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
