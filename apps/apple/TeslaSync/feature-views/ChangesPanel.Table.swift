//
//  ChangesPanel.Table.swift
//  TeslaSync — P4 feature view · 0030 · ChangesPanel (Apple)
//
//  The change-audit data table — the Apple-idiomatic parity of the web source's
//  `DataTable<ChangesPanelFlagChange>`. A real columnar grid on macOS / regular width
//  and a card list on compact iPhone width, reproducing the seven web columns
//  (changed_at / actor / flag_key / operation / old_value / new_value / reason),
//  the monospaced cells (web `font-mono`), and the operation chip. The table is
//  hand-composed rather than wrapping the shared `TSDataTable` because the latter
//  takes main-catalog `LocalizedStringKey` headers (no per-surface fallback) and
//  always renders a selection column the read-only audit log does not have — the
//  same disposition the sibling 0026 AuditPanel records for its log table.
//

import SwiftUI

// MARK: - Column metrics (regular columnar layout)

private enum ChangesTableMetrics {
    static let changedAt: CGFloat = 168
    static let actor: CGFloat = 150
    static let flagKey: CGFloat = 168
    static let operation: CGFloat = 96
    static let oldValue: CGFloat = 200
    static let newValue: CGFloat = 200
    static let reason: CGFloat = 200
    static let columnSpacing: CGFloat = TSSpacing.md
}

// MARK: - Adaptive table (web `DataTable`)

struct ChangeLogTable: View {
    let rows: [ChangeRowItem]

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
    }

    // MARK: Regular (macOS / iPad) columnar layout

    private var regularTable: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            VStack(spacing: 0) {
                headerRow
                Divider().overlay(Color.TS.border)
                ForEach(rows) { row in
                    regularRow(row)
                    if row.id != rows.last?.id {
                        Divider().overlay(Color.TS.border.opacity(0.5))
                    }
                }
            }
        }
    }

    private var headerRow: some View {
        HStack(spacing: ChangesTableMetrics.columnSpacing) {
            headerCell("admin.flags.audit.cols.changedAt", "Changed at", width: ChangesTableMetrics.changedAt)
            headerCell("admin.flags.audit.cols.actor", "Actor", width: ChangesTableMetrics.actor)
            headerCell("admin.flags.audit.cols.flagKey", "Key", width: ChangesTableMetrics.flagKey)
            headerCell("admin.flags.audit.cols.operation", "Op", width: ChangesTableMetrics.operation)
            headerCell("admin.flags.audit.cols.oldValue", "Old", width: ChangesTableMetrics.oldValue)
            headerCell("admin.flags.audit.cols.newValue", "New", width: ChangesTableMetrics.newValue)
            headerCell("admin.flags.audit.cols.reason", "Reason", width: ChangesTableMetrics.reason)
        }
        .padding(.vertical, TSSpacing.xs)
    }

    private func headerCell(_ key: String, _ fallback: String, width: CGFloat) -> some View {
        ChangesPanelStrings.text(key, fallback)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .textCase(.uppercase)
            .lineLimit(1)
            .frame(width: width, alignment: .leading)
    }

    private func regularRow(_ row: ChangeRowItem) -> some View {
        HStack(spacing: ChangesTableMetrics.columnSpacing) {
            cell(row.changedAtText, width: ChangesTableMetrics.changedAt, mono: false, tone: Color.TS.textSecondary)
            cell(row.actorText, width: ChangesTableMetrics.actor, mono: true, tone: Color.TS.textMuted)
            cell(row.flagKeyText, width: ChangesTableMetrics.flagKey, mono: true, tone: Color.TS.textPrimary)
            ChangesOpBadge(label: row.operationLabel, tone: row.operationTone)
                .frame(width: ChangesTableMetrics.operation, alignment: .leading)
            cell(row.oldValueText, width: ChangesTableMetrics.oldValue, mono: true, tone: Color.TS.textMuted)
            cell(row.newValueText, width: ChangesTableMetrics.newValue, mono: true, tone: Color.TS.textMuted)
            cell(row.reasonText, width: ChangesTableMetrics.reason, mono: false, tone: Color.TS.textMuted, lineLimit: 2)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ChangesPanelAccessibility.rowSummary(for: row)))
    }

    private func cell(
        _ value: String,
        width: CGFloat,
        mono: Bool,
        tone: Color,
        lineLimit: Int = 1
    ) -> some View {
        Text(verbatim: value)
            .font(mono ? Font.TS.caption : Font.TS.bodySm)
            .monospaced(mono)
            .foregroundStyle(tone)
            .lineLimit(lineLimit)
            .truncationMode(.tail)
            .frame(width: width, alignment: .leading)
    }

    // MARK: Compact (iPhone) card layout

    private var compactList: some View {
        LazyVStack(spacing: TSSpacing.sm) {
            ForEach(rows) { row in
                ChangeCompactCard(row: row)
            }
        }
        .padding(.vertical, TSSpacing.xs)
    }
}

// MARK: - Compact card (one change row on iPhone)

struct ChangeCompactCard: View {
    let row: ChangeRowItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: row.changedAtText)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                ChangesOpBadge(label: row.operationLabel, tone: row.operationTone)
            }
            field("admin.flags.audit.cols.actor", "Actor", row.actorText, mono: true)
            field("admin.flags.audit.cols.flagKey", "Key", row.flagKeyText, mono: true)
            field("admin.flags.audit.cols.oldValue", "Old", row.oldValueText, mono: true)
            field("admin.flags.audit.cols.newValue", "New", row.newValueText, mono: true)
            field("admin.flags.audit.cols.reason", "Reason", row.reasonText, mono: false)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ChangesPanelAccessibility.rowSummary(for: row)))
    }

    private func field(_ key: String, _ fallback: String, _ value: String, mono: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            ChangesPanelStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .monospaced(mono)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.trailing)
                .lineLimit(3)
        }
    }
}
