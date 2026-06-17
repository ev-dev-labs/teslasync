//
//  TeslaChargingSessionsTable.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple) — Sessions table
//
//  GlassPanel 10 — the "Charging Sessions" table (web `DataTable`). A header row
//  (Date · Location · VIN · Energy · Peak · Duration · Cost · Rate · Type) over the
//  range-filtered, sorted rows, with sortable headers (Date / Energy / Peak / Cost
//  — web `handleSort`), the tinted value cells the web renders (energy cyan, peak
//  amber, cost emerald), and an "Export CSV" `ShareLink` (web `bulkActions` /
//  `exportSelectedCsv`). Loading shows a redacted skeleton; an empty slice shows
//  the `noData` `ContentUnavailableView` — never a blank region. Energy is
//  converted from SI Wh at the boundary.
//

import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers

// MARK: - CSV export (web exportSelectedCsv / DataTable export)

/// A transferable CSV document of the table rows — the native parity of the web
/// `exportSelectedCsv` blob download, surfaced through a HIG `ShareLink`.
struct ChargingSessionsCSVFile: Transferable {
    let text: String
    let filename: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .commaSeparatedText) { file in
            Data(file.text.utf8)
        }
        .suggestedFileName { $0.filename }
    }
}

/// Builds the CSV payload (web `exportSelectedCsv` header + rows). Energy stays in
/// SI watt-hours in the export, exactly like the web download.
enum ChargingSessionsCSV {
    static func make(rows: [TeslaFleetChargingSession]) -> ChargingSessionsCSVFile {
        let header = [
            "date", "location", "vin", "energy_wh", "peak_power_kw",
            "duration_seconds", "cost", "currency", "per_kwh_rate", "charger_type"
        ]
        var lines = [header.joined(separator: ",")]
        for row in rows {
            let energy = row.totalEnergyAddedWh.isFinite ? doubleString(row.totalEnergyAddedWh) : ""
            let duration = row.chargeDurationS.map { intString(Int($0)) } ?? ""
            let fields: [String] = [
                row.chargeStartDatetime,
                row.siteLocationName,
                row.vin,
                energy,
                optionalDoubleString(row.peakPowerKw),
                duration,
                optionalDoubleString(row.totalCost),
                row.currencyCode ?? "",
                optionalDoubleString(row.perKwhRate),
                row.chargerType ?? ""
            ]
            lines.append(fields.map(escape).joined(separator: ","))
        }
        let today = dateStamp(Date())
        return ChargingSessionsCSVFile(
            text: lines.joined(separator: "\n"),
            filename: "tesla-fleet-sessions-\(today).csv"
        )
    }

    private static func optionalDoubleString(_ value: Double?) -> String {
        value.map(doubleString) ?? ""
    }

    private static func doubleString(_ value: Double) -> String {
        "\(value)"
    }

    private static func intString(_ value: Int) -> String {
        "\(value)"
    }

    /// Web export filename stamp (`YYYY-MM-DD`). A local formatter keeps the helper
    /// free of non-`Sendable` shared state under Swift 6 strict concurrency.
    static func dateStamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// RFC-4180 quoting (web `"${String(f).replace(/"/g, '""')}"`).
    private static func escape(_ field: String) -> String {
        "\"\(field.replacingOccurrences(of: "\"", with: "\"\""))\""
    }
}

// MARK: - GlassPanel 10 — sessions table

struct ChargingSessionsTable: View {
    let rows: [TeslaFleetChargingSession]
    let userCurrency: String
    let sortKey: ChargingSessionsSortKey
    let sortDirection: ChargingSessionsSortDirection
    let isLoading: Bool
    let onSort: (ChargingSessionsSortKey) -> Void

    var body: some View {
        ChargingSessionsCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if isLoading {
                    tableSkeleton
                } else if rows.isEmpty {
                    emptyState
                } else {
                    ScrollView(.horizontal, showsIndicators: true) {
                        table
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Header + export action

    private var header: some View {
        HStack(spacing: TSSpacing.md) {
            ChargingSessionsSectionHeader(
                systemImage: "list.bullet.rectangle",
                title: String(localized: "translation.tesla_sessions.table", defaultValue: "Charging Sessions")
            )
            Spacer(minLength: TSSpacing.sm)
            if !rows.isEmpty {
                ShareLink(
                    item: ChargingSessionsCSV.make(rows: rows),
                    preview: SharePreview(exportLabel)
                ) {
                    Label(exportLabel, systemImage: "square.and.arrow.down")
                }
                .accessibilityLabel(Text(exportLabel))
            }
        }
    }

    private var exportLabel: String {
        String(localized: "translation.table.bulkActions.exportCsv", defaultValue: "Export CSV")
    }

    // MARK: Table grid

    private var table: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.xl, verticalSpacing: TSSpacing.sm) {
            GridRow {
                sortableHeader(.date, title: dateTitle)
                headerCell(locationTitle)
                headerCell(vinTitle)
                sortableHeader(.energy, title: energyTitle)
                sortableHeader(.peakPower, title: peakTitle)
                headerCell(durationTitle)
                sortableHeader(.cost, title: costTitle)
                headerCell(rateTitle)
                headerCell(typeTitle)
            }
            Divider().gridCellColumns(9)
            ForEach(rows) { row in
                GridRow {
                    cell(ChargingSessionsFormat.dateTime(row.chargeStartDatetime), tone: Color.TS.textPrimary)
                    locationCell(row)
                    cell(vinText(row), tone: Color.TS.textSecondary, mono: true)
                    cell(energyText(row), tone: Color.TS.chartSeriesRegen, weight: .medium)
                    cell(peakText(row), tone: Color.TS.statusWarning)
                    cell(ChargingSessionsFormat.duration(row.chargeDurationS), tone: Color.TS.textPrimary)
                    cell(costText(row), tone: Color.TS.statusSuccess, weight: .medium)
                    cell(rateText(row), tone: Color.TS.textSecondary)
                    cell(typeText(row), tone: Color.TS.textSecondary, uppercase: true)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, TSSpacing.xs)
    }

    // MARK: Header cells

    private func headerCell(_ text: String) -> some View {
        Text(text)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
    }

    private func sortableHeader(_ key: ChargingSessionsSortKey, title: String) -> some View {
        Button {
            onSort(key)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text(title)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(sortKey == key ? Color.TS.accent : Color.TS.textMuted)
                if sortKey == key {
                    Image(systemName: sortDirection == .descending ? "chevron.down" : "chevron.up")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color.TS.accent)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(sortKey == key ? sortStateText : ""))
    }

    private var sortStateText: String {
        sortDirection == .descending
            ? String(localized: "translation.common.sortDesc", defaultValue: "Sorted descending")
            : String(localized: "translation.common.sortAsc", defaultValue: "Sorted ascending")
    }

    // MARK: Body cells

    private func cell(
        _ text: String,
        tone: Color,
        weight: Font.Weight = .regular,
        mono: Bool = false,
        uppercase: Bool = false
    ) -> some View {
        Text(text)
            .font(mono ? Font.TS.bodySm.monospaced() : Font.TS.bodySm)
            .fontWeight(weight)
            .textCase(uppercase ? .uppercase : nil)
            .foregroundStyle(tone)
            .lineLimit(1)
    }

    private func locationCell(_ row: TeslaFleetChargingSession) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "mappin")
                .font(.system(size: 11))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(row.siteLocationName.isEmpty ? ChargingSessionsFormat.dash : row.siteLocationName)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .frame(maxWidth: 220, alignment: .leading)
        }
    }

    // MARK: Cell text (web column render fns)

    private func vinText(_ row: TeslaFleetChargingSession) -> String {
        row.vin.isEmpty ? ChargingSessionsFormat.dash : "…\(ChargingSessionsFormat.lastSix(row.vin))"
    }

    private func energyText(_ row: TeslaFleetChargingSession) -> String {
        ChargingSessionsFormat.number(ChargingSessionsConvert.energyFromWh(row.totalEnergyAddedWh), fractionDigits: 1)
    }

    private func peakText(_ row: TeslaFleetChargingSession) -> String {
        guard let peak = row.peakPowerKw else { return ChargingSessionsFormat.dash }
        return ChargingSessionsFormat.number(peak, fractionDigits: 0)
    }

    private func costText(_ row: TeslaFleetChargingSession) -> String {
        ChargingSessionsFormat.currency(row.totalCost, code: row.currencyCode ?? userCurrency, fractionDigits: 2)
    }

    private func rateText(_ row: TeslaFleetChargingSession) -> String {
        ChargingSessionsFormat.currency(row.perKwhRate, code: row.currencyCode ?? userCurrency, fractionDigits: 3)
    }

    private func typeText(_ row: TeslaFleetChargingSession) -> String {
        row.chargerType ?? ChargingSessionsFormat.dash
    }

    // MARK: Column titles

    private var dateTitle: String {
        String(localized: "translation.tesla_sessions.col.date", defaultValue: "Date")
    }

    private var locationTitle: String {
        String(localized: "translation.tesla_sessions.col.location", defaultValue: "Location")
    }

    private var vinTitle: String {
        String(localized: "translation.tesla_sessions.col.vin", defaultValue: "VIN")
    }

    private var energyTitle: String {
        String(localized: "translation.tesla_sessions.col.energy", defaultValue: "Energy (kWh)")
    }

    private var peakTitle: String {
        String(localized: "translation.tesla_sessions.col.peakPower", defaultValue: "Peak (kW)")
    }

    private var durationTitle: String {
        String(localized: "translation.tesla_sessions.col.duration", defaultValue: "Duration")
    }

    private var costTitle: String {
        String(localized: "translation.tesla_sessions.col.cost_decimal", defaultValue: "Cost")
    }

    private var rateTitle: String {
        String(localized: "translation.tesla_sessions.col.rate", defaultValue: "Rate/kWh")
    }

    private var typeTitle: String {
        String(localized: "translation.tesla_sessions.col.type", defaultValue: "Type")
    }

    // MARK: Empty + loading

    private var emptyState: some View {
        ContentUnavailableView {
            Label(
                String(
                    localized: "translation.tesla_sessions.noData",
                    defaultValue: "No fleet charging sessions yet. Click \"Refresh from Tesla\" to import data."
                ),
                systemImage: "info.circle"
            )
        }
        .frame(maxWidth: .infinity)
    }

    private var tableSkeleton: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 6, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.sm)
                    .fill(Color.TS.surface)
                    .frame(height: 28)
            }
        }
        .redacted(reason: .placeholder) // parity:allow native shimmer for the table loading state
    }
}
