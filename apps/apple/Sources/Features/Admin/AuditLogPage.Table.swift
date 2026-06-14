import SwiftUI

/// The adaptive entries table for `AuditLogPage` (web `DataTable`): a columnar grid on
/// macOS / iPad regular width and per-row cards on compact iPhone. Reproduces the eight
/// web columns — Timestamp (+ relative), Actor, Category badge, Action, Entity (+ id),
/// Detail, Trace (+ copy), and the success status badge — plus the expandable detail row
/// (web `renderExpanded` → `ExpandedDetail`). Kept as a dedicated surface (mirroring
/// `DiskForecastPage.Table`) so the page file stays focused on chrome + states. All copy
/// resolves from `Localizable.xcstrings`.
struct AuditLogEntriesTable: View {
    let rows: [AuditLogRow]
    let model: AuditLogPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                ForEach(rows) { rowCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("admin.auditLog.colTs")
                header("admin.auditLog.colActor")
                header("admin.auditLog.colCategory")
                header("admin.auditLog.colAction")
                header("admin.auditLog.colEntity")
                header("admin.auditLog.colDetail")
                header("admin.auditLog.colTrace")
                header("admin.auditLog.colSuccess").gridColumnAlignment(.trailing)
                Color.clear.frame(width: 1, height: 1)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(9)
            ForEach(rows) { row in
                GridRow {
                    timestampCell(row)
                    valueCell(row.actor.isEmpty ? AuditLogFormat.emptyValue : row.actor)
                    categoryCell(row)
                    actionCell(row)
                    entityCell(row)
                    detailCell(row)
                    traceCell(row)
                    AuditSuccessBadge(success: row.success)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    expandButton(row)
                }
                .accessibilityElement(children: .combine)
                if model.isExpanded(row.id) {
                    AuditLogExpandedDetail(row: row)
                        .gridCellColumns(9)
                }
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(9)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func timestampCell(_ row: AuditLogRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: AuditLogFormat.dateTime(row.ts))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: AuditLogFormat.relative(row.ts))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func valueCell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
    }

    private func categoryCell(_ row: AuditLogRow) -> some View {
        Group {
            if let category = row.category, !category.isEmpty {
                AuditCategoryChip(category: category)
            } else {
                Text(verbatim: AuditLogFormat.emptyValue)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private func actionCell(_ row: AuditLogRow) -> some View {
        Text(verbatim: row.action)
            .font(Font.TS.bodySm)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textPrimary)
    }

    private func entityCell(_ row: AuditLogRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: row.entityType)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
            if let entityID = row.entityID {
                Text(verbatim: "#\(entityID)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private func detailCell(_ row: AuditLogRow) -> some View {
        Text(verbatim: row.detail ?? AuditLogFormat.emptyValue)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(2)
            .frame(maxWidth: 220, alignment: .leading)
    }

    private func traceCell(_ row: AuditLogRow) -> some View {
        Group {
            if let traceID = row.traceID, !traceID.isEmpty {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: Self.shortTrace(traceID))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Color.TS.textSecondary)
                    TSCopyButton(value: traceID)
                }
            } else {
                Text(verbatim: AuditLogFormat.emptyValue)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private func expandButton(_ row: AuditLogRow) -> some View {
        TSButton(
            model.isExpanded(row.id) ? "admin.auditLog.hideDetails" : "admin.auditLog.showDetails",
            variant: .ghost,
            size: .small
        ) {
            model.toggleExpanded(row.id)
        }
    }

    // MARK: - Compact (iPhone) cards

    private func rowCard(_ row: AuditLogRow) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: AuditLogFormat.dateTime(row.ts))
                            .font(Font.TS.bodySm)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                        Text(verbatim: AuditLogFormat.relative(row.ts))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    AuditSuccessBadge(success: row.success)
                }
                labeledRow("admin.auditLog.colActor", row.actor.isEmpty ? AuditLogFormat.emptyValue : row.actor)
                categoryRow(row)
                labeledRow("admin.auditLog.colAction", row.action)
                labeledRow("admin.auditLog.colEntity", entityText(row))
                detailRow(row)
                if let traceID = row.traceID, !traceID.isEmpty {
                    traceRow(traceID)
                }
                expandButton(row)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                if model.isExpanded(row.id) {
                    AuditLogExpandedDetail(row: row)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func labeledRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func categoryRow(_ row: AuditLogRow) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("admin.auditLog.colCategory").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            if let category = row.category, !category.isEmpty {
                AuditCategoryChip(category: category)
            } else {
                Text(verbatim: AuditLogFormat.emptyValue)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private func detailRow(_ row: AuditLogRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("admin.auditLog.colDetail").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Text(verbatim: row.detail ?? AuditLogFormat.emptyValue)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func traceRow(_ traceID: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("admin.auditLog.colTrace").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: Self.shortTrace(traceID))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
            TSCopyButton(value: traceID)
        }
    }

    private func entityText(_ row: AuditLogRow) -> String {
        guard let entityID = row.entityID else { return row.entityType }
        return "\(row.entityType) #\(entityID)"
    }

    /// Web `trace_id.slice(0, 8) + '…'`.
    static func shortTrace(_ traceID: String) -> String {
        String(traceID.prefix(8)) + "…"
    }
}

/// The expandable detail panel for one row (web `ExpandedDetail`): IP, user-agent,
/// trace id (+ copy), before/after JSON, and the row hash (+ copy). Adaptive: a
/// two-column grid on regular width, stacked on compact. Renders only the sections the
/// row actually carries (web conditionals on trace/before/after/row_hash).
struct AuditLogExpandedDetail: View {
    let row: AuditLogRow

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            field("admin.auditLog.detailIp", value: row.ip ?? AuditLogFormat.emptyValue, monospaced: true)
            field("admin.auditLog.detailUa", value: row.userAgent ?? AuditLogFormat.emptyValue)
            if let traceID = row.traceID, !traceID.isEmpty {
                copyField("admin.auditLog.detailTrace", value: traceID)
            }
            if let before = row.before, !before.isEmpty {
                jsonField("admin.auditLog.detailBefore", value: before)
            }
            if let after = row.after, !after.isEmpty {
                jsonField("admin.auditLog.detailAfter", value: after)
            }
            if let rowHash = row.rowHash, !rowHash.isEmpty {
                copyField("admin.auditLog.detailHash", value: rowHash)
            }
        }
        .padding(TSSpacing.md)
        .background(Color.TS.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
    }

    private func field(_ label: LocalizedStringKey, value: String, monospaced: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSCaption(label)
            Text(verbatim: value)
                .font(monospaced ? .system(.caption, design: .monospaced) : Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func copyField(_ label: LocalizedStringKey, value: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSCaption(label)
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: value)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)
                TSCopyButton(value: value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func jsonField(_ label: LocalizedStringKey, value: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSCaption(label)
            ScrollView {
                Text(verbatim: AuditLogFormat.prettyJSON(value))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 160)
            .padding(TSSpacing.sm)
            .background(Color.TS.bg.opacity(0.6), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
    }
}
