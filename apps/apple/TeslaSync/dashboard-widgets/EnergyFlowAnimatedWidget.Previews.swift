//
//  EnergyFlowAnimatedWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0045 · EnergyFlowAnimatedWidget (Apple)
//
//  Xcode previews for each surface state (content / regenerating / charging /
//  loading / empty / error / offline / compact). DEBUG-only; skipped by the
//  swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: EnergyFlowAnimatedUpdate) -> EnergyFlowAnimatedModel {
        let source = InMemoryEnergyFlowAnimatedSource(initial: update)
        let model = EnergyFlowAnimatedModel(source: source)
        model.start()
        return model
    }

    /// Driving: drawing 18.4 kW from the pack at 72% SoC.
    private let consumingState = EnergyFlowAnimatedVehicleState(
        powerKw: 18.4, isCharging: false, chargerPowerKw: 0, batteryLevel: 72
    )
    /// Regenerating: returning 6.2 kW to the pack.
    private let regenState = EnergyFlowAnimatedVehicleState(
        powerKw: -6.2, isCharging: false, chargerPowerKw: 0, batteryLevel: 68
    )
    /// Charging: 11 kW into the pack while parked.
    private let chargingState = EnergyFlowAnimatedVehicleState(
        powerKw: 0, isCharging: true, chargerPowerKw: 11.0, batteryLevel: 55
    )

    #Preview("Content — consuming") {
        EnergyFlowAnimatedWidget(
            model: previewModel(
                EnergyFlowAnimatedUpdate(status: .loaded, connection: .live, state: consumingState, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — regenerating") {
        EnergyFlowAnimatedWidget(
            model: previewModel(
                EnergyFlowAnimatedUpdate(status: .loaded, connection: .live, state: regenState, updatedAt: Date())
            )
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — charging") {
        EnergyFlowAnimatedWidget(
            model: previewModel(
                EnergyFlowAnimatedUpdate(status: .loaded, connection: .live, state: chargingState, updatedAt: Date())
            )
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EnergyFlowAnimatedWidget(model: previewModel(EnergyFlowAnimatedUpdate(status: .loading)))
            .frame(width: 280, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No data") {
        EnergyFlowAnimatedWidget(model: previewModel(EnergyFlowAnimatedUpdate(status: .loaded, state: nil)))
            .frame(width: 280, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EnergyFlowAnimatedWidget(model: previewModel(EnergyFlowAnimatedUpdate(status: .failed("Network unavailable"))))
            .frame(width: 280, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        EnergyFlowAnimatedWidget(
            model: previewModel(
                EnergyFlowAnimatedUpdate(
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
        EnergyFlowAnimatedWidget(
            model: previewModel(
                EnergyFlowAnimatedUpdate(status: .loaded, connection: .stale, state: chargingState, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 150)
        .padding()
        .background(Color.TS.bg)
    }
#endif
