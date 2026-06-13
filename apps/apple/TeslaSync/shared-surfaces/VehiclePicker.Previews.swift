//
//  VehiclePicker.Previews.swift
//  TeslaSync — P4 shared surface · 0183 · VehiclePicker (Apple)
//
//  Xcode previews for every branch of the vehicle selector: the multi-vehicle `Menu` picker, the pin-aware
//  ordering (pinned vehicles floated to the top, pin-marked), the static single-vehicle chip, the loading
//  skeleton, the friendly empty chip, the error retry tile, and the stale + offline freshness chips.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let vpDemoFleet: [VehiclePickerVehicle] = [
        VehiclePickerVehicle(id: 1, displayName: "Lightning", vin: "5YJ3E1EA7KF000001"),
        VehiclePickerVehicle(id: 2, displayName: "Garage Loaner", vin: "5YJSA1E26HF000002"),
        VehiclePickerVehicle(id: 3, displayName: nil, vin: "5YJYGDEE0LF000003")
    ]

    private let vpDemoPins: [VehiclePickerPin] = [
        VehiclePickerPin(itemId: "3", position: 0),
        VehiclePickerPin(itemId: "1", position: 1)
    ]

    @MainActor
    private func vpModel(
        vehicles: [VehiclePickerVehicle] = vpDemoFleet,
        pins: [VehiclePickerPin] = [],
        selectedId: Int? = 1,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehiclePickerConnection = .live
    ) -> VehiclePickerModel {
        let snapshot = VehiclePickerSnapshot(
            vehicles: vehicles,
            pins: pins,
            selectedId: selectedId,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
        let model = VehiclePickerModel(source: InMemoryVehiclePickerSource(snapshot: snapshot))
        model.start()
        return model
    }

    @MainActor
    private func vpStaged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Picker · multi-vehicle") {
        vpStaged("3 vehicles · 'Lightning' selected") {
            VehiclePicker(model: vpModel(selectedId: 1))
        }
    }

    #Preview("Picker · pinned ordering") {
        vpStaged("#3 + #1 pinned → float to top, pin-marked") {
            VehiclePicker(model: vpModel(pins: vpDemoPins, selectedId: 3))
        }
    }

    #Preview("Static · single vehicle") {
        vpStaged("one vehicle → non-interactive chip (web hides)") {
            VehiclePicker(model: vpModel(vehicles: [vpDemoFleet[0]], selectedId: 1))
        }
    }

    #Preview("Loading / empty / error") {
        vpStaged("leaf states") {
            VehiclePicker(model: vpModel(isLoading: true))
            VehiclePicker(model: vpModel(vehicles: [], selectedId: nil))
            VehiclePicker(model: vpModel(errorMessage: "Network unavailable"))
        }
    }

    #Preview("Freshness · stale / offline") {
        vpStaged("freshness chips beside the picker") {
            VehiclePicker(model: vpModel(connection: .stale))
            VehiclePicker(model: vpModel(connection: .offline))
        }
    }
#endif
