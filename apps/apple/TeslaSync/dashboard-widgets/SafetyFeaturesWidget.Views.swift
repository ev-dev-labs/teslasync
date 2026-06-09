//
//  SafetyFeaturesWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0083 · SafetyFeaturesWidget (Apple)
//
//  The presentational subviews composed by `SafetyFeaturesWidget`: the
//  stale/offline connectivity banner, the responsive status grid (web
//  `WidgetStatusGrid`, 2 or 4 columns) with its friendly empty state, the
//  individual status cell, and the compact active-feature hero (web compact
//  big-number branch). All consume pre-localized strings from the P1/S10 facade
//  and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not
/// live, so cached values are clearly labeled (web freshness-indicator intent).
struct SafetyConnectivityBanner: View {
    let connection: SafetyConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.safety.offlineBanner" : "widget.safety.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known status"
            : "Reconnecting — status may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SafetyStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Compact active-feature hero (web compact big-number branch)

/// The 1-column compact body: the active-feature count as a large emerald number
/// over a muted "Active Features" caption — the native port of the web
/// `size.cols <= 1` branch (`text-3xl font-bold text-emerald-300` + caption).
struct SafetyActiveCountHero: View {
    let count: Int

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: count.formatted())
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(Color.TS.statusSuccess)
                .monospacedDigit()
                .contentTransition(.numericText())
            SafetyStrings.text("widget.safety.activeFeatures", "Active Features")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SafetyAccessibility.activeCountSummary(
            count,
            localize: SafetyStrings.string
        )))
    }
}

// MARK: - Status grid (web `WidgetStatusGrid`, cols = 2 or 4)

/// The responsive grid of status cells — the native port of the web
/// `WidgetStatusGrid`. `columnCount` is 2 (web `size.cols < 3`) or 4 (web
/// `size.cols >= 3`). Renders the friendly empty state in place of a blank panel
/// when there are no cells (web `cells.length === 0`).
struct SafetyStatusGrid: View {
    let cells: [SafetyStatusCell]
    let columnCount: Int

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm),
            count: max(1, columnCount)
        )
    }

    var body: some View {
        if cells.isEmpty {
            SafetyEmptyGrid()
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(cells) { cell in
                    SafetyStatusCellView(cell: cell)
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: SafetyAccessibility.gridSummary(
                for: cells,
                localize: SafetyStrings.string
            )))
        }
    }
}

/// The grid-level empty state (web `WidgetStatusGrid` `emptyMessage` "No safety
/// data"). Always rendered in place of a blank panel.
struct SafetyEmptyGrid: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.shield.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: SafetyStrings.string("widget.safety.noData", "No safety data"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - One status cell (web `WidgetStatusGrid` cell)

/// A single status cell: a tinted rounded container with a corner status dot, the
/// muted label, and the emphasized value — the native port of the web cell markup
/// (which carries no leading icon for Safety), with the same `ok/inactive/unknown`
/// tinting from the web `statusStyles` table.
struct SafetyStatusCellView: View {
    let cell: SafetyStatusCell

    private var fill: Color {
        cell.status.isTinted
            ? cell.status.tone.color.opacity(0.10)
            : Color.TS.textMuted.opacity(0.08)
    }

    private var stroke: Color {
        cell.status.isTinted
            ? cell.status.tone.color.opacity(0.20)
            : Color.TS.border
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: cell.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(verbatim: cell.value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44, alignment: .leading)
        .background(fill, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(stroke, lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(cell.status.tone.color)
                .frame(width: 8, height: 8)
                .padding(TSSpacing.sm)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SafetyAccessibility.cellSummary(
            for: cell,
            localize: SafetyStrings.string
        )))
    }
}
