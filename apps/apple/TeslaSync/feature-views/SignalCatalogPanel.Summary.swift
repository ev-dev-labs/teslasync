//
//  SignalCatalogPanel.Summary.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  The four summary StatCards above the catalog (web `showSummary` grid): Total
//  Signals, Active (<30s), Stale (>5min), Never Received. A 2-up grid on compact
//  iPhone width, 4-up on regular / macOS — the native idiom for the web
//  `grid-cols-2 sm:grid-cols-4`. Token-driven (P1/S9); no Tailwind ports.
//

import SwiftUI

// MARK: - Summary item (one StatCard's content)

/// One summary tile's resolved content: the localized label, the formatted count,
/// the SF Symbol glyph, and the semantic tone — built from the projection counts.
struct SignalCatalogPanelSummaryItem: Identifiable {
    let id: String
    let label: String
    let value: Int
    let systemImage: String
    let tone: Color

    /// The four tiles in web order (total, active, stale, never).
    static func all(from summary: SignalCatalogPanelSummary) -> [SignalCatalogPanelSummaryItem] {
        [
            SignalCatalogPanelSummaryItem(
                id: "total",
                label: SignalCatalogPanelStrings.summaryTotal,
                value: summary.total,
                systemImage: "arrow.up.arrow.down",
                tone: Color.TS.accent
            ),
            SignalCatalogPanelSummaryItem(
                id: "active",
                label: SignalCatalogPanelStrings.summaryActive,
                value: summary.active,
                systemImage: "arrow.clockwise",
                tone: Color.TS.statusSuccess
            ),
            SignalCatalogPanelSummaryItem(
                id: "stale",
                label: SignalCatalogPanelStrings.summaryStale,
                value: summary.stale,
                systemImage: "exclamationmark.triangle",
                tone: Color.TS.statusWarning
            ),
            SignalCatalogPanelSummaryItem(
                id: "never",
                label: SignalCatalogPanelStrings.summaryNever,
                value: summary.never,
                systemImage: "exclamationmark.triangle",
                tone: Color.TS.textMuted
            )
        ]
    }
}

// MARK: - Summary grid

/// The adaptive StatCard grid (web `grid-cols-2 sm:grid-cols-4`).
struct SignalCatalogPanelSummaryCards: View {
    let summary: SignalCatalogPanelSummary

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var columnCount: Int {
            horizontalSizeClass == .compact ? 2 : 4
        }
    #else
        private var columnCount: Int {
            4
        }
    #endif

    var body: some View {
        let items = SignalCatalogPanelSummaryItem.all(from: summary)
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
            count: columnCount
        )
        return LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(items) { item in
                SignalCatalogPanelStatCard(item: item)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - StatCard tile

/// One summary StatCard: a glyph + uppercase label and the large count value.
struct SignalCatalogPanelStatCard: View {
    let item: SignalCatalogPanelSummaryItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(item.tone)
                    .accessibilityHidden(true)
                Text(verbatim: item.label)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(TSTypeMetrics.labelTracking)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 0)
            }
            Text(verbatim: String(item.value))
                .font(Font.TS.title)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .fill(Color.TS.surfaceGlass)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(item.label), \(item.value)"))
    }
}
