//
//  ChargerSpecsPanel.Previews.swift
//  TeslaSync — P4 feature view · 0098 · ChargerSpecsPanel (Apple)
//
//  Xcode previews for each surface state (content / content with empty sub-columns / fully
//  populated / empty / loading / error / stale / offline). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ChargerSpecsUpdate) -> ChargerSpecsPanelModel {
        let source = InMemoryChargerSpecsSource(initial: update)
        let model = ChargerSpecsPanelModel(source: source)
        model.start()
        return model
    }

    /// The real-world shape `computeChargerSpecs` produces: Cable + Brand populated (Brand carries
    /// average power), Voltage + Phase empty so their columns show their own empty message.
    private func realisticSpecs() -> ChargerSpecsInput {
        ChargerSpecsInput(
            cable: [
                ChargerSpecEntryInput(name: "CCS", count: 14, energyWattHours: 312_400),
                ChargerSpecEntryInput(name: "Type 2", count: 9, energyWattHours: 84700)
            ],
            brand: [
                ChargerSpecEntryInput(
                    name: "Supercharger",
                    count: 11,
                    energyWattHours: 268_100,
                    averagePowerWatts: 92500
                ),
                ChargerSpecEntryInput(name: "AC/Home", count: 23, energyWattHours: 151_900, averagePowerWatts: 7200)
            ]
        )
    }

    /// A breakdown with all four columns populated (Voltage + Phase included) to exercise the full
    /// grid layout.
    private func fullSpecs() -> ChargerSpecsInput {
        ChargerSpecsInput(
            voltage: [
                ChargerSpecEntryInput(name: "400 V", count: 12, energyWattHours: 240_000),
                ChargerSpecEntryInput(name: "230 V", count: 7, energyWattHours: 58000)
            ],
            phase: [
                ChargerSpecEntryInput(name: "3-phase", count: 8, energyWattHours: 120_000),
                ChargerSpecEntryInput(name: "1-phase", count: 11, energyWattHours: 64000)
            ],
            cable: [ChargerSpecEntryInput(name: "CCS", count: 14, energyWattHours: 312_400)],
            brand: [
                ChargerSpecEntryInput(
                    name: "Supercharger",
                    count: 11,
                    energyWattHours: 268_100,
                    averagePowerWatts: 92500
                )
            ]
        )
    }

    private func loadedUpdate(
        specs: ChargerSpecsInput,
        connection: ChargerSpecsConnection = .live
    ) -> ChargerSpecsUpdate {
        ChargerSpecsUpdate(status: .loaded, connection: connection, specs: specs, updatedAt: Date())
    }

    @MainActor
    private func previewSurface(_ update: ChargerSpecsUpdate) -> some View {
        ScrollView {
            ChargerSpecsPanel(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (real-world)") {
        previewSurface(loadedUpdate(specs: realisticSpecs()))
    }

    #Preview("Content (all columns)") {
        previewSurface(loadedUpdate(specs: fullSpecs()))
    }

    #Preview("Empty") {
        previewSurface(ChargerSpecsUpdate(status: .loaded, specs: ChargerSpecsInput()))
    }

    #Preview("Loading") {
        previewSurface(ChargerSpecsUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(ChargerSpecsUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(specs: realisticSpecs(), connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(specs: realisticSpecs(), connection: .offline))
    }
#endif
