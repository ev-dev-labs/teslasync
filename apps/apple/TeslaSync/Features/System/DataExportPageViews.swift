//
//  DataExportPageViews.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Section views
//
//  The non-wizard panels of the Data Export surface: the GDPR "Download my data"
//  account-export panel (web `AccountExportPanel`, parity `GlassPanel1`), the CSV /
//  JSON format-preview cards (web `FormatInfoCards`, parity `GlassPanel3` /
//  `GlassPanel4`), and the data-overview card (web `DataOverviewCard`, parity
//  `GlassPanel9`). Each binds to the `@Observable` model; no networking in the view.
//

import SwiftUI

// MARK: - Account export panel (web `AccountExportPanel` — GlassPanel1)

struct DataExportAccountPanel: View {
    @Bindable var model: DataExportPageModel

    @State private var vehicleID: Int64?
    @State private var startDate: Date?
    @State private var endDate: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            headerRow
            fields
            footer
        }
        .dataExportPanel()
        .accessibilityElement(children: .contain)
    }

    private var headerRow: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "shippingbox.fill")
                .font(.title2)
                .foregroundStyle(.cyan)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(String(localized: "dataExport.account.title", defaultValue: "Download my data"))
                    .font(.headline)
                Text(String(
                    localized: "dataExport.account.subtitle",
                    defaultValue: """
                    Get a single ZIP containing every table we store for you — drives, charging, \
                    signal history, alerts, settings, and a manifest. Use this for backup, \
                    migration, or your personal records.
                    """
                ))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var fields: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 12) { vehiclePicker; startField; endField }
            VStack(alignment: .leading, spacing: 12) { vehiclePicker; startField; endField }
        }
    }

    private var vehiclePicker: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(String(localized: "dataExport.account.vehicle", defaultValue: "Vehicle"))
                .font(.caption).foregroundStyle(.secondary)
            Picker(selection: $vehicleID) {
                Text(String(localized: "dataExport.account.allVehicles", defaultValue: "All vehicles"))
                    .tag(Int64?.none)
                ForEach(model.vehicles) { vehicle in
                    Text(verbatim: vehicle.label).tag(Int64?.some(vehicle.id))
                }
            } label: {
                Text(String(localized: "dataExport.account.vehicle", defaultValue: "Vehicle"))
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var startField: some View {
        DataExportOptionalDateField(
            title: String(localized: "dataExport.account.startDate", defaultValue: "Start date (optional)"),
            date: $startDate
        )
    }

    private var endField: some View {
        DataExportOptionalDateField(
            title: String(localized: "dataExport.account.endDate", defaultValue: "End date (optional)"),
            date: $endDate
        )
    }

    private var footer: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: 12) { warning; Spacer(minLength: 8); startButton }
            VStack(alignment: .leading, spacing: 12) { warning; startButton }
        }
    }

    private var warning: some View {
        Label {
            Text(String(
                localized: "dataExport.account.warning",
                defaultValue: """
                Large signal histories are capped per table to keep the ZIP under control. \
                Track progress in the floating widget that appears once your export starts.
                """
            ))
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.circle").foregroundStyle(.secondary)
        }
    }

    private var startButton: some View {
        Button(action: start) {
            HStack(spacing: 8) {
                if model.isCreatingAccount {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "square.and.arrow.down")
                }
                Text(String(localized: "dataExport.account.start", defaultValue: "Start full export"))
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(model.isCreatingAccount)
    }

    private func start() {
        var payload = DataExportAccountPayload()
        payload.vehicleID = vehicleID
        let isoFormatter = ISO8601DateFormatter()
        if let startDate { payload.start = isoFormatter.string(from: startDate) }
        if let endDate { payload.end = isoFormatter.string(from: endDate) }
        Task { await model.createAccountExport(payload) }
    }
}

// MARK: - Optional date field (web optional `<input type="date">`)

/// A nilable date input — a toggle that, when enabled, reveals a compact
/// `DatePicker`. Mirrors the web "(optional)" date inputs which may be left blank.
struct DataExportOptionalDateField: View {
    let title: String
    @Binding var date: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: Binding(
                get: { date != nil },
                set: { date = $0 ? (date ?? Date()) : nil }
            )) {
                Text(verbatim: title).font(.caption).foregroundStyle(.secondary)
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
            if let bound = Binding($date) {
                DatePicker(selection: bound, displayedComponents: .date) {
                    Text(verbatim: title)
                }
                .labelsHidden()
                .datePickerStyle(.compact)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
    }
}

// MARK: - Format preview cards (web `FormatInfoCards` — GlassPanel3 / GlassPanel4)

struct DataExportFormatCards: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) { csvCard; jsonCard }
            VStack(spacing: 16) { csvCard; jsonCard }
        }
    }

    private var csvCard: some View {
        DataExportPreviewCard(
            title: String(localized: "dataExport.csvPreview", defaultValue: "CSV Preview"),
            description: String(
                localized: "dataExport.csvDesc",
                defaultValue: "Comma-separated values, compatible with Excel and Google Sheets"
            ),
            systemImage: "tablecells",
            tone: .cyan,
            lines: ["date,distance_m,efficiency_wh_per_m", "2025-01-15,45200,0.152", "2025-01-16,32800,0.148"]
        )
    }

    private var jsonCard: some View {
        DataExportPreviewCard(
            title: String(localized: "dataExport.jsonPreview", defaultValue: "JSON Preview"),
            description: String(
                localized: "dataExport.jsonDesc",
                defaultValue: "Structured JSON format for programmatic access"
            ),
            systemImage: "curlybraces",
            tone: .purple,
            lines: ["[{ \"date\": \"2025-01-15\",", "   \"distance_m\": 45200,", "   \"efficiency\": 152 }]"]
        )
    }
}

/// One format preview card (icon + title + description + monospace sample block).
struct DataExportPreviewCard: View {
    let title: String
    let description: String
    let systemImage: String
    let tone: DataExportTone
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tone.color)
            Text(verbatim: description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(lines, id: \.self) { line in
                    Text(verbatim: line)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .dataExportPanel()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(title). \(description)"))
    }
}

// MARK: - Data overview card (web `DataOverviewCard` — GlassPanel9)

struct DataExportOverviewCard: View {
    @Bindable var model: DataExportPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                String(localized: "dataExport.dataOverview", defaultValue: "Data Overview"),
                systemImage: "externaldrive.fill"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.cyan)
            content
        }
        .dataExportPanel()
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            VStack(alignment: .leading, spacing: 8) {
                ForEach(0 ..< 2, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 6).fill(.quaternary).frame(height: 16)
                        .redacted(reason: .placeholder) // parity:allow SwiftUI skeleton API
                }
            }
            .accessibilityHidden(true)
        default:
            if let overview = model.dataOverview {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) { driveRow(overview); chargeRow(overview) }
                    VStack(alignment: .leading, spacing: 8) { driveRow(overview); chargeRow(overview) }
                }
            } else {
                Text(String(localized: "dataExport.unavailable", defaultValue: "Unavailable"))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func driveRow(_ overview: DataOverview) -> some View {
        Label {
            Text(verbatim: "\(DataExportDisplay.int(overview.drives)) "
                + String(localized: "dataExport.drives", defaultValue: "Drives"))
        } icon: {
            Image(systemName: "car.fill").foregroundStyle(.cyan)
        }
        .font(.caption)
    }

    private func chargeRow(_ overview: DataOverview) -> some View {
        Label {
            Text(verbatim: "\(DataExportDisplay.int(overview.chargingSessions)) "
                + String(localized: "dataExport.chargingSessions", defaultValue: "Charging Sessions"))
        } icon: {
            Image(systemName: "bolt.fill").foregroundStyle(.green)
        }
        .font(.caption)
    }
}
