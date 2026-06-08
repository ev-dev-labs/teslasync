//
//  WhyEndedPanel.Table.swift
//  TeslaSync — P4 feature view · 0152 · WhyEndedPanel (Apple)
//
//  The signal-window table — the native idiom for the web `DataTable` (Timestamp /
//  Field / Value columns, pagination 25/[25,50,100], mobileColumns ts/field/value).
//  A columnar SwiftUI `Grid` on macOS / regular width and a card list on compact
//  iPhone width, with a page-size + prev/next pager below. Consumes the P1/S10
//  facade + the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Adaptive table (web `DataTable`)

/// The adaptive signal table (web `DataTable`): a columnar `Grid` on macOS /
/// regular width and a card list on compact iPhone width, with the page-size +
/// prev/next pager below (web pagination contract).
struct WhyEndedSignalTable: View {
    let model: WhyEndedPanelModel

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
            if isCompact {
                compactList
            } else {
                regularTable
            }
            WhyEndedSignalPager(model: model)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Regular (macOS / iPad) columnar layout

extension WhyEndedSignalTable {
    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: 0) {
            GridRow {
                columnHeader(WhyEndedPanelStrings.columnTimestamp)
                columnHeader(WhyEndedPanelStrings.columnField)
                columnHeader(WhyEndedPanelStrings.columnValue)
            }
            .padding(.vertical, TSSpacing.sm)
            Divider().overlay(Color.TS.border).gridCellColumns(3)
            ForEach(model.pagedSignals) { row in
                GridRow {
                    timeText(row)
                    fieldText(row)
                    valueText(row)
                }
                .padding(.vertical, TSSpacing.sm)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: WhyEndedPanelAccessibility.signalRowLabel(for: row)))
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(3)
            }
        }
    }

    private func columnHeader(_ title: String) -> some View {
        Text(verbatim: title)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: Compact (iPhone) card layout

extension WhyEndedSignalTable {
    private var compactList: some View {
        LazyVStack(spacing: TSSpacing.sm) {
            ForEach(model.pagedSignals) { row in
                card(row)
            }
        }
    }

    private func card(_ row: WhyEndedSignalRow) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                fieldText(row)
                Spacer(minLength: TSSpacing.sm)
                timeText(row)
            }
            valueText(row)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: WhyEndedPanelAccessibility.signalRowLabel(for: row)))
    }
}

// MARK: Shared cells

extension WhyEndedSignalTable {
    private func timeText(_ row: WhyEndedSignalRow) -> some View {
        Text(verbatim: row.timestampText)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
    }

    private func fieldText(_ row: WhyEndedSignalRow) -> some View {
        Text(verbatim: row.field)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func valueText(_ row: WhyEndedSignalRow) -> some View {
        Text(verbatim: row.value)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

// MARK: - Signal pager (web DataTable pagination)

/// The signal table's pager: a rows-per-page menu (web `pageSizeOptions`), a
/// "Page X of Y" readout, and prev/next controls (disabled at the bounds).
struct WhyEndedSignalPager: View {
    let model: WhyEndedPanelModel

    private var pageCount: Int {
        model.signalPageCount
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            pageSizeMenu
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: WhyEndedPanelStrings.pageStatus(page: model.signalPage + 1, count: pageCount))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
            stepButton(
                systemImage: "chevron.left",
                label: WhyEndedPanelStrings.previousPage,
                enabled: model.signalPage > 0
            ) {
                model.goToSignalPage(model.signalPage - 1)
            }
            stepButton(
                systemImage: "chevron.right",
                label: WhyEndedPanelStrings.nextPage,
                enabled: model.signalPage < pageCount - 1
            ) {
                model.goToSignalPage(model.signalPage + 1)
            }
        }
        .padding(.top, TSSpacing.xs)
        .accessibilityElement(children: .contain)
    }

    private var pageSizeMenu: some View {
        Menu {
            ForEach(WhyEndedSignalPaging.pageSizeOptions, id: \.self) { size in
                Button {
                    model.setSignalPageSize(size)
                } label: {
                    if size == model.signalPageSize {
                        Label("\(size)", systemImage: "checkmark")
                    } else {
                        Text(verbatim: "\(size)")
                    }
                }
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: WhyEndedPanelStrings.rowsPerPage)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: "\(model.signalPageSize)")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel(Text(verbatim: WhyEndedPanelStrings.rowsPerPage))
        .accessibilityValue(Text(verbatim: "\(model.signalPageSize)"))
    }

    private func stepButton(
        systemImage: String,
        label: String,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(enabled ? Color.TS.accent : Color.TS.textMuted.opacity(0.5))
                .frame(width: 28, height: 28)
                .background(Color.TS.surface, in: Circle())
                .overlay(Circle().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(Text(verbatim: label))
    }
}
