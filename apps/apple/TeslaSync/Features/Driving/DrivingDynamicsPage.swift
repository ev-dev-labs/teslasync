//
//  DrivingDynamicsPage.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple)
//
//  SwiftUI / HIG parity of `web/src/features/driving/pages/DrivingDynamicsPage.tsx`
//  (web route `/driving-dynamics`). The live-motor cockpit: the live-motor gauge
//  row, the G-force and pedal panels, the speed/gear panel, the autopilot/cruise
//  panel, the motor power/torque/rpm history charts, the three motor-efficiency
//  insight panels, the six summary stat cards, the full driving-coach section
//  (score gauge, style breakdown, efficiency, weekly trend, pattern bars,
//  recommendations, per-drive table), the drive-analytics charts with a date
//  range, and the driving-style recommendations. Adaptive across macOS + iOS
//  (ADR-002/006); every panel reproduced, the four page states implemented, and
//  every visible string from the catalog — all bound to `DrivingDynamicsPageModel`
//  (no business logic in the view body). SI values convert to the user's units
//  only here, at the render boundary, via the shared `Units` facade (ADR-005).
//

import SwiftUI

struct DrivingDynamicsPage: View {
    @State private var model: DrivingDynamicsPageModel

    init(model: DrivingDynamicsPageModel = DrivingDynamicsPageModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            switch model.viewState {
            case .loading:
                loadingView
            case .empty:
                emptyView
            case let .error(message):
                errorView(message)
            case .success:
                contentView
            }
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text(verbatim: DDynStrings.text("dynamics.title", "Driving Dynamics")))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if !model.vehicles.isEmpty {
                    vehiclePicker
                }
            }
        }
        .task {
            guard model.viewState == .loading, model.vehicles.isEmpty else { return }
            await model.load()
        }
        .refreshable { await model.refresh() }
    }

    // MARK: - Success (web PageContainer body — the `space-y-6` section stack)

    private var contentView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            subtitleHeader
            if model.isStale {
                stalenessChip
            }
            TSFadeIn { DDynLiveMotorSection(motor: model.motorLatest) }
            TSFadeIn(delay: 0.05) { DDynGForceSection(snapshot: model.driveDynamics) }
            TSFadeIn(delay: 0.10) { DDynPedalSection(snapshot: model.driveDynamics) }
            TSFadeIn(delay: 0.15) {
                DDynSpeedGearSection(
                    motor: model.motorLatest,
                    avgDriveSpeedMps: model.avgDriveSpeedMps,
                    topDriveSpeedMps: model.topDriveSpeedMps
                )
            }
            TSFadeIn(delay: 0.17) { DDynAutopilotSection(snapshot: model.autopilot) }
            DDynMotorHistorySection(history: model.motorHistory)
            TSFadeIn(delay: 0.35) {
                DDynMotorEfficiencySection(stats: model.motorStats, throttleStyle: model.throttleStyle)
            }
            TSFadeIn(delay: 0.40) { DDynSummaryStatsSection(stats: model.motorStats) }
            DDynCoachSection(coach: model.coach)
            DDynAnalyticsSection(model: model)
            TSFadeIn(delay: 0.60) {
                DDynTipsSection(stats: model.motorStats, throttleStyle: model.throttleStyle)
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 1100, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    /// Web `PageContainer subtitle`.
    private var subtitleHeader: some View {
        Text(verbatim: DDynStrings.text(
            "dynamics.subtitle",
            "Live motor telemetry, G-forces & driving analysis"
        ))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Live `> 2 min` staleness indicator (ADR-013).
    private var stalenessChip: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark").accessibilityHidden(true)
            Text(verbatim: DDynStrings.text("common.staleData", "Data may be out of date"))
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    // MARK: - Toolbar (web global VehicleSelect)

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            ForEach(model.vehicles) { vehicle in
                Text(verbatim: vehicle.displayName).tag(vehicle.id)
            }
        } label: {
            Label {
                Text(verbatim: model.activeVehicleName)
            } icon: {
                Image(systemName: "car.fill")
            }
        }
        .pickerStyle(.menu)
        .accessibilityLabel(DDynStrings.key("dynamics.selectVehicle"))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    // MARK: - Loading state (web `PageContainer loading` skeleton)

    private var loadingView: some View {
        VStack(spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        DrivingSectionTitle(DDynStrings.text("dynamics.liveMotor", "Live Motor Status"))
                        Text(verbatim: DDynStrings.text("dynamics.awaitingData", "Awaiting motor telemetry data..."))
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 1100)
        .frame(maxWidth: .infinity)
        .redacted(reason: .placeholder) // parity:allow native shimmer for the loading state
    }

    // MARK: - Empty state (no vehicles)

    private var emptyView: some View {
        TSEmptyState(
            title: DDynStrings.key("dynamics.title"),
            message: DDynStrings.key("dynamics.noLiveMotor"),
            systemImage: "speedometer"
        )
        .frame(maxWidth: .infinity, minHeight: 320)
        .padding(TSSpacing.lg)
    }

    // MARK: - Error state (web `PageContainer error`)

    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: "error.title",
                message: LocalizedStringKey(message),
                onRetry: { Task { await model.refresh() } }
            )
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
    }
}

#if DEBUG
    #Preview("Loaded") {
        NavigationStack { DrivingDynamicsPage() }
            .tsUnits(.metric)
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            DrivingDynamicsPage(model: DrivingDynamicsPageModel(dataSource: EmptyDrivingDynamicsDataSource()))
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            DrivingDynamicsPage(model: DrivingDynamicsPageModel(dataSource: FailingDrivingDynamicsDataSource()))
        }
        .teslaSyncTheme()
    }
#endif
