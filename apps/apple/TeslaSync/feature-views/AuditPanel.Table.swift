//
//  AuditPanel.Table.swift
//  TeslaSync — P4 feature view · 0026 · AuditPanel (Apple)
//
//  The replay-audit data table — the Apple-idiomatic parity of the web source's
//  `DataTable<AuditPanelDLQReplayRecord>`. A real columnar grid on macOS / regular
//  width and a card list on compact iPhone width, reproducing the seven web
//  columns (replayed_at / actor / dlq_id / result / dst_topic / error / trace_id),
//  the monospaced cells (web `font-mono`), and the result chip. The table is
//  hand-composed rather than wrapping the shared `TSDataTable` because the latter
//  takes main-catalog `LocalizedStringKey` headers (no per-surface fallback) and
//  always renders a selection column the read-only audit log does not have —
//  mirroring the 0069 NotificationStatsWidget disposition.
//

import SwiftUI

// MARK: - Column metrics (regular columnar layout)

private enum AuditTableMetrics {
    static let replayedAt: CGFloat = 168
    static let actor: CGFloat = 128
    static let dlqId: CGFloat = 76
    static let result: CGFloat = 132
    static let dstTopic: CGFloat = 176
    static let error: CGFloat = 220
    static let traceId: CGFloat = 160
    static let columnSpacing: CGFloat = TSSpacing.md
}

// MARK: - Adaptive table (web `DataTable`)

struct AuditLogTable: View {
    let rows: [AuditRowItem]

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
        HStack(spacing: AuditTableMetrics.columnSpacing) {
            headerCell("admin.dlq.audit.cols.replayedAt", "Replayed at", width: AuditTableMetrics.replayedAt)
            headerCell("admin.dlq.audit.cols.actor", "Actor", width: AuditTableMetrics.actor)
            headerCell("admin.dlq.audit.cols.dlqId", "DLQ ID", width: AuditTableMetrics.dlqId)
            headerCell("admin.dlq.audit.cols.result", "Result", width: AuditTableMetrics.result)
            headerCell("admin.dlq.audit.cols.dstTopic", "Destination", width: AuditTableMetrics.dstTopic)
            headerCell("admin.dlq.audit.cols.error", "Error", width: AuditTableMetrics.error)
            headerCell("admin.dlq.audit.cols.traceId", "Trace ID", width: AuditTableMetrics.traceId)
        }
        .padding(.vertical, TSSpacing.xs)
    }

    private func headerCell(_ key: String, _ fallback: String, width: CGFloat) -> some View {
        AuditPanelStrings.text(key, fallback)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .textCase(.uppercase)
            .lineLimit(1)
            .frame(width: width, alignment: .leading)
    }

    private func regularRow(_ row: AuditRowItem) -> some View {
        HStack(spacing: AuditTableMetrics.columnSpacing) {
            cell(row.replayedAtText, width: AuditTableMetrics.replayedAt, mono: false, tone: Color.TS.textSecondary)
            cell(row.actorText, width: AuditTableMetrics.actor, mono: true, tone: Color.TS.textMuted)
            cell(row.dlqIdText, width: AuditTableMetrics.dlqId, mono: true, tone: Color.TS.textPrimary)
            AuditResultBadge(label: row.resultLabel, tone: row.resultTone)
                .frame(width: AuditTableMetrics.result, alignment: .leading)
            cell(row.dstTopicText, width: AuditTableMetrics.dstTopic, mono: true, tone: Color.TS.textMuted)
            cell(row.errorText, width: AuditTableMetrics.error, mono: false, tone: Color.TS.textMuted, lineLimit: 2)
            cell(row.traceIdText, width: AuditTableMetrics.traceId, mono: true, tone: Color.TS.textMuted)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AuditPanelAccessibility.rowSummary(for: row)))
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
                AuditCompactCard(row: row)
            }
        }
        .padding(.vertical, TSSpacing.xs)
    }
}

// MARK: - Compact card (one audit row on iPhone)

struct AuditCompactCard: View {
    let row: AuditRowItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: row.replayedAtText)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                AuditResultBadge(label: row.resultLabel, tone: row.resultTone)
            }
            field("admin.dlq.audit.cols.actor", "Actor", row.actorText, mono: true)
            field("admin.dlq.audit.cols.dlqId", "DLQ ID", row.dlqIdText, mono: true)
            field("admin.dlq.audit.cols.dstTopic", "Destination", row.dstTopicText, mono: true)
            field("admin.dlq.audit.cols.error", "Error", row.errorText, mono: false)
            field("admin.dlq.audit.cols.traceId", "Trace ID", row.traceIdText, mono: true)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AuditPanelAccessibility.rowSummary(for: row)))
    }

    private func field(_ key: String, _ fallback: String, _ value: String, mono: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            AuditPanelStrings.text(key, fallback)
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
