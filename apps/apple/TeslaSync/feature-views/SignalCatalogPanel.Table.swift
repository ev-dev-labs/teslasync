//
//  SignalCatalogPanel.Table.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  The populated catalog table and its pieces: the four-level Status badge, the
//  stale/offline connectivity banner, the optional selection checkbox, and the
//  adaptive table itself — a columnar `Grid` on macOS / regular width (Status,
//  Signal, Last Value, Last Updated, Time Since) and a card list on compact
//  iPhone width, the native idiom for the web `DataTable`. Token-driven (P1/S9);
//  no Tailwind ports and no networking.
//

import SwiftUI

// MARK: - Tone palette (web getCatalogStalenessStyle colors)

/// Maps a row's four-level badge tone to its TS status color (web `text-*` +
/// `variant`). Used by both the Status badge and the Time-Since cell.
enum SignalCatalogPanelTablePalette {
    static func color(for tone: SignalCatalogPanelTone) -> Color {
        switch tone {
        case .active: Color.TS.statusSuccess
        case .aging: Color.TS.statusWarning
        case .stale: Color.TS.statusDanger
        case .neverReceived: Color.TS.textMuted
        }
    }
}

// MARK: - Table

/// The populated catalog table, adaptive to width.
struct SignalCatalogPanelTable: View {
    let model: SignalCatalogPanelModel

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

    private var columnSpan: Int {
        model.selectionEnabled ? 6 : 5
    }

    var body: some View {
        Group {
            if isCompact {
                compactTable
            } else {
                regularTable
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SignalCatalogPanelStrings.tableLabel))
        .accessibilityValue(
            Text(verbatim: SignalCatalogPanelAccessibility.tableSummary(rowCount: model.displayedRows.count))
        )
    }
}

// MARK: - Regular (macOS / iPad) columnar layout

extension SignalCatalogPanelTable {
    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: 0) {
            GridRow {
                if model.selectionEnabled {
                    Color.clear.frame(width: 20, height: 1).accessibilityHidden(true)
                }
                headerCell(SignalCatalogPanelStrings.columnStatus)
                headerCell(SignalCatalogPanelStrings.columnSignal)
                headerCell(SignalCatalogPanelStrings.columnValue)
                headerCell(SignalCatalogPanelStrings.columnLastUpdated)
                headerCell(SignalCatalogPanelStrings.columnTimeSince)
                    .gridColumnAlignment(.trailing)
            }
            .padding(.vertical, TSSpacing.sm)
            Divider().overlay(Color.TS.border).gridCellColumns(columnSpan)
            ForEach(model.displayedRows) { row in
                dataRow(row)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(columnSpan)
            }
        }
    }

    private func dataRow(_ row: SignalCatalogPanelRow) -> some View {
        GridRow {
            if model.selectionEnabled {
                selectionToggle(row)
            }
            SignalCatalogPanelStatusBadge(tone: tone(for: row))
            nameCell(row)
            valueCell(row)
            Text(verbatim: lastUpdatedText(row))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            timeSinceCell(row).gridColumnAlignment(.trailing)
        }
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(row)))
    }

    private func headerCell(_ title: String) -> some View {
        Text(verbatim: title)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: - Compact (iPhone) card layout

extension SignalCatalogPanelTable {
    private var compactTable: some View {
        LazyVStack(spacing: TSSpacing.sm) {
            ForEach(model.displayedRows) { row in
                card(row)
            }
        }
    }

    private func card(_ row: SignalCatalogPanelRow) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                if model.selectionEnabled {
                    selectionToggle(row)
                }
                SignalCatalogPanelStatusBadge(tone: tone(for: row))
                Spacer(minLength: TSSpacing.sm)
                timeSinceCell(row)
            }
            nameCell(row)
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                valueCell(row)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: lastUpdatedText(row))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(row)))
    }
}

// MARK: - Shared cells + helpers

extension SignalCatalogPanelTable {
    private func tone(for row: SignalCatalogPanelRow) -> SignalCatalogPanelTone {
        SignalCatalogPanelFormat.tone(staleness: row.staleness, hasTimestamp: row.hasTimestamp)
    }

    private func nameCell(_ row: SignalCatalogPanelRow) -> some View {
        Text(verbatim: row.name)
            .font(.system(.callout, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func valueCell(_ row: SignalCatalogPanelRow) -> some View {
        Text(verbatim: row.value)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    /// Web Time-Since cell: `formatStaleness` colored by the row tone, or the em
    /// dash when the row never reported a usable timestamp.
    @ViewBuilder
    private func timeSinceCell(_ row: SignalCatalogPanelRow) -> some View {
        if let text = timeSinceText(row) {
            Text(verbatim: text)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(SignalCatalogPanelTablePalette.color(for: tone(for: row)))
                .lineLimit(1)
        } else {
            Text(verbatim: SignalCatalogPanelFormat.emDash)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func selectionToggle(_ row: SignalCatalogPanelRow) -> some View {
        SignalCatalogPanelSelectionToggle(
            name: row.name,
            isSelected: model.isSelected(row.name),
            isEnabled: model.canToggleSelection(row.name)
        ) {
            model.toggleSelection(row.name)
        }
    }

    private func lastUpdatedText(_ row: SignalCatalogPanelRow) -> String {
        SignalCatalogPanelFormat.formatDateTime(row.timestamp, locale: .current, timeZone: .current)
    }

    private func timeSinceText(_ row: SignalCatalogPanelRow) -> String? {
        guard row.hasTimestamp else { return nil }
        return SignalCatalogPanelFormat.formatStaleness(
            row.staleness,
            locale: .current,
            templates: SignalCatalogPanelStrings.stalenessTemplates
        )
    }

    private func rowAccessibilityLabel(_ row: SignalCatalogPanelRow) -> String {
        SignalCatalogPanelAccessibility.rowLabel(
            name: row.name,
            value: row.value,
            status: SignalCatalogPanelStrings.toneLabel(tone(for: row)),
            lastUpdated: lastUpdatedText(row),
            timeSince: timeSinceText(row)
        )
    }
}

// MARK: - Status badge (web `<Badge variant dot>`)

/// The four-level row status badge: a tinted chip with a leading dot and the
/// localized tone label.
struct SignalCatalogPanelStatusBadge: View {
    let tone: SignalCatalogPanelTone

    var body: some View {
        let color = SignalCatalogPanelTablePalette.color(for: tone)
        let label = SignalCatalogPanelStrings.toneLabel(tone)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(color)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Capsule().fill(color.opacity(0.12)))
        .overlay(Capsule().strokeBorder(color.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Selection checkbox (web `selection` add/remove button)

/// The optional leading selection toggle: an add / remove affordance with the web
/// aria-label, disabled once a selection cap is reached.
struct SignalCatalogPanelSelectionToggle: View {
    let name: String
    let isSelected: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "plus.circle")
                .font(.system(size: 18))
                .foregroundStyle(tint)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(
            Text(verbatim: SignalCatalogPanelAccessibility.selectionLabel(name: name, isSelected: isSelected))
        )
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var tint: Color {
        if isSelected { return Color.TS.accent }
        return isEnabled ? Color.TS.textMuted : Color.TS.textMuted.opacity(0.4)
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the table when the live stream is not
/// fresh — the feature-level analogue of the web `LiveIndicator` freshness.
struct SignalCatalogPanelConnectivityBanner: View {
    let connection: SignalCatalogPanelConnection

    var body: some View {
        let offline = connection == .offline
        let label = offline ? SignalCatalogPanelStrings.offlineBanner : SignalCatalogPanelStrings.staleBanner
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
