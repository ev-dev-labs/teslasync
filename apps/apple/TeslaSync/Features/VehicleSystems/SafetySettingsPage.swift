//
//  SafetySettingsPage.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple)
//
//  SwiftUI / HIG parity of web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx
//  (route `/safety-settings`) — ADAS safety: a safety-score gauge + four summary
//  MetricCards, the live belt/seat/lock signal grid, the driving-stat distances,
//  the nine ADAS feature cards, a safety-state step chart and a history table.
//  Adaptive across macOS and iOS (ADR-002, ADR-006). Fourteen panels, two Swift
//  Charts surfaces (RadialGauge · LineChart), the four data states, and every
//  visible string from the catalog. Bound to `SafetySettingsPageModel`; no
//  business logic in the view body.
//

import SwiftUI

struct SafetySettingsPage: View {
    @State private var model = SafetySettingsPageModel()

    var body: some View {
        ScrollView {
            switch model.viewState {
            case .loading:
                loadingView
            case let .error(message):
                errorView(message)
            case .empty:
                emptyView
            case .success:
                contentView
            }
        }
        .navigationTitle(safetyText("Safety Settings"))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                vehiclePicker
            }
        }
        .task { await model.load() }
        .refreshable { await model.refresh() }
    }

    // MARK: - Success / content

    private var contentView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            subtitleHeader
            if model.isStale {
                SafetyStalenessChip()
            }
            if let message = model.inlineErrorMessage {
                SafetyInlineError(message: message)
            }
            SafetyScoreSection(model: model)
            SafetyLiveSignalsPanel(cells: model.signalCells)
            SafetyDrivingStatsPanel(
                distanceSinceReset: model.distanceSinceResetText,
                selfDrivingDistance: model.selfDrivingDistanceText,
                distanceUnit: model.distanceUnit
            )
            SafetyFeaturesPanel(cards: model.featureCards)
            SafetyStatesChartPanel(points: model.chartPoints)
            SafetySettingsHistoryTable(rows: model.historyDescending)
        }
        .padding()
        .frame(maxWidth: 1100, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    private var subtitleHeader: some View {
        Text(safetyText("ADAS features, safety score, and driving stats"))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Toolbar (web VehicleSelect)

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            ForEach(model.vehicles) { vehicle in
                Text(vehicle.displayName).tag(vehicle.id)
            }
        } label: {
            Label(model.activeVehicleName, systemImage: "car.fill")
        }
        .pickerStyle(.menu)
        .accessibilityLabel(Text(safetyText("Safety Settings")))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    // MARK: - Loading state

    private var loadingView: some View {
        VStack(spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                SafetyPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        Text(verbatim: "Safety settings panel")
                            .font(Font.TS.section)
                        Text(verbatim: "Loading safety settings data")
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding()
        .frame(maxWidth: 1100)
        .frame(maxWidth: .infinity)
        .redacted(reason: .placeholder) // parity:allow native shimmer for the loading state
    }

    // MARK: - Empty state

    private var emptyView: some View {
        ContentUnavailableView {
            Label(
                safetyText("Safety Settings"),
                systemImage: "shield.lefthalf.filled"
            )
        } description: {
            Text(safetyText("No safety data available for this vehicle."))
        }
        .padding()
    }

    // MARK: - Error state

    private func errorView(_ message: String) -> some View {
        let prefix = safetyKey("error.loadFailed", "Failed to load data")
        return ContentUnavailableView {
            Label(
                safetyText("Safety Settings"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text("\(prefix): \(message)")
        } actions: {
            Button(safetyKey("common.retry", "Retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

#Preview {
    NavigationStack {
        SafetySettingsPage()
    }
}
