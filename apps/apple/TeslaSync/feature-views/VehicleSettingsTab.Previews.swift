//
//  VehicleSettingsTab.Previews.swift
//  TeslaSync — P4 feature view · 0308 · VehicleSettingsTab (Apple)
//
//  Xcode previews for each surface state (data with mixed sources + a populated and an
//  empty timestamp, plus saving / validation-error / loading / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum VehicleSettingsPreviewData {
        /// A fixed RFC3339 instant for the populated `mute_until` row.
        static let muteUntil = "2026-06-20T09:30:00Z"

        /// A representative resolved payload exercising every source layer.
        static let populated = VehicleSettingsInput(
            settings: [
                ResolvedSetting(key: "nickname", value: "Lightning", source: .override),
                ResolvedSetting(key: "mute_until", value: muteUntil, source: .user),
                ResolvedSetting(key: "charge_cost_tariff_id", value: nil, source: .systemDefault),
                ResolvedSetting(key: "units_distance", value: "km", source: .vehicle),
                ResolvedSetting(key: "units_temperature", value: "C", source: .user),
                ResolvedSetting(key: "units_energy", value: "kWh", source: .systemDefault)
            ],
            connection: .live
        )

        static func connection(_ connection: VehicleSettingsConnection) -> VehicleSettingsInput {
            var input = populated
            input.connection = connection
            return input
        }
    }

    @MainActor
    private func previewModel(
        _ input: VehicleSettingsInput,
        descriptors: [VehicleSettingDescriptor] = VehicleSettingsCatalog.descriptors
    ) -> VehicleSettingsTabModel {
        let source = InMemoryVehicleSettingsSource(initial: input)
        let model = VehicleSettingsTabModel(source: source, descriptors: descriptors)
        model.start()
        return model
    }

    @MainActor
    private func savingModel() -> VehicleSettingsTabModel {
        // No auto-settle: the row stays in `inFlight` so the button shows the spinner.
        let model = previewModel(VehicleSettingsPreviewData.populated)
        model.edit(key: "nickname", draft: .text("Thunderbolt"))
        model.save(key: "nickname")
        return model
    }

    @MainActor
    private func validationErrorModel() -> VehicleSettingsTabModel {
        let model = previewModel(VehicleSettingsPreviewData.populated)
        // Empty the required nickname then attempt a save → inline "Value is required."
        model.edit(key: "nickname", draft: .text(""))
        model.save(key: "nickname")
        return model
    }

    #Preview("Data") {
        ScrollView {
            VehicleSettingsTab(model: previewModel(VehicleSettingsPreviewData.populated))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Saving") {
        ScrollView {
            VehicleSettingsTab(model: savingModel())
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Validation error") {
        ScrollView {
            VehicleSettingsTab(model: validationErrorModel())
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleSettingsTab(model: previewModel(VehicleSettingsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VehicleSettingsTab(model: previewModel(VehicleSettingsInput(), descriptors: []))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleSettingsTab(model: previewModel(
            VehicleSettingsInput(errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            VehicleSettingsTab(model: previewModel(VehicleSettingsPreviewData.connection(.stale)))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            VehicleSettingsTab(model: previewModel(VehicleSettingsPreviewData.connection(.offline)))
                .padding()
        }
        .background(Color.TS.bg)
    }
#endif
