import SwiftUI

/// The success/danger badge for a flag-change operation (web
/// `<Badge variant={OP_VARIANT[operation]}>{operation}</Badge>` — `set` → success,
/// `delete` → danger). The operation token is rendered verbatim like the sibling Audit
/// Log category chip.
struct FeatureFlagOpBadge: View {
    let operation: FeatureFlagOperation

    var body: some View {
        let tone = Self.tone(operation)
        return Text(verbatim: operation.rawValue)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: operation.rawValue))
    }

    /// Web `OP_VARIANT` — `set` → success, `delete` → danger.
    static func tone(_ operation: FeatureFlagOperation) -> TSTone {
        operation == .set ? .success : .danger
    }
}

/// The adaptive change-audit table for `FeatureFlagsPage` (web `ChangesPanel`,
/// `GlassPanel2`): a columnar grid on macOS / iPad regular width and per-row cards on
/// compact iPhone. Reproduces the seven web columns — Changed at, Actor, Key, Operation
/// badge, Old value, New value, and Reason — with the old/new JSON rendered via the web
/// `compact` preview. Kept as a dedicated surface so the page file stays focused on
/// chrome + states. All copy resolves from `Localizable.xcstrings`.
struct FeatureFlagChangesTable: View {
    let rows: [FeatureFlagChange]

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
                header("admin.flags.audit.cols.changedAt")
                header("admin.flags.audit.cols.actor")
                header("admin.flags.audit.cols.flagKey")
                header("admin.flags.audit.cols.operation")
                header("admin.flags.audit.cols.oldValue")
                header("admin.flags.audit.cols.newValue")
                header("admin.flags.audit.cols.reason")
            }
            Divider().overlay(Color.TS.border).gridCellColumns(7)
            ForEach(rows) { row in
                GridRow {
                    valueText(FeatureFlagsFormat.dateTime(row.changedAt), primary: true)
                    monoText(displayActor(row))
                    monoText(row.flagKey)
                    FeatureFlagOpBadge(operation: row.operation)
                    monoText(FlagJSONValue.compact(row.oldValue))
                    monoText(FlagJSONValue.compact(row.newValue))
                    reasonText(row.reason)
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

    private func valueText(_ value: String, primary: Bool) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .foregroundStyle(primary ? Color.TS.textPrimary : Color.TS.textSecondary)
    }

    private func monoText(_ value: String) -> some View {
        Text(verbatim: value)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .textSelection(.enabled)
    }

    private func reasonText(_ reason: String) -> some View {
        Text(verbatim: reason.isEmpty ? FeatureFlagsFormat.emptyValue : reason)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(2)
            .frame(maxWidth: 220, alignment: .leading)
    }

    private func displayActor(_ row: FeatureFlagChange) -> String {
        row.actor.isEmpty ? FeatureFlagsFormat.emptyValue : row.actor
    }

    // MARK: - Compact (iPhone) cards

    private func rowCard(_ row: FeatureFlagChange) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    Text(verbatim: FeatureFlagsFormat.dateTime(row.changedAt))
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer(minLength: TSSpacing.sm)
                    FeatureFlagOpBadge(operation: row.operation)
                }
                labeledRow("admin.flags.audit.cols.flagKey", row.flagKey, mono: true)
                labeledRow("admin.flags.audit.cols.actor", displayActor(row), mono: true)
                labeledRow("admin.flags.audit.cols.oldValue", FlagJSONValue.compact(row.oldValue), mono: true)
                labeledRow("admin.flags.audit.cols.newValue", FlagJSONValue.compact(row.newValue), mono: true)
                reasonRow(row.reason)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func labeledRow(_ label: LocalizedStringKey, _ value: String, mono: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(mono ? .system(.caption, design: .monospaced) : Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func reasonRow(_ reason: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("admin.flags.audit.cols.reason")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: reason.isEmpty ? FeatureFlagsFormat.emptyValue : reason)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
