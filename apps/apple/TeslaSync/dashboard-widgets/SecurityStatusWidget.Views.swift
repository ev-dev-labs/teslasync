//
//  SecurityStatusWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0085 · SecurityStatusWidget (Apple)
//
//  The presentational subviews composed by `SecurityStatusWidget`: the
//  stale/offline connectivity banner, the two-column status grid (web
//  `WidgetStatusGrid`) with its friendly empty state, and the individual status
//  cell. All consume pre-localized strings from the P1/S10 facade and the shared
//  P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not
/// live, so cached values are clearly labeled (web freshness-indicator intent).
struct SecurityConnectivityBanner: View {
    let connection: SecurityConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.securityOfflineBanner" : "widget.securityStaleBanner"
        let fallback = isOffline
            ? "Offline — showing last known status"
            : "Reconnecting — status may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SecurityStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Status grid (web `WidgetStatusGrid`, cols = 2)

/// The fixed two-column grid of status cells — the native port of the web
/// `WidgetStatusGrid` invoked with `cols={2}`. Renders the friendly empty state
/// in place of a blank panel when there are no cells (web `cells.length === 0`).
struct SecurityStatusGrid: View {
    let cells: [SecurityStatusCell]

    private static let columns: [GridItem] = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]

    var body: some View {
        if cells.isEmpty {
            SecurityEmptyGrid()
        } else {
            LazyVGrid(columns: Self.columns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(cells) { cell in
                    SecurityStatusCellView(cell: cell)
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: SecurityAccessibility.gridSummary(
                for: cells,
                localize: SecurityStrings.string
            )))
        }
    }
}

/// The grid-level empty state (web `WidgetStatusGrid` `emptyMessage` "No security
/// data"). Always rendered in place of a blank panel.
struct SecurityEmptyGrid: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "shield.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: SecurityStrings.string("widget.noSecurity", "No security data"))
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
/// leading SF Symbol, the muted label, and the emphasized value — the native port
/// of the web cell markup, with the same `ok/warning/error/inactive` tinting.
struct SecurityStatusCellView: View {
    let cell: SecurityStatusCell

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
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: cell.systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 18, height: 18)
                .accessibilityHidden(true)
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
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
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
        .accessibilityLabel(Text(verbatim: SecurityAccessibility.cellSummary(
            for: cell,
            localize: SecurityStrings.string
        )))
    }
}
