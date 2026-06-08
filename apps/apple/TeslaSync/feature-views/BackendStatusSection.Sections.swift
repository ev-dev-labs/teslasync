//
//  BackendStatusSection.Sections.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  The three populated content sections composed by `BackendStatusSection`, the
//  SwiftUI parity of the web body:
//    1. Component Health — the web `<DataTable>` (Status / Component / Latency /
//       Failures / Last Check) rendered as a native `Grid` on regular widths and
//       stacked cards on compact iPhone widths, with the inline "No components
//       found" empty message.
//    2. Database Connection Pool — the web `<Grid cols 2/5>` of `<StatCard>`s
//       (Max Open / Open / In Use / Idle / Wait Count) as an adaptive tile grid.
//    3. System Runtime — the web `<KVList columns={2}>` (Go Version / Uptime /
//       Goroutines / OS-Arch) as an adaptive key/value grid.
//  Copy resolves through the P1/S10 facade; chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - 1 · Component Health (web `<DataTable>`)

/// The Component Health section — the section heading over the responsive
/// component table (or the inline empty message when there are no rows, web
/// `emptyMessage={t('No components found')}`).
struct BackendComponentHealthSection: View {
    let rows: [BackendComponentRow]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            BackendSectionTitle(key: "Component Health", fallback: "Component Health")
            if rows.isEmpty {
                BackendComponentsEmptyRow()
            } else {
                BackendComponentTable(rows: rows)
            }
        }
    }
}

/// The inline "No components found" row (web DataTable `emptyMessage`).
private struct BackendComponentsEmptyRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: BackendStatusStrings.string("No components found", "No components found"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

/// The component table — a native `Grid` (Status / Component / Latency / Failures /
/// Last Check) on regular widths, stacked cards on compact iPhone widths.
struct BackendComponentTable: View {
    let rows: [BackendComponentRow]
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isWide: Bool {
            horizontalSizeClass != .compact
        }
    #else
        private var isWide: Bool {
            true
        }
    #endif

    var body: some View {
        if isWide {
            wideGrid
        } else {
            compactList
        }
    }

    private var wideGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                columnHeader("Status", "Status")
                columnHeader("Component", "Component")
                columnHeader("Latency", "Latency")
                columnHeader("Failures", "Failures")
                columnHeader("Last Check", "Last Check")
            }
            Rectangle().fill(Color.TS.border).frame(height: 1).gridCellColumns(5)
            ForEach(rows) { row in
                gridRow(for: row)
                if row.id != rows.last?.id {
                    Rectangle().fill(Color.TS.border.opacity(0.4)).frame(height: 1).gridCellColumns(5)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var compactList: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(rows) { row in
                BackendComponentCard(row: row)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func columnHeader(_ key: String, _ fallback: String) -> some View {
        Text(verbatim: BackendStatusStrings.string(key, fallback))
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
    }

    private func gridRow(for row: BackendComponentRow) -> some View {
        GridRow {
            BackendStatusBadgeCell(status: row.status, tone: row.tone)
            Text(verbatim: row.name)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
            Text(verbatim: BackendStatusFormat.latency(row.latencyMs))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            BackendFailuresValue(failures: row.failures)
            Text(verbatim: BackendStatusFormat.dateTime(row.lastCheckISO))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: BackendStatusAccessibility.componentLabel(
            row,
            latencyText: BackendStatusFormat.latency(row.latencyMs),
            lastCheckText: BackendStatusFormat.dateTime(row.lastCheckISO),
            localize: BackendStatusStrings.string
        )))
    }
}

/// The failure count cell — tinted danger when non-zero (web `row.failures > 0 &&
/// 'text-red-400'`), otherwise the secondary text color.
struct BackendFailuresValue: View {
    let failures: Int

    var body: some View {
        Text(verbatim: BackendStatusFormat.int(failures))
            .font(Font.TS.caption)
            .fontWeight(failures > 0 ? .semibold : .regular)
            .foregroundStyle(failures > 0 ? Color.TS.statusDanger : Color.TS.textSecondary)
    }
}

/// One component as a stacked card (compact iPhone width): the status cell + name
/// header, then the Latency / Failures / Last Check key/value lines.
struct BackendComponentCard: View {
    let row: BackendComponentRow

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: row.name)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                BackendStatusBadgeCell(status: row.status, tone: row.tone)
            }
            kvLine("Latency", "Latency") {
                Text(verbatim: BackendStatusFormat.latency(row.latencyMs))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            kvLine("Failures", "Failures") {
                BackendFailuresValue(failures: row.failures)
            }
            kvLine("Last Check", "Last Check") {
                Text(verbatim: BackendStatusFormat.dateTime(row.lastCheckISO))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: BackendStatusAccessibility.componentLabel(
            row,
            latencyText: BackendStatusFormat.latency(row.latencyMs),
            lastCheckText: BackendStatusFormat.dateTime(row.lastCheckISO),
            localize: BackendStatusStrings.string
        )))
    }

    private func kvLine(_ key: String, _ fallback: String, @ViewBuilder value: () -> some View) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: BackendStatusStrings.string(key, fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            value()
        }
    }
}

// MARK: - 2 · Database Connection Pool (web `<Grid>` of `<StatCard>`)

/// The Database Connection Pool section — the section heading over an adaptive grid
/// of five stat tiles (web `Grid cols={{ default: 2, md: 5 }}`).
struct BackendConnectionPoolSection: View {
    let stats: [BackendPoolStat]

    private let columns = [GridItem(.adaptive(minimum: 132), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            BackendSectionTitle(key: "Database Connection Pool", fallback: "Database Connection Pool")
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(stats) { stat in
                    BackendPoolTile(stat: stat)
                }
            }
        }
    }
}

/// One connection-pool stat tile — the native parity of the web `<StatCard label
/// value icon>`: an uppercase muted label + icon box, then the large value.
struct BackendPoolTile: View {
    let stat: BackendPoolStat

    var body: some View {
        let label = BackendStatusStrings.string(stat.metric.labelKey, stat.metric.labelKey)
        return TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    Text(verbatim: label)
                        .font(Font.TS.label)
                        .textCase(.uppercase)
                        .tracking(0.6)
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    TSIconBox(systemName: stat.metric.symbol, tone: .accent)
                }
                Text(verbatim: stat.value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(stat.value)"))
    }
}

// MARK: - 3 · System Runtime (web `<KVList columns={2}>`)

/// The System Runtime section — the section heading over an adaptive key/value
/// grid (web `KVList columns={2}`): Go Version, Uptime, Goroutines, OS / Arch.
struct BackendSystemRuntimeSection: View {
    let rows: [BackendRuntimeRow]

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            BackendSectionTitle(key: "System Runtime", fallback: "System Runtime")
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(rows) { row in
                    BackendRuntimeKVRow(row: row)
                }
            }
        }
    }
}

/// One system-runtime key/value line — a muted label and a monospaced value
/// (web `KVList` row → `TSCode` value).
struct BackendRuntimeKVRow: View {
    let row: BackendRuntimeRow

    var body: some View {
        let label = BackendStatusStrings.string(row.labelKey, row.labelKey)
        return HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: row.value)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(row.value)"))
    }
}
