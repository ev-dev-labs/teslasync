//
//  EnergyFlowWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0046 · EnergyFlowWidget (Apple)
//
//  Xcode previews for each surface state (content / regenerating / charging /
//  loading / empty / error / offline / compact). DEBUG-only; skipped by the swiftc
//  host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: EnergyFlowUpdate) -> EnergyFlowModel {
        let source = InMemoryEnergyFlowSource(initial: update)
        let model = EnergyFlowModel(source: source)
        model.start()
        return model
    }

    /// Driving: drawing 18.4 kW from the pack at 72% SoC.
    private let consumingState = EnergyFlowVehicleState(
        powerKw: 18.4, isCharging: false, chargerPowerKw: 0, batteryLevel: 72
    )
    /// Regenerating: returning 6.2 kW to the pack.
    private let regenState = EnergyFlowVehicleState(
        powerKw: -6.2, isCharging: false, chargerPowerKw: 0, batteryLevel: 68
    )
    /// Charging: 11 kW into the pack while parked.
    private let chargingState = EnergyFlowVehicleState(
        powerKw: 0, isCharging: true, chargerPowerKw: 11.0, batteryLevel: 55
    )

    #Preview("Content — consuming") {
        EnergyFlowWidget(
            model: previewModel(
                EnergyFlowUpdate(status: .loaded, connection: .live, state: consumingState, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — regenerating") {
        EnergyFlowWidget(
            model: previewModel(
                EnergyFlowUpdate(status: .loaded, connection: .live, state: regenState, updatedAt: Date())
            )
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — charging") {
        EnergyFlowWidget(
            model: previewModel(
                EnergyFlowUpdate(status: .loaded, connection: .live, state: chargingState, updatedAt: Date())
            )
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EnergyFlowWidget(model: previewModel(EnergyFlowUpdate(status: .loading)))
            .frame(width: 280, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No data") {
        EnergyFlowWidget(model: previewModel(EnergyFlowUpdate(status: .loaded, state: nil)))
            .frame(width: 280, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EnergyFlowWidget(model: previewModel(EnergyFlowUpdate(status: .failed("Network unavailable"))))
            .frame(width: 280, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        EnergyFlowWidget(
            model: previewModel(
                EnergyFlowUpdate(
                    status: .loaded,
                    connection: .offline,
                    state: consumingState,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        EnergyFlowWidget(
            model: previewModel(
                EnergyFlowUpdate(status: .loaded, connection: .stale, state: chargingState, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 150)
        .padding()
        .background(Color.TS.bg)
    }
#endif
