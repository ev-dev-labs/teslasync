import SwiftUI

/// The adaptive dead-letter entries table for `DLQInspectorPage` (web `EntriesTable`,
/// `GlassPanel1`): a columnar grid on macOS / iPad regular width and per-row cards on
/// compact iPhone. Reproduces the web columns — Arrived, Reason, VIN, Source topic,
/// Redeliveries, Payload size, the Replayable Yes/No badge, and the per-row Inspect action —
/// sorted newest-first (web `useSortToggle('arrived_at','desc')`). Kept as a dedicated
/// surface (mirroring `FeatureFlagsTable`) so the page file stays focused on chrome +
/// states. All copy resolves from `Localizable.xcstrings`.
struct DLQEntriesTable: View {
    let rows: [DLQEntrySummary]
    let model: DLQInspectorPageModel

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

    /// Web default: arrived_at descending (newest first).
    private var sortedRows: [DLQEntrySummary] {
        rows.sorted { lhs, rhs in
            let left = DLQInspectorFormat.parseISO(lhs.arrivedAt) ?? .distantPast
            let right = DLQInspectorFormat.parseISO(rhs.arrivedAt) ?? .distantPast
            return left > right
        }
    }

    var body: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                ForEach(sortedRows) { rowCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("admin.dlq.cols.arrived")
                header("admin.dlq.cols.reason")
                header("admin.dlq.cols.vin")
                header("admin.dlq.cols.topic")
                header("admin.dlq.cols.redeliveries")
                header("admin.dlq.cols.size")
                header("admin.dlq.cols.replayable")
                header("admin.dlq.cols.actions").gridColumnAlignment(.trailing)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(8)
            ForEach(sortedRows) { row in
                GridRow {
                    primaryText(DLQInspectorFormat.dateTime(row.arrivedAt))
                    monoText(row.parsedReason.isEmpty ? DLQInspectorFormat.emptyValue : row.parsedReason)
                    monoText(row.parsedVIN ?? DLQInspectorFormat.emptyValue)
                    monoText(row.parsedSourceTopic ?? DLQInspectorFormat.emptyValue)
                    mutedText(redeliveries(row))
                    mutedText(DLQInspectorFormat.bytes(row.rawPayloadSize))
                    DLQReplayableBadge(replayable: row.replayable)
                    inspectButton(row).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: row.parsedReason))
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(8)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func primaryText(_ value: String) -> some View {
        Text(verbatim: value).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
    }

    private func monoText(_ value: String) -> some View {
        Text(verbatim: value)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .textSelection(.enabled)
    }

    private func mutedText(_ value: String) -> some View {
        Text(verbatim: value).font(Font.TS.bodySm).foregroundStyle(Color.TS.textMuted)
    }

    private func redeliveries(_ row: DLQEntrySummary) -> String {
        guard let count = row.parsedRedeliveries else { return DLQInspectorFormat.emptyValue }
        return count.formatted()
    }

    private func inspectButton(_ row: DLQEntrySummary) -> some View {
        TSButton("admin.dlq.actions.inspect", variant: .secondary, size: .small) {
            model.inspect(row)
        }
    }

    // MARK: - Compact (iPhone) cards

    private func rowCard(_ row: DLQEntrySummary) -> some View {
        let reason = row.parsedReason.isEmpty ? DLQInspectorFormat.emptyValue : row.parsedReason
        let vin = row.parsedVIN ?? DLQInspectorFormat.emptyValue
        let topic = row.parsedSourceTopic ?? DLQInspectorFormat.emptyValue
        return TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    Text(verbatim: DLQInspectorFormat.dateTime(row.arrivedAt))
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer(minLength: TSSpacing.sm)
                    DLQReplayableBadge(replayable: row.replayable)
                }
                labeledRow("admin.dlq.cols.reason", reason)
                labeledRow("admin.dlq.cols.vin", vin)
                labeledRow("admin.dlq.cols.topic", topic)
                labeledRow("admin.dlq.cols.size", DLQInspectorFormat.bytes(row.rawPayloadSize))
                inspectButton(row).frame(maxWidth: .infinity, alignment: .trailing)
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
}

/// The Replayable Yes/No badge (web `replayable ? Badge success : Badge neutral`).
struct DLQReplayableBadge: View {
    let replayable: Bool

    var body: some View {
        TSBadge(replayable ? "common.yes" : "common.no", tone: replayable ? .success : .neutral)
    }
}
