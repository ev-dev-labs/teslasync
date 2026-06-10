//
//  SignalDiffTable.Table.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  The populated-table branch: the stale/offline connectivity banner and the
//  adaptive, sortable, multi-selectable diff table. A columnar `Grid` on macOS /
//  regular width and a card list on compact iPhone width — the native idiom for
//  the web `DataTable` (selection toggle, pin, sortable Signal / Δ columns,
//  read-only Window A / Window B values, and the L1/L2/LOG/STALE source badges).
//

import SwiftUI

// MARK: - Populated content (banner + table)

struct SignalDiffTableContent: View {
    let model: SignalDiffTableModel

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
                SignalDiffConnectivityBanner(connection: model.connection)
            }
            if isCompact {
                compactTable
            } else {
                regularTable
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SignalDiffTableStrings.tableLabel))
        .accessibilityValue(
            Text(verbatim: SignalDiffTableAccessibility.gridSummary(rowCount: model.displayedRows.count))
        )
    }
}

// MARK: - Regular (macOS / iPad) columnar layout

extension SignalDiffTableContent {
    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: 0) {
            GridRow {
                headerSpacer
                headerSpacer
                sortHeader(.name, SignalDiffTableStrings.columnSignal)
                columnHeader(SignalDiffTableStrings.columnValueA)
                    .gridColumnAlignment(.trailing)
                columnHeader(SignalDiffTableStrings.columnValueB)
                    .gridColumnAlignment(.trailing)
                sortHeader(.delta, SignalDiffTableStrings.columnDelta)
                    .gridColumnAlignment(.trailing)
                columnHeader(SignalDiffTableStrings.columnSourceA)
                    .gridColumnAlignment(.center)
                columnHeader(SignalDiffTableStrings.columnSourceB)
                    .gridColumnAlignment(.center)
            }
            .padding(.vertical, TSSpacing.sm)
            Divider().overlay(Color.TS.border).gridCellColumns(8)
            ForEach(model.displayedRows) { row in
                dataRow(row)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(8)
            }
        }
    }

    private func dataRow(_ row: SignalDiffRow) -> some View {
        GridRow {
            selectionToggle(row)
            pinToggle(row)
            nameCell(row)
            valueText(row.valueAText, emphasis: .secondary)
            valueText(row.valueBText, emphasis: .primary)
            deltaCell(row)
            SignalDiffSourceBadge(layer: row.sourceA, ageMs: row.ageMsA)
            SignalDiffSourceBadge(layer: row.sourceB, ageMs: row.ageMsB)
        }
        .padding(.vertical, TSSpacing.sm)
        .modifier(SignalDiffRowAccessibility(model: model, row: row))
    }

    private var headerSpacer: some View {
        Color.clear.frame(width: 18, height: 1)
    }

    private func columnHeader(_ title: String) -> some View {
        Text(verbatim: title)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private func sortHeader(_ key: SignalDiffSortKey, _ title: String) -> some View {
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
        .accessibilityHint(Text(verbatim: SignalDiffTableStrings.sortHint))
    }

    private func sortStateLabel(for key: SignalDiffSortKey) -> String {
        guard model.sortKey == key else { return "" }
        return model.sortDirection == .ascending
            ? SignalDiffTableStrings.sortedAscending
            : SignalDiffTableStrings.sortedDescending
    }
}

// MARK: - Compact (iPhone) card layout

extension SignalDiffTableContent {
    private var compactTable: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                sortHeader(.name, SignalDiffTableStrings.columnSignal)
                sortHeader(.delta, SignalDiffTableStrings.columnDelta)
                Spacer(minLength: 0)
            }
            LazyVStack(spacing: TSSpacing.sm) {
                ForEach(model.displayedRows) { row in
                    card(row)
                }
            }
        }
    }

    private func card(_ row: SignalDiffRow) -> some View {
        let selected = model.isSelected(row.name)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                selectionToggle(row)
                nameCell(row)
                Spacer(minLength: TSSpacing.sm)
                pinToggle(row)
            }
            HStack(alignment: .top, spacing: TSSpacing.md) {
                labeledValue(SignalDiffTableStrings.columnValueA, row.valueAText, emphasis: .secondary)
                labeledValue(SignalDiffTableStrings.columnValueB, row.valueBText, emphasis: .primary)
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                    deltaCell(row)
                    HStack(spacing: TSSpacing.xs) {
                        SignalDiffSourceBadge(layer: row.sourceA, ageMs: row.ageMsA)
                        SignalDiffSourceBadge(layer: row.sourceB, ageMs: row.ageMsB)
                    }
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(selected ? Color.TS.accent.opacity(0.7) : Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture { model.toggleSelection(row.name) }
        .modifier(SignalDiffRowAccessibility(model: model, row: row))
    }

    private func labeledValue(_ label: String, _ value: String, emphasis: ValueEmphasis) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(TSTypeMetrics.labelTracking)
                .foregroundStyle(Color.TS.textMuted)
            valueText(value, emphasis: emphasis)
        }
    }
}

// MARK: - Shared cells

extension SignalDiffTableContent {
    enum ValueEmphasis {
        case primary
        case secondary
    }

    private func selectionToggle(_ row: SignalDiffRow) -> some View {
        let selected = model.isSelected(row.name)
        return Button {
            model.toggleSelection(row.name)
        } label: {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 16))
                .foregroundStyle(selected ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: SignalDiffTableStrings.selectLabel))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private func pinToggle(_ row: SignalDiffRow) -> some View {
        let pinned = model.isPinned(row.name)
        return Button {
            model.togglePin(row.name)
        } label: {
            Image(systemName: pinned ? "pin.fill" : "pin")
                .font(.system(size: 13))
                .foregroundStyle(pinned ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            Text(verbatim: pinned ? SignalDiffTableStrings.unpinAction : SignalDiffTableStrings.pinAction)
        )
        .accessibilityAddTraits(pinned ? [.isButton, .isSelected] : .isButton)
    }

    private func nameCell(_ row: SignalDiffRow) -> some View {
        Text(verbatim: row.name)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func valueText(_ text: String, emphasis: ValueEmphasis) -> some View {
        Text(verbatim: text)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(emphasis == .primary ? Color.TS.textPrimary : Color.TS.textSecondary)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    @ViewBuilder
    private func deltaCell(_ row: SignalDiffRow) -> some View {
        switch row.delta {
        case .none:
            Text(verbatim: "—")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        case .changed:
            Text(verbatim: SignalDiffTableStrings.deltaChanged)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusWarning)
        case let .numeric(delta, percent):
            Text(verbatim: SignalDiffTableFormat.deltaNumericText(
                delta: delta,
                percent: percent,
                locale: model.formattingLocale
            ))
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(deltaTone(delta))
        }
    }

    private func deltaTone(_ delta: Double) -> Color {
        if delta > 0 { return Color.TS.statusSuccess }
        if delta < 0 { return Color.TS.statusDanger }
        return Color.TS.textMuted
    }
}

// MARK: - Row accessibility (single element + custom pin/select actions)

/// Collapses a row into one VoiceOver element with the combined summary, the
/// selected trait, and rotor actions for the pin + select controls — the
/// accessible idiom for a data row that carries multiple controls.
private struct SignalDiffRowAccessibility: ViewModifier {
    let model: SignalDiffTableModel
    let row: SignalDiffRow

    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                Text(verbatim: SignalDiffTableAccessibility.rowLabel(for: row, locale: model.formattingLocale))
            )
            .accessibilityAddTraits(model.isSelected(row.name) ? .isSelected : [])
            .accessibilityActions {
                Button(SignalDiffTableStrings.selectLabel) { model.toggleSelection(row.name) }
                Button(pinActionLabel) { model.togglePin(row.name) }
            }
    }

    private var pinActionLabel: String {
        model.isPinned(row.name) ? SignalDiffTableStrings.unpinAction : SignalDiffTableStrings.pinAction
    }
}

// MARK: - Source-layer badge (web `SourceLayerBadge`)

/// The L1 / L2 / LOG / STALE source-layer badge — a tiny tinted, monospaced chip
/// whose tooltip (and VoiceOver label) carries the web layer description plus the
/// optional age, mirroring `SourceLayerBadge`.
struct SignalDiffSourceBadge: View {
    let layer: SignalDiffSourceLayer
    let ageMs: Double?

    var body: some View {
        Text(verbatim: layer.badgeLabel)
            .font(.system(.caption2, design: .monospaced))
            .tracking(0.5)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 1)
            .background(tone.opacity(0.16), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(tone.opacity(0.32), lineWidth: 1)
            )
            .help(Text(verbatim: tooltip))
            .accessibilityLabel(Text(verbatim: tooltip))
    }

    private var tooltip: String {
        SignalDiffTableStrings.sourceLayerTooltip(layer, ageText: SignalDiffTableFormat.formatAge(ageMs))
    }

    private var tone: Color {
        switch layer {
        case .l1: Color.TS.statusSuccess
        case .l2: Color.TS.statusInfo
        case .log: Color.TS.textSecondary
        case .stale: Color.TS.statusWarning
        case .unknown: Color.TS.textMuted
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the table when the live stream is not
/// fresh — the feature-level freshness chrome the web delegates to its host page.
struct SignalDiffConnectivityBanner: View {
    let connection: SignalDiffTableConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: isOffline ? SignalDiffTableStrings.offlineBanner : SignalDiffTableStrings.staleBanner)
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
