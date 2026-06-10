//
//  ServiceHealthSection.Table.swift
//  TeslaSync — P4 feature view · 0252 · ServiceHealthSection (Apple)
//
//  The streaming-vehicles table — the SwiftUI parity of the web `DataTable` in
//  features/system/components/status/ServiceHealthSection.tsx, carrying the same six
//  columns (VIN · Status · Signals · Signals/s · Latency · Last Received) over the
//  shared `TSDataTable`, with the web `sortable` Signals column and the inline "No
//  vehicles connected" empty message. Cell content + the per-row VoiceOver label are
//  composed from the P1/S10 facade + P1/S9 tokens — no networking, no Tailwind ports,
//  no raw hex.
//

import SwiftUI

/// The streaming-vehicles table — the shared `TSDataTable` carrying the six web
/// columns, or the inline "No vehicles connected" message when the fleet is idle
/// (web DataTable `emptyMessage` — the section is never hidden).
struct ServiceHealthVehicleTable: View {
    let vehicles: [ServiceVehicleRow]

    var body: some View {
        if vehicles.isEmpty {
            ServiceHealthVehiclesEmptyRow()
        } else {
            TSDataTable(rows: vehicles, columns: columns, density: .compact)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var columns: [TSColumn<ServiceVehicleRow>] {
        [vinColumn, statusColumn, signalsColumn, rateColumn, latencyColumn, lastReceivedColumn]
    }

    // MARK: Cell helpers

    private func statusLabel(for row: ServiceVehicleRow) -> String {
        ServiceHealthStrings.string(row.streamingState.labelKey, row.streamingState.labelFallback)
    }

    private func rowAccessibilityLabel(for row: ServiceVehicleRow) -> String {
        let signals = "\(ServiceHealthFormat.int(row.signalCount)) \(ServiceHealthStrings.string("Signals", "Signals"))"
        let rate = "\(ServiceHealthFormat.signalRate(row.signalsPerSecond)) "
            + ServiceHealthStrings.string("Signals/s", "Signals/s")
        let vin = "\(ServiceHealthStrings.string("VIN", "VIN")) \(row.vin)"
        return ServiceHealthAccessibility.vehicleLabel(ServiceVehicleSpoken(
            status: statusLabel(for: row),
            vin: vin,
            signals: signals,
            rate: rate,
            latency: ServiceHealthFormat.latency(row.latencyMs),
            lastReceived: ServiceHealthFormat.dateTime(row.lastReceivedISO)
        ))
    }

    // MARK: Columns

    private var vinColumn: TSColumn<ServiceVehicleRow> {
        TSColumn(
            id: "vin",
            title: ServiceHealthStrings.key("VIN", "VIN"),
            comparator: { lhs, rhs in lhs.vin.localizedCompare(rhs.vin) },
            cell: { row in
                Text(verbatim: row.vin)
                    .font(Font.TS.caption.monospaced())
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(for: row)))
            }
        )
    }

    private var statusColumn: TSColumn<ServiceVehicleRow> {
        TSColumn(
            id: "status",
            title: ServiceHealthStrings.key("Status", "Status"),
            cell: { row in
                TSStatusPill(
                    ServiceHealthStrings.key(row.streamingState.labelKey, row.streamingState.labelFallback),
                    tone: row.streamingState.tone.tsTone
                )
            }
        )
    }

    private var signalsColumn: TSColumn<ServiceVehicleRow> {
        TSColumn(
            id: "signals",
            title: ServiceHealthStrings.key("Signals", "Signals"),
            comparator: { lhs, rhs in ServiceHealthColumnCompare.doubles(lhs.signalCount, rhs.signalCount) },
            cell: { row in
                Text(verbatim: ServiceHealthFormat.int(row.signalCount))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var rateColumn: TSColumn<ServiceVehicleRow> {
        TSColumn(id: "rate", title: ServiceHealthStrings.key("Signals/s", "Signals/s")) { row in
            Text(verbatim: ServiceHealthFormat.signalRate(row.signalsPerSecond))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var latencyColumn: TSColumn<ServiceVehicleRow> {
        TSColumn(id: "latency", title: ServiceHealthStrings.key("Latency", "Latency")) { row in
            Text(verbatim: ServiceHealthFormat.latency(row.latencyMs))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var lastReceivedColumn: TSColumn<ServiceVehicleRow> {
        TSColumn(id: "lastReceived", title: ServiceHealthStrings.key("Last Received", "Last Received")) { row in
            Text(verbatim: ServiceHealthFormat.dateTime(row.lastReceivedISO))
                .foregroundStyle(Color.TS.textSecondary)
        }
    }
}

// MARK: - Inline empty row (web DataTable `emptyMessage`)

/// The inline "No vehicles connected" row — the web DataTable `emptyMessage`, shown
/// in place of the table when the fleet has no streaming vehicles.
private struct ServiceHealthVehiclesEmptyRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: ServiceHealthStrings.string("No vehicles connected", "No vehicles connected"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Column comparators (sortable Signals + VIN columns)

/// Pure comparators for the sortable table columns, kept separate so the cell
/// builders stay declarative and the sort logic is reused across columns.
enum ServiceHealthColumnCompare {
    static func doubles(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs < rhs { return .orderedAscending }
        if lhs > rhs { return .orderedDescending }
        return .orderedSame
    }
}
