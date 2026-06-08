//
//  LiveSignalsTable.Table.swift
//  TeslaSync — P4 feature view · 0036 · LiveSignalsTable (Apple)
//
//  The populated-table branch: the stale/offline connectivity banner and the
//  adaptive, sortable signal table. A columnar `Grid` on macOS / regular width and
//  a card list on compact iPhone width — the native idiom for the web `DataTable`
//  (sortable Signal / Last-update columns, a read-only Value column). The
//  filtered-empty and "Loading…" messages mirror the web `DataTable` emptyMessage.
//

import SwiftUI

// MARK: - Populated content (banner + table)

struct LiveSignalsTableContent: View {
    let model: LiveSignalsTableModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isCompact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var isCompact: Bool {
            false
        }
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                LiveSignalsConnectivityBanner(connection: model.connection)
            }
            table
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LiveSignalsTableStrings.tableLabel))
        .accessibilityValue(
            Text(verbatim: LiveSignalsTableAccessibility.gridSummary(rowCount: model.displayedRows.count))
        )
    }

    @ViewBuilder
    private var table: some View {
        if model.displayedRows.isEmpty {
            inlineMessage
        } else if isCompact {
            compactTable
        } else {
            regularTable
        }
    }

    /// Web `DataTable` emptyMessage: "Loading…" while fetching, else the filtered
    /// message. Shown when the filter (or an in-flight initial fetch) yields no rows.
    private var inlineMessage: some View {
        Text(verbatim: model.isFetching ? LiveSignalsTableStrings.tableLoading : LiveSignalsTableStrings.tableFiltered)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.xl)
    }

    private func relativeText(for row: LiveSignalRow) -> String? {
        guard let timestamp = row.timestamp else { return nil }
        return LiveSignalsTableFormat.relative(from: timestamp, to: Date(), locale: .current)
    }
}

// MARK: - Regular (macOS / iPad) columnar layout

extension LiveSignalsTableContent {
    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: 0) {
            GridRow {
                sortHeader(.name, LiveSignalsTableStrings.columnName)
                valueHeader
                sortHeader(.timestamp, LiveSignalsTableStrings.columnTimestamp)
            }
            .padding(.vertical, TSSpacing.sm)
            Divider().overlay(Color.TS.border).gridCellColumns(3)
            ForEach(model.displayedRows) { row in
                GridRow {
                    nameCell(row)
                    valueCell(row)
                    timeCell(row)
                }
                .padding(.vertical, TSSpacing.sm)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    Text(verbatim: LiveSignalsTableAccessibility.rowLabel(for: row, relative: relativeText(for: row)))
                )
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(3)
            }
        }
    }

    private var valueHeader: some View {
        Text(verbatim: LiveSignalsTableStrings.columnValue)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private func sortHeader(_ key: LiveSignalSortKey, _ title: String) -> some View {
        Button {
            model.toggleSort(key)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(TSTypeMetrics.labelTracking)
                    .foregroundStyle(Color.TS.textSecondary)
                if model.sortKey == key {
                    Image(systemName: model.sortDirection == .ascending ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(Color.TS.accent)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(Text(verbatim: sortStateLabel(for: key)))
        .accessibilityHint(Text(verbatim: LiveSignalsTableStrings.sortHint))
    }

    private func sortStateLabel(for key: LiveSignalSortKey) -> String {
        guard model.sortKey == key else { return "" }
        return model.sortDirection == .ascending
            ? LiveSignalsTableStrings.sortedAscending
            : LiveSignalsTableStrings.sortedDescending
    }
}

// MARK: - Compact (iPhone) card layout

extension LiveSignalsTableContent {
    private var compactTable: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                sortHeader(.name, LiveSignalsTableStrings.columnName)
                sortHeader(.timestamp, LiveSignalsTableStrings.columnTimestamp)
                Spacer(minLength: 0)
            }
            LazyVStack(spacing: TSSpacing.sm) {
                ForEach(model.displayedRows) { row in
                    card(row)
                }
            }
        }
    }

    private func card(_ row: LiveSignalRow) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            nameCell(row)
            HStack(alignment: .firstTextBaseline) {
                valueCell(row)
                Spacer(minLength: TSSpacing.sm)
                timeCell(row)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: LiveSignalsTableAccessibility.rowLabel(for: row, relative: relativeText(for: row)))
        )
    }
}

// MARK: - Shared cells

extension LiveSignalsTableContent {
    private func nameCell(_ row: LiveSignalRow) -> some View {
        Text(verbatim: row.name)
            .font(.system(.callout, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func valueCell(_ row: LiveSignalRow) -> some View {
        Text(verbatim: row.valueText)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    @ViewBuilder
    private func timeCell(_ row: LiveSignalRow) -> some View {
        if let relative = relativeText(for: row) {
            Text(verbatim: relative)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        } else {
            Text(verbatim: "—")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the table when the live stream is not
/// fresh — the feature-level analogue of the web `LiveIndicator` freshness.
struct LiveSignalsConnectivityBanner: View {
    let connection: LiveSignalsTableConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: isOffline ? LiveSignalsTableStrings.offlineBanner : LiveSignalsTableStrings.staleBanner)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var isOffline: Bool {
        connection == .offline
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }
}
