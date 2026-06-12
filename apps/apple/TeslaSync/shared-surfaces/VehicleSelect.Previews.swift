//
//  VehicleSelect.Previews.swift
//  TeslaSync — P4 shared surface · 0164 · VehicleSelect (Apple)
//
//  Xcode previews for every branch of the vehicle scope picker: the content control (single-vehicle,
//  multi-vehicle, and the icon-prefixed `withIcon` variant), the loading skeleton, the empty-fleet
//  indicator, the error retry tile, and the stale + offline freshness chips. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let vsDemoFleet: [VehicleSelectVehicle] = [
        VehicleSelectVehicle(id: 1, displayName: "Lightning", vin: "5YJ3E1EA7KF000001"),
        VehicleSelectVehicle(id: 2, displayName: "Garage Loaner", vin: "5YJSA1E26HF000002"),
        VehicleSelectVehicle(id: 3, displayName: nil, vin: "5YJYGDEE0LF000003")
    ]

    @MainActor
    private func vsModel(
        vehicles: [VehicleSelectVehicle] = vsDemoFleet,
        selectedId: Int? = 1,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleSelectConnection = .live
    ) -> VehicleSelectModel {
        let snapshot = VehicleSelectSnapshot(
            vehicles: vehicles,
            selectedId: selectedId,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
        let model = VehicleSelectModel(source: InMemoryVehicleSelectSource(snapshot: snapshot))
        model.start()
        return model
    }

    @MainActor
    private func vsStaged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
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

    #Preview("Control · multi-vehicle") {
        vsStaged("3 vehicles · 'Garage Loaner' selected") {
            VehicleSelect(model: vsModel(selectedId: 2))
        }
    }

    #Preview("Control · with icon") {
        vsStaged("withIcon → leading car glyph") {
            VehicleSelect(model: vsModel(selectedId: 1), withIcon: true)
        }
    }

    #Preview("Control · single + VIN fallback") {
        vsStaged("one vehicle; #3 has no name → VIN label") {
            VehicleSelect(model: vsModel(vehicles: [vsDemoFleet[2]], selectedId: 3))
        }
    }

    #Preview("Loading / empty / error") {
        vsStaged("leaf states") {
            VehicleSelect(model: vsModel(isLoading: true))
            VehicleSelect(model: vsModel(vehicles: [], selectedId: nil))
            VehicleSelect(model: vsModel(errorMessage: "Network unavailable"))
        }
    }

    #Preview("Freshness · stale / offline") {
        vsStaged("freshness chips") {
            VehicleSelect(model: vsModel(connection: .stale))
            VehicleSelect(model: vsModel(connection: .offline))
        }
    }
#endif
