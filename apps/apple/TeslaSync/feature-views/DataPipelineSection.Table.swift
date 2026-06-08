//
//  DataPipelineSection.Table.swift
//  TeslaSync — P4 feature view · 0242 · DataPipelineSection (Apple)
//
//  The Export Job Queue table — the SwiftUI parity of the web `DataTable` in
//  features/system/components/status/DataPipelineSection.tsx, carrying the same six
//  columns (status · type · format · file · records · created) over the shared
//  `TSDataTable`. Cell content + the per-row VoiceOver label are composed from the
//  P1/S10 facade + P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

/// The export-job queue table — the shared `TSDataTable` carrying the six web columns
/// (status · type · format · file · records · created).
struct DataPipelineJobsTable: View {
    let jobs: [ExportJobItem]

    var body: some View {
        TSDataTable(rows: jobs, columns: columns, density: .compact)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var columns: [TSColumn<ExportJobItem>] {
        [statusColumn, typeColumn, formatColumn, fileColumn, recordsColumn, createdColumn]
    }

    // MARK: Cell helpers

    private func statusLabel(for job: ExportJobItem) -> String {
        let kind = job.statusKind
        guard kind != .unknown else { return job.status }
        return DataPipelineStrings.string(kind.labelKey, kind.labelFallback)
    }

    private func rowAccessibilityLabel(for job: ExportJobItem) -> String {
        let records = "\(DataPipelineFormat.int(job.recordCount)) \(DataPipelineStrings.string("Records", "Records"))"
        return DataPipelineAccessibility.rowLabel(
            status: statusLabel(for: job),
            type: job.type,
            records: records,
            created: DataPipelineFormat.dateTime(job.createdAt)
        )
    }

    // MARK: Columns

    private var statusColumn: TSColumn<ExportJobItem> {
        TSColumn(
            id: "status",
            title: DataPipelineStrings.key("Status", "Status"),
            comparator: { lhs, rhs in lhs.status.localizedCompare(rhs.status) },
            cell: { job in
                let kind = job.statusKind
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: kind.symbolName)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(kind.tone.tsTone.color)
                        .accessibilityHidden(true)
                    Text(verbatim: statusLabel(for: job))
                        .foregroundStyle(kind.tone.tsTone.color)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(for: job)))
            }
        )
    }

    private var typeColumn: TSColumn<ExportJobItem> {
        TSColumn(
            id: "type",
            title: DataPipelineStrings.key("Type", "Type"),
            comparator: { lhs, rhs in lhs.type.localizedCompare(rhs.type) },
            cell: { job in
                Text(verbatim: job.type)
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var formatColumn: TSColumn<ExportJobItem> {
        TSColumn(id: "format", title: DataPipelineStrings.key("Format", "Format")) { job in
            TSBadge(LocalizedStringKey(job.format), tone: .neutral)
        }
    }

    private var fileColumn: TSColumn<ExportJobItem> {
        TSColumn(
            id: "file",
            title: DataPipelineStrings.key("File", "File"),
            comparator: { lhs, rhs in lhs.fileName.localizedCompare(rhs.fileName) },
            cell: { job in
                Text(verbatim: job.fileName)
                    .font(Font.TS.caption.monospaced())
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        )
    }

    private var recordsColumn: TSColumn<ExportJobItem> {
        TSColumn(
            id: "records",
            title: DataPipelineStrings.key("Records", "Records"),
            comparator: { lhs, rhs in DataPipelineColumnCompare.doubles(lhs.recordCount, rhs.recordCount) },
            cell: { job in
                Text(verbatim: DataPipelineFormat.int(job.recordCount))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var createdColumn: TSColumn<ExportJobItem> {
        TSColumn(
            id: "created",
            title: DataPipelineStrings.key("Created", "Created"),
            comparator: { lhs, rhs in DataPipelineColumnCompare.dates(lhs.createdAt, rhs.createdAt) },
            cell: { job in
                Text(verbatim: DataPipelineFormat.dateTime(job.createdAt))
                    .foregroundStyle(Color.TS.textSecondary)
            }
        )
    }
}

// MARK: - Column comparators (sortable record-count + created-at columns)

/// Pure comparators for the sortable table columns, kept separate so the cell builders
/// stay declarative and the sort logic is reused across columns.
enum DataPipelineColumnCompare {
    static func doubles(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs < rhs { return .orderedAscending }
        if lhs > rhs { return .orderedDescending }
        return .orderedSame
    }

    static func dates(_ lhs: Date?, _ rhs: Date?) -> ComparisonResult {
        switch (lhs, rhs) {
        case let (left?, right?): left.compare(right)
        case (nil, nil): .orderedSame
        case (nil, _): .orderedAscending
        case (_, nil): .orderedDescending
        }
    }
}
