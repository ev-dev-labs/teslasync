//
//  DataExportWizardView.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Export wizard
//
//  SwiftUI parity of the web `ExportWizard` (the "New Export" GlassPanel). Reproduces
//  the four web steps — data type (the type-card grid), format, an optional column
//  picker (web `ColumnPickerSection`, driven by `useExportColumns`), vehicle, and the
//  date range (presets + custom range) — plus the Start Export submit. Form state is
//  view-local (web `useState`); submission and the column catalog flow through the
//  `@Observable` model (ADR-004). Adaptive: the type grid reflows by size class.
//

import SwiftUI

struct DataExportWizardView: View {
    @Bindable var model: DataExportPageModel

    @State private var exportType: DataExportType = .drives
    @State private var exportFormat: DataExportFormat = .csv
    @State private var vehicleID: Int64?
    @State private var presetDays = 30
    @State private var useCustomRange = false
    @State private var customStart = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    @State private var customEnd = Date()
    /// Column allowlist (web `selectedColumns`): `nil` = untouched (submit omits it).
    @State private var selectedColumns: [String]?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            step(title: String(localized: "dataExport.wizard.step1", defaultValue: "STEP 1 — Select Data Type")) {
                DataExportTypeSelector(selected: exportType, onSelect: changeType)
            }
            step(title: String(localized: "dataExport.wizard.step2", defaultValue: "STEP 2 — Choose Format")) {
                DataExportFormatSelector(selected: $exportFormat)
            }
            columnsStep
            if !model.vehicles.isEmpty {
                step(title: String(localized: "dataExport.wizard.step3", defaultValue: "STEP 3 — Select Vehicle")) {
                    vehiclePicker
                }
            }
            step(title: String(localized: "dataExport.wizard.step4", defaultValue: "STEP 4 — Date Range")) {
                dateRange
            }
            submitButton
        }
        .dataExportPanel()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: wizardTitle))
        .task(id: exportType) { await model.loadColumns(for: exportType) }
    }

    // MARK: Header (web wizard title)

    private var wizardTitle: String {
        String(localized: "dataExport.wizardTitle", defaultValue: "New Export")
    }

    private var header: some View {
        Label(wizardTitle, systemImage: "arrow.down.doc.fill")
            .font(.title3.weight(.semibold))
            .foregroundStyle(.primary)
    }

    // MARK: Step scaffold (web step `<p>` label + content)

    private func step(
        title: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: title)
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Columns step (web `ColumnPickerSection`)

    @ViewBuilder
    private var columnsStep: some View {
        switch model.columnsState {
        case .hidden:
            EmptyView()
        case .loading:
            step(title: String(localized: "dataExport.columns.title", defaultValue: "STEP 2½ — Columns")) {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.quaternary)
                    .frame(height: 96)
                    .redacted(reason: .placeholder) // parity:allow SwiftUI skeleton API
                    .accessibilityHidden(true)
            }
        case let .loaded(columns):
            step(title: String(localized: "dataExport.columns.title", defaultValue: "STEP 2½ — Columns")) {
                DataExportColumnPicker(
                    columns: columns,
                    selectedColumns: $selectedColumns
                )
            }
        }
    }

    // MARK: Vehicle picker (web `<Select>` with All Vehicles)

    private var vehiclePicker: some View {
        Picker(selection: $vehicleID) {
            Text(String(localized: "All Vehicles", defaultValue: "All Vehicles"))
                .tag(Int64?.none)
            ForEach(model.vehicles) { vehicle in
                Text(verbatim: vehicle.label).tag(Int64?.some(vehicle.id))
            }
        } label: {
            Text(String(localized: "Vehicle", defaultValue: "Vehicle"))
        }
        .pickerStyle(.menu)
        .accessibilityLabel(
            Text(String(localized: "dataExport.allVehicles", defaultValue: "All Vehicles"))
        )
    }

    // MARK: Date range (web `DatePresetSelector` + custom range)

    private var dateRange: some View {
        VStack(alignment: .leading, spacing: 12) {
            DataExportPresetSelector(
                selectedDays: useCustomRange ? -1 : presetDays,
                onSelect: selectPreset
            )
            Button {
                useCustomRange.toggle()
            } label: {
                Label(
                    String(localized: "dataExport.customRange", defaultValue: "Custom Range"),
                    systemImage: "calendar"
                )
            }
            .buttonStyle(.bordered)
            .tint(useCustomRange ? .accentColor : .secondary)
            if useCustomRange {
                customRangeFields
            }
        }
    }

    private var customRangeFields: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) { startField; endField }
            VStack(alignment: .leading, spacing: 12) { startField; endField }
        }
    }

    private var startField: some View {
        DatePicker(
            String(localized: "Start", defaultValue: "Start"),
            selection: $customStart,
            displayedComponents: .date
        )
        .datePickerStyle(.compact)
    }

    private var endField: some View {
        DatePicker(
            String(localized: "End", defaultValue: "End"),
            selection: $customEnd,
            displayedComponents: .date
        )
        .datePickerStyle(.compact)
    }

    // MARK: Submit (web Start Export button)

    private var submitButton: some View {
        Button(action: submit) {
            HStack(spacing: 8) {
                if model.isSubmitting {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "square.and.arrow.down")
                }
                Text(String(localized: "Start Export", defaultValue: "Start Export"))
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(model.isSubmitting)
    }

    // MARK: Intents

    private func changeType(_ next: DataExportType) {
        exportType = next
        selectedColumns = nil
    }

    private func selectPreset(_ days: Int) {
        presetDays = days
        useCustomRange = false
    }

    private func submit() {
        var payload = DataExportSubmitPayload(type: exportType, format: exportFormat)
        payload.vehicleID = vehicleID
        if useCustomRange {
            payload.start = DataExportDisplay.today(customStart)
            payload.end = DataExportDisplay.today(customEnd)
        } else if presetDays > 0 {
            payload.start = DataExportDisplay.daysAgo(presetDays)
            payload.end = DataExportDisplay.today()
        }
        if let columns = selectedColumns, !columns.isEmpty {
            payload.columns = columns
        }
        Task { await model.submitExport(payload) }
    }
}

#if DEBUG
    #Preview("Wizard") {
        ScrollView {
            DataExportWizardView(model: DataExportPageModel())
                .padding()
        }
    }
#endif
