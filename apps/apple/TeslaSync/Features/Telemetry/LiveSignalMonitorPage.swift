//
//  LiveSignalMonitorPage.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/LiveSignalMonitor (Apple)
//
//  SwiftUI / Apple HIG parity of the web `/live-monitor` page
//  (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx). A thin
//  orchestrator over one `@Observable` model: the header carries the title,
//  subtitle, the `<VehicleSelect>` picker and the live connection badge; the
//  body is the shared `LiveSignalTail` (controls + four stat tiles + the
//  scrolling signal table). Adaptive across macOS (regular) and iOS
//  (compact / regular) per ADR-002 / ADR-006.
//

import SwiftUI

public struct LiveSignalMonitorPage: View {
    @State private var model: LiveSignalMonitorPageModel

    public init(model: LiveSignalMonitorPageModel = LiveSignalMonitorPageModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                LiveSignalTailPanel(model: model)
            }
            .padding()
            .frame(maxWidth: 1200, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(LMText.title)
        .background(backgroundStyle)
        .task { await model.load() }
        .onChange(of: model.selectedVehicleID) { _, _ in model.onVehicleChange() }
        .onDisappear { model.stopLive() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(LMText.title).font(.largeTitle).fontWeight(.bold)
                Text(LMText.subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            actionsRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var actionsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { actionControls }
            VStack(alignment: .leading, spacing: 10) { actionControls }
        }
    }

    @ViewBuilder private var actionControls: some View {
        vehiclePicker
        Spacer(minLength: 0)
        connectionBadge
    }

    @ViewBuilder private var vehiclePicker: some View {
        switch model.vehiclesPhase {
        case .loading where model.vehicles.isEmpty:
            ProgressView().controlSize(.small)
                .accessibilityLabel(LMText.title)
        case .error:
            Button {
                Task { await model.retryVehicles() }
            } label: {
                Label(LMText.loadFailed, systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        default:
            Picker("Vehicle", selection: $model.selectedVehicleID) {
                ForEach(model.vehicles) { vehicle in
                    Text(vehicle.displayName).tag(vehicle.id)
                }
            }
            .pickerStyle(.menu)
            .accessibilityLabel("Vehicle")
            .disabled(model.vehicles.isEmpty)
        }
    }

    private var connectionBadge: some View {
        Label(model.connectionLabel, systemImage: "circle.fill")
            .font(.caption)
            .fontWeight(.medium)
            .foregroundStyle(model.connected ? .green : .red)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                (model.connected ? Color.green : Color.red).opacity(0.12),
                in: Capsule()
            )
            .accessibilityLabel(model.connectionLabel)
    }

    private var backgroundStyle: some ShapeStyle {
        #if os(iOS)
        return Color(.systemGroupedBackground)
        #else
        return Color(nsColor: .windowBackgroundColor)
        #endif
    }
}

// MARK: - Preview

#if DEBUG
#Preview("LiveSignalMonitor — Connected") {
    NavigationStack {
        LiveSignalMonitorPage()
    }
}

#Preview("LiveSignalMonitor — Disconnected") {
    let model = LiveSignalMonitorPageModel(
        vehicleSource: SampleLiveSignalMonitorVehicleSource(),
        stream: SimulatedLiveSignalStream()
    )
    return NavigationStack {
        LiveSignalMonitorPage(model: model)
    }
}
#endif
