//
//  DigitalTwinPage.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/DigitalTwin (Apple) — Root view
//
//  Native SwiftUI / Apple HIG parity of `web/src/features/vehicles/pages/DigitalTwinPage.tsx`,
//  adaptive across macOS + iOS (ADR-002/006). One source of truth — the `@Observable`
//  `DigitalTwinPageModel` — drives the loading / empty / error / ready states. When a vehicle is in
//  scope the page lays out the visualization panel (GlassPanel2) beside the three detail panels
//  (Doors / Windows / Security, GlassPanel3-5) on regular widths and stacks them on compact, mirroring
//  the web `flex-col lg:flex-row`. The toolbar carries the vehicle selector (web `VehicleSelect`); the
//  per-vehicle feeds poll on the web's 5s cadence. All copy resolves from `Localizable.xcstrings` with
//  the web key names; no networking lives in the view (ADR-004).
//

import SwiftUI

struct DigitalTwinPage: View {
    @State private var model: DigitalTwinPageModel

    init(dataSource: any DigitalTwinDataSource = SampleDigitalTwinDataSource()) {
        _model = State(initialValue: DigitalTwinPageModel(dataSource: dataSource))
    }

    init(model: DigitalTwinPageModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                subtitle
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("translation.digitalTwin.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .toolbar { toolbarContent }
            .refreshable { await model.refresh() }
            .task { await runLiveLoop() }
    }

    // MARK: - Header (web PageContainer subtitle)

    private var subtitle: some View {
        Text("translation.digitalTwin.subtitle")
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Toolbar vehicle selector (web `VehicleSelect`)

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            if !model.vehicles.isEmpty {
                vehicleSelector
            }
        }
    }

    private var vehicleSelector: some View {
        Menu {
            ForEach(model.vehicles) { vehicle in
                Button {
                    Task { await model.select(vehicle.id) }
                } label: {
                    if vehicle.id == model.selectedVehicleID {
                        Label {
                            Text(verbatim: vehicle.primaryName)
                        } icon: {
                            Image(systemName: "checkmark")
                        }
                    } else {
                        Text(verbatim: vehicle.primaryName)
                    }
                }
            }
        } label: {
            Label {
                Text(verbatim: model.selectedVehicle?.primaryName ?? "")
            } icon: {
                Image(systemName: "car.2.fill")
            }
        }
        .disabled(model.vehicles.count < 2)
    }

    // MARK: - State switch (web `vehiclesLoading ? skeleton : (vehicle ? body : empty)`)

    @ViewBuilder
    private var content: some View {
        switch model.status {
        case .loading:
            DigitalTwinSkeleton()
        case .empty:
            DigitalTwinNoVehiclesPanel()
        case let .error(message):
            errorState(message)
        case .ready:
            readyBody
        }
    }

    private func errorState(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSErrorDisplay(onRetry: { Task { await model.load() } })
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Ready body (web `flex-col lg:flex-row`)

    private var readyBody: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                visualization
                    .frame(maxWidth: .infinity, alignment: .top)
                sidePanels
                    .frame(width: 320)
            }
            VStack(spacing: TSSpacing.lg) {
                visualization
                sidePanels
            }
        }
    }

    private var visualization: some View {
        DigitalTwinVisualizationPanel(
            twin: model.twin,
            exteriorColor: model.selectedVehicle?.exteriorColor,
            paintStore: model.paintStore,
            paintInput: model.paintInput,
            lastUpdated: model.lastUpdated
        )
    }

    private var sidePanels: some View {
        VStack(spacing: TSSpacing.lg) {
            DigitalTwinDoorsPanel(twin: model.twin, hasSecurityData: model.securityPresent)
            DigitalTwinWindowsPanel(twin: model.twin, hasSecurityData: model.securityPresent)
            DigitalTwinSecurityPanel(
                twin: model.twin,
                badge: model.badge,
                showsBadge: model.selectedVehicle != nil
            )
        }
    }

    // MARK: - Live loop (web 5s `REFRESH_INTERVAL` poll)

    private func runLiveLoop() async {
        await model.load()
        while !Task.isCancelled {
            try? await Task.sleep(for: DigitalTwinPageModel.refreshInterval)
            if Task.isCancelled { break }
            await model.refresh()
        }
    }
}

#if DEBUG
    #Preview("Ready") {
        NavigationStack {
            DigitalTwinPage(dataSource: SampleDigitalTwinDataSource())
        }
    }

    #Preview("No security feed") {
        NavigationStack {
            DigitalTwinPage(dataSource: SignallessDigitalTwinDataSource())
        }
    }

    #Preview("Empty") {
        NavigationStack {
            DigitalTwinPage(dataSource: EmptyDigitalTwinDataSource())
        }
    }

    #Preview("Error") {
        NavigationStack {
            DigitalTwinPage(dataSource: FailingDigitalTwinDataSource())
        }
    }
#endif
