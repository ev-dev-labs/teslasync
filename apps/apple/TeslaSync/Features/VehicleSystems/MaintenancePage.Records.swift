import SwiftUI

// The Service-Records panel (web GlassPanel11): a sortable, adaptive `DataTable` of date / description /
// mileage / cost / provider, or — when the vehicle has no records — a "logged yet" empty state. The
// table itself carries the web `emptyMessage` ("No service records found."), shown if its rows are
// empty. Never a blank region.

// MARK: - Records panel (web GlassPanel11)

/// The Service-Records panel (web GlassPanel11). Mirrors the web nesting: a no-records section empty
/// state (`No service records logged yet.`) or the records `DataTable`, whose own empty message is the
/// web `emptyMessage` prop (`No service records found.`).
struct MaintenanceRecordsSection: View {
    let records: [ServiceRecord]
    let currencySymbol: String

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("Service Records")
                if records.isEmpty {
                    TSEmptyState(
                        title: "No service records logged yet.",
                        systemImage: "wrench.and.screwdriver"
                    )
                    .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    MaintenanceRecordsTable(
                        records: records,
                        emptyMessage: "No service records found.",
                        currencySymbol: currencySymbol
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Records table (web `DataTable<ServiceRecord>`)

/// The adaptive service-records table (web `DataTable`): a columnar grid on macOS / regular width and a
/// card list on compact iPhone width, with the web column set + the `emptyMessage` fallback.
struct MaintenanceRecordsTable: View {
    let records: [ServiceRecord]
    let emptyMessage: LocalizedStringKey
    let currencySymbol: String

    var body: some View {
        if records.isEmpty {
            TSEmptyState(title: emptyMessage, systemImage: "tray")
                .frame(maxWidth: .infinity, minHeight: 120)
        } else {
            TSDataTable(rows: records, columns: columns, density: .compact)
                .accessibilityLabel(Text("Service Records"))
        }
    }

    private var columns: [TSColumn<ServiceRecord>] {
        [
            TSColumn(
                id: "date",
                title: "Date",
                comparator: { Self.compare($0.date.timeIntervalSince1970, $1.date.timeIntervalSince1970) },
                cell: { record in Text(verbatim: MaintenanceFormat.dateTime(record.date)) }
            ),
            TSColumn(
                id: "description",
                title: "Description",
                cell: { record in Text(verbatim: record.details).lineLimit(1) }
            ),
            TSColumn(
                id: "mileage",
                title: "Mileage",
                comparator: { Self.compare($0.mileage, $1.mileage) },
                cell: { record in Text(verbatim: MaintenanceFormat.mileageLabel(record.mileage)) }
            ),
            TSColumn(
                id: "cost",
                title: "Cost",
                comparator: { Self.compare($0.cost, $1.cost) },
                cell: { record in
                    Text(verbatim: MaintenanceFormat.currency(record.cost, symbol: currencySymbol))
                }
            ),
            TSColumn(
                id: "provider",
                title: "Provider",
                cell: { record in
                    Text(verbatim: record.provider.isEmpty ? MaintenanceFormat.emptyValue : record.provider)
                }
            )
        ]
    }

    private static func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs < rhs { return .orderedAscending }
        if lhs > rhs { return .orderedDescending }
        return .orderedSame
    }
}
