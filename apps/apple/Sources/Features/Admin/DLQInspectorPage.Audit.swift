import SwiftUI

/// The success/danger/warning badge for a replay result (web
/// `<Badge variant={RESULT_VARIANT[result]}>{result}</Badge>`). The result code is rendered
/// verbatim like the sibling Feature-Flag operation badge; the tone mapping is exposed as a
/// pure static so it stays unit-testable.
struct DLQResultBadge: View {
    let result: DLQReplayResult

    var body: some View {
        let tone = Self.tone(result)
        return Text(verbatim: result.rawValue)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: result.rawValue))
    }

    /// Web `RESULT_VARIANT`: ok → success, publish_failed / unparseable → danger,
    /// rate_limited / disabled → warning, not_found → neutral.
    static func tone(_ result: DLQReplayResult) -> TSTone {
        switch result {
        case .ok: .success
        case .publishFailed, .unparseable: .danger
        case .rateLimited, .disabled: .warning
        case .notFound: .neutral
        }
    }
}

/// The adaptive replay-audit table for `DLQInspectorPage` (web `AuditPanel`, `GlassPanel2`):
/// a columnar grid on macOS / iPad regular width and per-row cards on compact iPhone.
/// Reproduces the web columns — Replayed at, Actor, DLQ ID, the Result badge, Destination
/// topic, Error, and Trace ID. Kept as a dedicated surface so the page file stays focused on
/// chrome + states. All copy resolves from `Localizable.xcstrings`.
struct DLQAuditTable: View {
    let rows: [DLQReplayAuditRecord]

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
                header("admin.dlq.audit.cols.replayedAt")
                header("admin.dlq.audit.cols.actor")
                header("admin.dlq.audit.cols.dlqId")
                header("admin.dlq.audit.cols.result")
                header("admin.dlq.audit.cols.dstTopic")
                header("admin.dlq.audit.cols.error")
                header("admin.dlq.audit.cols.traceId")
            }
            Divider().overlay(Color.TS.border).gridCellColumns(7)
            ForEach(rows) { row in
                GridRow {
                    primaryText(DLQInspectorFormat.dateTime(row.replayedAt))
                    monoText(displayActor(row))
                    monoText(String(row.dlqID))
                    DLQResultBadge(result: row.result)
                    monoText(value(row.dstTopic))
                    mutedText(value(row.error))
                    monoText(value(row.traceID))
                }
                .accessibilityElement(children: .combine)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(7)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func primaryText(_ text: String) -> some View {
        Text(verbatim: text).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
    }

    private func monoText(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .textSelection(.enabled)
    }

    private func mutedText(_ text: String) -> some View {
        Text(verbatim: text)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: 220, alignment: .leading)
    }

    private func value(_ raw: String) -> String {
        raw.isEmpty ? DLQInspectorFormat.emptyValue : raw
    }

    private func displayActor(_ row: DLQReplayAuditRecord) -> String {
        row.actor.isEmpty ? DLQInspectorFormat.emptyValue : row.actor
    }

    // MARK: - Compact (iPhone) cards

    private func rowCard(_ row: DLQReplayAuditRecord) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    Text(verbatim: DLQInspectorFormat.dateTime(row.replayedAt))
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer(minLength: TSSpacing.sm)
                    DLQResultBadge(result: row.result)
                }
                labeledRow("admin.dlq.audit.cols.actor", displayActor(row))
                labeledRow("admin.dlq.audit.cols.dlqId", String(row.dlqID))
                labeledRow("admin.dlq.audit.cols.dstTopic", value(row.dstTopic))
                labeledRow("admin.dlq.audit.cols.traceId", value(row.traceID))
                errorRow(row.error)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func labeledRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }

    @ViewBuilder
    private func errorRow(_ error: String) -> some View {
        if !error.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text("admin.dlq.audit.cols.error")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: error)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
