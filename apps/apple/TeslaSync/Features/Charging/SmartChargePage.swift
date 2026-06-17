//
//  SmartChargePage.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple)
//
//  SwiftUI / HIG parity of web/src/features/charging/pages/SmartChargePage.tsx —
//  the Smart Charge planner: an opt-in Helix draft card, a charge-settings form,
//  and (once optimized) a 24-hour rate timeline, a three-up cost comparison, the
//  recommended schedule with Apply, plus the plan-history table. Adaptive across
//  macOS + iOS (ADR-002, ADR-006). Seven panels, the four page data states, and
//  every visible string from the catalog, all bound to `SmartChargePageModel`;
//  no business logic lives in the view body.
//

import SwiftUI

struct SmartChargePage: View {
    @State private var model: SmartChargePageModel

    init(model: SmartChargePageModel = SmartChargePageModel()) {
        _model = State(initialValue: model)
    }

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
        .navigationTitle(Text(verbatim: SmartChargeStrings.text("chargePlanner.title", "Smart Charge")))
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
                stalenessChip
            }
            TSFadeIn {
                SmartChargeAIPanel(vehicleID: model.selectedVehicleID, ratePlanID: model.ratePlanID)
            }
            TSFadeIn {
                SmartChargeSettingsPanel(model: model)
            }
            resultPanels
            TSFadeIn(delay: model.result != nil ? 0.20 : 0.05) {
                SmartChargeHistoryPanel(
                    state: model.historyState,
                    items: model.historyItems,
                    onRetry: { Task { await model.refresh() } }
                )
            }
        }
        .padding()
        .frame(maxWidth: 1100, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var resultPanels: some View {
        if let result = model.result {
            TSFadeIn(delay: 0.05) {
                SmartChargeRateTimelinePanel(result: result, chargeWindow: model.chargeWindow)
            }
            TSFadeIn(delay: 0.10) {
                SmartChargeCostCardsRow(result: result)
            }
            TSFadeIn(delay: 0.15) {
                SmartChargeSchedulePanel(model: model, result: result)
            }
        }
    }

    private var subtitleHeader: some View {
        Text(verbatim: SmartChargeStrings.text(
            "chargePlanner.subtitle",
            "Optimize charging schedule for the cheapest TOU rates"
        ))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
    }

    /// Live `> 2 min` staleness indicator (ADR-013).
    private var stalenessChip: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark").accessibilityHidden(true)
            Text(verbatim: SmartChargeStrings.text("common.staleData", "Data may be out of date"))
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    // MARK: - Toolbar (web VehicleSelect)

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            ForEach(model.vehicles) { vehicle in
                Text(verbatim: vehicle.displayName).tag(vehicle.id)
            }
        } label: {
            Label(model.activeVehicleName, systemImage: "car.fill")
        }
        .pickerStyle(.menu)
        .accessibilityLabel(SmartChargeStrings.key("chargePlanner.selectVehicle"))
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
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        Text(verbatim: "Charge settings section")
                            .font(Font.TS.section)
                        Text(verbatim: "Loading smart charge data")
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

    // MARK: - Empty state (no vehicles to plan for)

    private var emptyView: some View {
        ContentUnavailableView {
            Label(
                SmartChargeStrings.key("chargePlanner.title"),
                systemImage: "bolt.badge.clock"
            )
        } description: {
            Text(SmartChargeStrings.key("chargePlanner.subtitle"))
        }
        .padding()
    }

    // MARK: - Error state

    private func errorView(_ message: String) -> some View {
        ContentUnavailableView {
            Label(
                SmartChargeStrings.key("chargePlanner.title"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text(verbatim: message)
        } actions: {
            Button(SmartChargeStrings.key("common.retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

#Preview {
    NavigationStack {
        SmartChargePage()
    }
}
