//
//  XRayFieldsTable.Views.swift
//  TeslaSync — P4 feature view · 0034 · XRayFieldsTable (Apple)
//
//  The presentational pieces of the X-Ray fields surface: the sortable table itself
//  (a columnar grid on regular width, a card list on compact iPhone width — the same
//  responsive strategy as the shared `TSDataTable`, but selection-free to match the web
//  `XRayFieldsTable.tsx` which has no row selection), the per-cell views, the freshness chip,
//  and the connectivity banner. Composed from the shared design system + `TSBadge` atom.
//

import SwiftUI

// MARK: - Column layout

private enum XRayFieldsColumns {
    static let samplesWidth: CGFloat = 84
    static let lastSeenWidth: CGFloat = 104
    static let kindWidth: CGFloat = 92
    static let columnSpacing = TSSpacing.md
}

// MARK: - Sortable table

/// The sortable per-field table. Drives sorting through the injected `onSort` (the model's
/// `useSortToggle` parity), renders the model-sorted `rows`, and adapts between a columnar grid
/// (regular width) and a card list (compact width), mirroring the web table's `mobileColumns`
/// (field / samples / last seen; the kind column is hidden on compact).
struct XRayFieldsTableView: View {
    let rows: [XRayFieldRow]
    let sortKey: XRayFieldsSortKey
    let sortDirection: XRaySortDirection
    let onSort: (XRayFieldsSortKey) -> Void

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
        Group {
            if isCompact {
                compactList
            } else {
                regularTable
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: XRayFieldsAccessibility.summary(count: rows.count)))
    }

    // MARK: Regular (macOS / iPad) columnar layout

    private var regularTable: some View {
        VStack(spacing: 0) {
            XRayFieldsHeaderRow(sortKey: sortKey, sortDirection: sortDirection, onSort: onSort)
            Divider().overlay(Color.TS.border)
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(rows) { row in
                        XRayFieldsRegularRow(row: row)
                        Divider().overlay(Color.TS.border.opacity(0.5))
                    }
                }
            }
        }
    }

    // MARK: Compact (iPhone) card layout

    private var compactList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            XRayFieldsCompactSortBar(sortKey: sortKey, sortDirection: sortDirection, onSort: onSort)
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: TSSpacing.sm) {
                    ForEach(rows) { row in
                        XRayFieldsCompactCard(row: row)
                    }
                }
            }
        }
    }
}

// MARK: - Regular header

/// The sortable column-header row. Each header is a button that calls `onSort`; the active
/// column shows a direction chevron, mirroring the web sortable `DataTable` header.
struct XRayFieldsHeaderRow: View {
    let sortKey: XRayFieldsSortKey
    let sortDirection: XRaySortDirection
    let onSort: (XRayFieldsSortKey) -> Void

    var body: some View {
        HStack(spacing: XRayFieldsColumns.columnSpacing) {
            sortHeader("admin.xray.fields.cols.field", "Field", key: .field, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            sortHeader("admin.xray.fields.cols.count", "Samples", key: .sampleCount, alignment: .trailing)
                .frame(width: XRayFieldsColumns.samplesWidth, alignment: .trailing)
            sortHeader("admin.xray.fields.cols.lastSeen", "Last seen", key: .lastSeenAt, alignment: .leading)
                .frame(width: XRayFieldsColumns.lastSeenWidth, alignment: .leading)
            sortHeader("admin.xray.fields.cols.kind", "Kind", key: .valueKind, alignment: .leading)
                .frame(width: XRayFieldsColumns.kindWidth, alignment: .leading)
        }
        .padding(.vertical, TSSpacing.xs)
    }

    private func sortHeader(
        _ key: String,
        _ fallback: String,
        key sortColumn: XRayFieldsSortKey,
        alignment: HorizontalAlignment
    ) -> some View {
        let isActive = sortKey == sortColumn
        return Button {
            onSort(sortColumn)
        } label: {
            HStack(spacing: 2) {
                if alignment == .trailing { Spacer(minLength: 0) }
                XRayFieldsStrings.text(key, fallback)
                    .font(Font.TS.label)
                    .foregroundStyle(isActive ? Color.TS.accent : Color.TS.textSecondary)
                    .lineLimit(1)
                if isActive {
                    Image(systemName: sortDirection == .ascending ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color.TS.accent)
                }
                if alignment == .leading { Spacer(minLength: 0) }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(XRayFieldsStrings.text(key, fallback))
        .accessibilityValue(Text(verbatim: XRayFieldsAccessibility.sortValue(
            isActive: isActive,
            direction: sortDirection
        )))
        .accessibilityHint(XRayFieldsStrings.text("admin.xray.fields.a11y.sortHint", "Sorts the table by this column"))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Regular row

struct XRayFieldsRegularRow: View {
    let row: XRayFieldRow

    var body: some View {
        HStack(spacing: XRayFieldsColumns.columnSpacing) {
            XRayFieldNameText(field: row.field)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: row.samplesText)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .frame(width: XRayFieldsColumns.samplesWidth, alignment: .trailing)
            Text(verbatim: row.lastSeenText)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .frame(width: XRayFieldsColumns.lastSeenWidth, alignment: .leading)
            TSBadge(LocalizedStringKey(row.kindLabel), tone: .neutral)
                .frame(width: XRayFieldsColumns.kindWidth, alignment: .leading)
        }
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: XRayFieldsAccessibility.rowLabel(row)))
    }
}

// MARK: - Compact card + sort bar

struct XRayFieldsCompactCard: View {
    let row: XRayFieldRow

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    XRayFieldNameText(field: row.field)
                    Spacer(minLength: TSSpacing.sm)
                    TSBadge(LocalizedStringKey(row.kindLabel), tone: .neutral)
                }
                HStack(spacing: TSSpacing.md) {
                    compactStat("admin.xray.fields.cols.count", "Samples", value: row.samplesText)
                    compactStat("admin.xray.fields.cols.lastSeen", "Last seen", value: row.lastSeenText)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: XRayFieldsAccessibility.rowLabel(row)))
    }

    private func compactStat(_ key: String, _ fallback: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            XRayFieldsStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}

/// One row of the compact-width sort menu.
private struct XRaySortOption: Identifiable {
    let key: XRayFieldsSortKey
    let labelKey: String
    let fallback: String
    var id: XRayFieldsSortKey {
        key
    }
}

/// Compact-width sort control (a menu) — the iPhone equivalent of tapping a column header.
struct XRayFieldsCompactSortBar: View {
    let sortKey: XRayFieldsSortKey
    let sortDirection: XRaySortDirection
    let onSort: (XRayFieldsSortKey) -> Void

    private let options: [XRaySortOption] = [
        XRaySortOption(key: .field, labelKey: "admin.xray.fields.cols.field", fallback: "Field"),
        XRaySortOption(key: .sampleCount, labelKey: "admin.xray.fields.cols.count", fallback: "Samples"),
        XRaySortOption(key: .lastSeenAt, labelKey: "admin.xray.fields.cols.lastSeen", fallback: "Last seen"),
        XRaySortOption(key: .valueKind, labelKey: "admin.xray.fields.cols.kind", fallback: "Kind")
    ]

    var body: some View {
        Menu {
            ForEach(options) { option in
                Button {
                    onSort(option.key)
                } label: {
                    sortLabel(option)
                }
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.up.arrow.down").font(.system(size: 11, weight: .semibold))
                XRayFieldsStrings.text("admin.xray.fields.sortBy", "Sort").font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityLabel(XRayFieldsStrings.text("admin.xray.fields.a11y.sortMenu", "Sort fields"))
    }

    @ViewBuilder
    private func sortLabel(_ option: XRaySortOption) -> some View {
        if sortKey == option.key {
            Label {
                XRayFieldsStrings.text(option.labelKey, option.fallback)
            } icon: {
                Image(systemName: sortDirection == .ascending ? "chevron.up" : "chevron.down")
            }
        } else {
            XRayFieldsStrings.text(option.labelKey, option.fallback)
        }
    }
}

// MARK: - Shared cells / chips

/// The monospaced signal-field name cell (web `font-mono text-sm`).
struct XRayFieldNameText: View {
    let field: String

    var body: some View {
        Text(verbatim: field)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.middle)
    }
}

/// Freshness chip: a tone dot + label (Updating / Live / Stale / Offline).
struct XRayFreshnessChip: View {
    let connection: XRayFieldsConnection
    let isFetching: Bool

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var label: String {
        if isFetching {
            return XRayFieldsStrings.string("admin.xray.fields.updating", "Updating")
        }
        switch connection {
        case .live: return XRayFieldsStrings.string("admin.xray.fields.live", "Live")
        case .stale: return XRayFieldsStrings.string("admin.xray.fields.stale", "Stale")
        case .offline: return XRayFieldsStrings.string("admin.xray.fields.offline", "Offline")
        }
    }
}

/// Stale / offline banner shown above cached content.
struct XRayConnectivityBanner: View {
    let connection: XRayFieldsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.xray.fields.offlineBanner" : "admin.xray.fields.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded field statistics"
            : "Reconnecting — field statistics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            XRayFieldsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
