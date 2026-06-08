//
//  FleetTelemetryHealth.Tables.swift
//  TeslaSync — P4 feature view · 0005 · FleetTelemetryHealth (Apple)
//
//  The two data tables composed by `FleetTelemetryHealth` — the native counterpart of
//  the web `DataTable`s. The Error-VINs table's VIN cell toggles the error-log filter
//  (web clickable VIN button); the Error-Log table renders the danger code badge, the
//  message (em-dash when absent), and the recency-colored reported-at. Each row is a
//  single combined VoiceOver element built from the pure `FleetHealthAccessibility`
//  summaries. Columns align via shared fixed/flexible widths so the header tracks rows.
//

import SwiftUI

// MARK: - Column widths (shared header/row alignment)

private enum FleetHealthColumn {
    static let time: CGFloat = 124
    static let vin: CGFloat = 148
    static let code: CGFloat = 112
}

// MARK: - Timestamp cell (web `TimeStamp`)

/// An absolute timestamp body colored by its recency emphasis (web rose/amber/secondary),
/// with the relative form folded into the accessibility value. Em-dash when absent.
struct FleetHealthTimestampCell: View {
    let date: Date?
    let emphasis: FleetHealthTimeEmphasis

    var body: some View {
        Text(verbatim: FleetHealthTimestamp.absolute(for: date))
            .font(Font.TS.caption)
            .foregroundStyle(FleetHealthProjection.color(for: emphasis))
            .lineLimit(1)
            .accessibilityLabel(Text(verbatim: accessibilityValue))
    }

    private var accessibilityValue: String {
        guard let date else { return FleetHealthProjection.emDash }
        return "\(FleetHealthTimestamp.absolute(for: date)), \(FleetHealthTimestamp.relative(for: date))"
    }
}

// MARK: - Error code badge (web danger `Badge` / em-dash)

/// The danger-toned error-code badge (web `<Badge variant="danger">`); the muted em-dash
/// when the record carries no code.
struct FleetHealthCodeBadge: View {
    let code: String?

    var body: some View {
        if let code {
            let tone = TSTone.danger.color
            Text(verbatim: code)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tone)
                .lineLimit(1)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 2)
                .background(tone.opacity(0.15), in: Capsule())
                .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
        } else {
            Text(verbatim: FleetHealthProjection.emDash)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Error VINs table (web first `DataTable`)

/// The Error-VINs table: VIN (taps toggle the error-log filter) · First Seen · Last Seen.
struct FleetHealthVINTable: View {
    let rows: [FleetVINRow]
    let selectedVin: String?
    let onToggle: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(Color.TS.border)
            ForEach(rows) { row in
                FleetHealthVINRowView(row: row, isSelected: row.vin == selectedVin, onToggle: onToggle)
                Divider().overlay(Color.TS.border.opacity(0.5))
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.md) {
            FleetHealthStrings.text("devtools.health.vin", "VIN")
                .frame(maxWidth: .infinity, alignment: .leading)
            FleetHealthStrings.text("devtools.health.firstSeen", "First Seen")
                .frame(width: FleetHealthColumn.time, alignment: .leading)
            FleetHealthStrings.text("devtools.health.lastSeen", "Last Seen")
                .frame(width: FleetHealthColumn.time, alignment: .leading)
        }
        .font(Font.TS.label)
        .foregroundStyle(Color.TS.textSecondary)
        .padding(.vertical, TSSpacing.xs)
    }
}

/// One Error-VINs row. The whole row is a tap target that toggles the filter (web only
/// links the VIN text; a fully-tappable row is the idiomatic native affordance), exposed
/// to VoiceOver as one labeled, selectable button via the pure row summary.
struct FleetHealthVINRowView: View {
    let row: FleetVINRow
    let isSelected: Bool
    let onToggle: (String) -> Void

    var body: some View {
        Button { onToggle(row.vin) } label: {
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: row.vin)
                    .font(.system(size: 12, design: .monospaced))
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundStyle(Color.TS.accent)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                FleetHealthTimestampCell(date: row.firstSeen, emphasis: .normal)
                    .frame(width: FleetHealthColumn.time, alignment: .leading)
                FleetHealthTimestampCell(date: row.lastSeen, emphasis: row.lastSeenEmphasis)
                    .frame(width: FleetHealthColumn.time, alignment: .leading)
            }
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FleetHealthAccessibility.vinRowSummary(
            row,
            localize: FleetHealthStrings.string
        )))
        .accessibilityHint(FleetHealthStrings.text("devtools.health.filterHint", "Filters the error log by this VIN"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Error Log table (web second `DataTable`)

/// The Error-Log table: VIN · Error Code (danger badge / em-dash) · Message · Reported At.
struct FleetHealthErrorTable: View {
    let rows: [FleetErrorRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(Color.TS.border)
            ForEach(rows) { row in
                FleetHealthErrorRowView(row: row)
                Divider().overlay(Color.TS.border.opacity(0.5))
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.md) {
            FleetHealthStrings.text("devtools.health.vin", "VIN")
                .frame(width: FleetHealthColumn.vin, alignment: .leading)
            FleetHealthStrings.text("devtools.health.errorCode", "Error Code")
                .frame(width: FleetHealthColumn.code, alignment: .leading)
            FleetHealthStrings.text("devtools.health.message", "Message")
                .frame(maxWidth: .infinity, alignment: .leading)
            FleetHealthStrings.text("devtools.health.reportedAt", "Reported At")
                .frame(width: FleetHealthColumn.time, alignment: .leading)
        }
        .font(Font.TS.label)
        .foregroundStyle(Color.TS.textSecondary)
        .padding(.vertical, TSSpacing.xs)
    }
}

/// One Error-Log row, exposed to VoiceOver as one labeled element via the pure summary.
struct FleetHealthErrorRowView: View {
    let row: FleetErrorRow

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Text(verbatim: row.vin)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .frame(width: FleetHealthColumn.vin, alignment: .leading)
            FleetHealthCodeBadge(code: row.errorCode)
                .frame(width: FleetHealthColumn.code, alignment: .leading)
            Text(verbatim: row.errorMessage ?? FleetHealthProjection.emDash)
                .font(Font.TS.caption)
                .foregroundStyle(row.errorMessage == nil ? Color.TS.textMuted : Color.TS.textSecondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            FleetHealthTimestampCell(date: row.reportedAt, emphasis: row.reportedAtEmphasis)
                .frame(width: FleetHealthColumn.time, alignment: .leading)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FleetHealthAccessibility.errorRowSummary(
            row,
            localize: FleetHealthStrings.string
        )))
    }
}
