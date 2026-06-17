//
//  TirePressurePage.swift
//  TeslaSync — P4 feature view · P7 · TirePressure (Apple)
//
//  SwiftUI / HIG parity of web/src/features/vehicle-systems/pages/TirePressurePage.tsx
//  — TPMS monitoring: four corner gauges, a summary row, a pressure-history chart
//  and a history table. Adaptive across macOS and iOS (ADR-002, ADR-006). Nine
//  panels (warning banner · gauges · per-corner gauge · four MetricCards · chart
//  · table), two Swift Charts surfaces (RadialGauge · LineChart), the four data
//  states, and every visible string from the catalog. Bound to
//  `TirePressurePageModel`; no business logic in the view body.
//

import SwiftUI

struct TirePressurePage: View {
    @State private var model = TirePressurePageModel()

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
        .navigationTitle(String(localized: "translation.tirePressure.title", defaultValue: "Tire Pressure"))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                vehiclePicker
                rangeMenu
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
                TirePressureStalenessChip()
            }
            if let message = model.inlineErrorMessage {
                inlineError(message)
            }
            if model.hasWarning {
                TirePressureWarningBanner(isHard: model.isHardWarning)
            }
            TirePressureGaugesPanel(
                latest: model.latest,
                unit: model.pressureUnit,
                gaugeMaximum: model.gaugeMaximum,
                isLoading: model.isLoadingLatest
            )
            TirePressureSummaryRow(
                summary: model.summary,
                unit: model.pressureUnit,
                lastUpdated: model.lastUpdatedAt
            )
            TirePressureHistoryChartPanel(
                points: model.chartPoints,
                unit: model.pressureUnit,
                isLoading: model.isLoadingHistory
            )
            TirePressureHistoryTable(
                rows: model.historyDescending,
                unit: model.pressureUnit,
                isLoading: model.isLoadingHistory
            )
        }
        .padding()
        .frame(maxWidth: 1100, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    private var subtitleHeader: some View {
        Text(String(
            localized: "translation.tirePressure.subtitle",
            defaultValue: "Monitor tire pressure readings and history"
        ))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
    }

    /// Web `anyError` inline AlertBanner — shown when a secondary request fails
    /// while the latest snapshot still rendered.
    private func inlineError(_ message: String) -> some View {
        let prefix = String(localized: "translation.error.loadFailed", defaultValue: "Failed to load data")
        return HStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text("\(prefix): \(message)")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.statusDanger.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .stroke(Color.TS.statusDanger.opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    // MARK: - Toolbar (web VehicleSelect + RangePicker)

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            ForEach(model.vehicles) { vehicle in
                Text(vehicle.displayName).tag(vehicle.id)
            }
        } label: {
            Label(model.activeVehicleName, systemImage: "car.fill")
        }
        .pickerStyle(.menu)
        .accessibilityLabel(Text(String(
            localized: "translation.tirePressure.selectVehicle",
            defaultValue: "Select vehicle"
        )))
    }

    private var rangeMenu: some View {
        Picker(selection: rangeBinding) {
            ForEach(TirePressureRange.allCases) { range in
                Text(range.label).tag(range)
            }
        } label: {
            Label(model.selectedRange.label, systemImage: "calendar")
        }
        .pickerStyle(.menu)
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    private var rangeBinding: Binding<TirePressureRange> {
        Binding(
            get: { model.selectedRange },
            set: { newRange in Task { await model.selectRange(newRange) } }
        )
    }

    // MARK: - Loading state

    private var loadingView: some View {
        VStack(spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TirePressureCard {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        Text(verbatim: "Tire pressure panel")
                            .font(Font.TS.section)
                        Text(verbatim: "Loading tire pressure data")
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
                String(localized: "translation.tirePressure.title", defaultValue: "Tire Pressure"),
                systemImage: "gauge.with.dots.needle.bottom.50percent"
            )
        } description: {
            Text(String(
                localized: "translation.tirePressure.subtitle",
                defaultValue: "Monitor tire pressure readings and history"
            ))
        }
        .padding()
    }

    // MARK: - Error state

    private func errorView(_ message: String) -> some View {
        let prefix = String(localized: "translation.error.loadFailed", defaultValue: "Failed to load data")
        return ContentUnavailableView {
            Label(
                String(localized: "translation.tirePressure.title", defaultValue: "Tire Pressure"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text("\(prefix): \(message)")
        } actions: {
            Button(String(localized: "translation.common.retry", defaultValue: "Retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

#Preview {
    NavigationStack {
        TirePressurePage()
    }
}
