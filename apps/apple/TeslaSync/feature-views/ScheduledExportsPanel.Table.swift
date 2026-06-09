//
//  ScheduledExportsPanel.Table.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  The schedule rows — the native parity of the web `<table>` body over the user's
//  recurring exports. Each web row (Name / Type / Cron / Delivery / Next run / Last run /
//  Status / Actions) reflows into a card so the columns stack on compact widths instead of
//  truncating, and the per-row actions (Run now / Enable-Disable / Edit / Delete) wrap when
//  they don't fit on one line. Disabled schedules render at reduced opacity (web
//  `opacity-50`). Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Rows list (web `<tbody>` → staggered cards)

/// The staggered list of schedule rows (web table rows over the scheduled exports).
struct ScheduledExportsTable: View {
    @Bindable var model: ScheduledExportsModel

    var body: some View {
        TSStaggerContainer(spacing: TSSpacing.md) {
            ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                TSStaggerItem(index: index) {
                    ScheduledExportRow(model: model, item: item)
                }
            }
        }
    }
}

// MARK: - Row (web table row)

/// A single schedule: the name + status badge header, the Type / Cron / Delivery / Next
/// run / Last run metric lines, and the wrapping per-row action buttons.
struct ScheduledExportRow: View {
    @Bindable var model: ScheduledExportsModel
    let item: ScheduledExportItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            headerRow
            detailRows
            ScheduledExportRowActions(model: model, item: item)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .opacity(item.enabled ? 1 : 0.55)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.rowAccessibilityLabel(item)))
    }

    private var headerRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "calendar")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: item.name)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            ScheduledExportStatusBadge(status: item.lastStatus)
        }
    }

    private var detailRows: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ScheduledExportMetricLine(
                glyph: "tablecells",
                label: ScheduledExportsStrings.string("dataExport.scheduled.table.type", "Type"),
                value: item.typeFormatLabel(localize: model.localize)
            )
            ScheduledExportMetricLine(
                glyph: "clock.arrow.2.circlepath",
                label: ScheduledExportsStrings.string("dataExport.scheduled.table.cron", "Cron"),
                value: item.scheduleCron,
                monospaced: true
            )
            ScheduledExportMetricLine(
                glyph: "paperplane",
                label: ScheduledExportsStrings.string("dataExport.scheduled.table.delivery", "Delivery"),
                value: item.deliveryLabel(localize: model.localize)
            )
            ScheduledExportMetricLine(
                glyph: "calendar.badge.clock",
                label: ScheduledExportsStrings.string("dataExport.scheduled.table.nextRun", "Next run"),
                value: nextRunValue
            )
            ScheduledExportMetricLine(
                glyph: "checkmark.circle",
                label: ScheduledExportsStrings.string("dataExport.scheduled.table.lastRun", "Last run"),
                value: lastRunValue
            )
        }
        .accessibilityElement(children: .combine)
    }

    /// Web "Next run" cell: the timestamp, or the em-dash fallback when never scheduled.
    private var nextRunValue: String {
        guard let nextRunAt = item.nextRunAt else { return "—" }
        return model.formatTimestamp(nextRunAt)
    }

    /// Web "Last run" cell: the timestamp, or the "Never" wording when not yet run.
    private var lastRunValue: String {
        guard let lastRunAt = item.lastRunAt else {
            return ScheduledExportsStrings.string("dataExport.scheduled.status.never", "Never")
        }
        return model.formatTimestamp(lastRunAt)
    }
}

// MARK: - Status badge (web `Badge variant="success" | "danger"`)

/// The last-run status pill (web `last_status === 'ok' ? success : failed ? danger : —`).
struct ScheduledExportStatusBadge: View {
    let status: ScheduledExportRunStatus?

    var body: some View {
        switch status {
        case .ok:
            pill(key: "dataExport.scheduled.status.ok", fallback: "OK", tone: Color.TS.statusSuccess)
        case .failed:
            pill(key: "dataExport.scheduled.status.failed", fallback: "Failed", tone: Color.TS.statusDanger)
        case .none:
            Text(verbatim: "—")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func pill(key: String, fallback: String, tone: Color) -> some View {
        Text(verbatim: ScheduledExportsStrings.string(key, fallback))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - Metric line (web table cell: label + value)

/// One label/value metric line (a native reflow of a web `<td>`): a muted glyph + column
/// label and the secondary-toned value.
struct ScheduledExportMetricLine: View {
    let glyph: String
    let label: String
    let value: String
    var monospaced = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Image(systemName: glyph)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 14)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(monospaced ? .system(.caption, design: .monospaced) : Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
