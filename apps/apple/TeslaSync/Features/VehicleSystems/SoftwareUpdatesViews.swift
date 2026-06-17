//
//  SoftwareUpdatesViews.swift
//  TeslaSync — P4 feature view · P7 · SoftwareUpdates (Apple) — Shared UI + Summary
//
//  The shared HIG furniture (the `GlassPanel` peer, section title, status badge,
//  staleness chip) plus the three summary cards (web `MetricCard` ×3:
//  Current Version · Updates Installed · Total Updates). Materials stand in for
//  the web glass (ADR-005); chrome is design-token-driven (P2) and every visible
//  string resolves from the catalog.
//

import SwiftUI

// MARK: - Shared furniture (web `GlassPanel` / section title / `Badge`)

/// The frosted card that stands in for the web `GlassPanel`. Material glass +
/// a token border (ADR-005, P2).
struct SoftwareUpdatesCard<Content: View>: View {
    var padding: CGFloat = TSSpacing.x2xl
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg)
                    .stroke(Color.TS.border, lineWidth: 1)
            )
    }
}

/// Small semibold section heading (web `text-sm font-semibold text-[--text-primary]`).
struct SoftwareUpdatesSectionTitle: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Status pill (web `Badge variant=success|info|warning|neutral`).
struct SoftwareUpdatesBadge: View {
    let text: String
    let tone: SoftwareUpdateBadgeTone

    var body: some View {
        Text(text)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .foregroundStyle(tone.color)
            .background(tone.color.opacity(0.15), in: Capsule())
    }
}

/// A subtle chip surfaced when the last refresh is older than two minutes (ADR-013).
struct SoftwareUpdatesStalenessChip: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark")
            Text(String(localized: "translation.common.staleData", defaultValue: "Data may be out of date"))
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary cards (web `MetricCard` ×3)

/// The three summary metric cards (web `grid sm:grid-cols-3`): Current Version,
/// Updates Installed, Total Updates. Always rendered — never hidden when empty
/// (web shows "Unknown" / 0 while data is absent).
struct SoftwareUpdatesSummaryRow: View {
    let currentVersion: String
    let installedCount: Int
    let totalUpdates: Int

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) { cards }
            VStack(spacing: TSSpacing.lg) { cards }
        }
    }

    @ViewBuilder private var cards: some View {
        SoftwareUpdatesMetricCard(
            tone: .cyan,
            iconSystemName: "iphone",
            label: String(localized: "Current Version", defaultValue: "Current Version"),
            value: currentVersion
        )
        SoftwareUpdatesMetricCard(
            tone: .green,
            iconSystemName: "checkmark.circle",
            label: String(localized: "Updates Installed", defaultValue: "Updates Installed"),
            value: installedCount.formatted()
        )
        SoftwareUpdatesMetricCard(
            tone: .purple,
            iconSystemName: "arrow.down.circle",
            label: String(localized: "Total Updates", defaultValue: "Total Updates"),
            value: totalUpdates.formatted()
        )
    }
}

/// One summary metric card — the SwiftUI parity of `components/data-display/MetricCard`.
/// Icon box (tinted), a muted label and a bold value; purely presentational.
struct SoftwareUpdatesMetricCard: View {
    let tone: SoftwareUpdatesMetricTone
    let iconSystemName: String
    let label: String
    let value: String

    var body: some View {
        SoftwareUpdatesCard(padding: TSSpacing.xl) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Text(value)
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                Spacer(minLength: 0)
                iconBox
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(label): \(value)"))
    }

    private var iconBox: some View {
        Image(systemName: iconSystemName)
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(tone.color)
            .frame(width: 44, height: 44)
            .background(tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .accessibilityHidden(true)
    }
}
