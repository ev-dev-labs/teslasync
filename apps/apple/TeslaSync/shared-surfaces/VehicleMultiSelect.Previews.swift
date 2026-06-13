//
//  VehicleMultiSelect.Previews.swift
//  TeslaSync — P4 shared surface · 0163 · VehicleMultiSelect (Apple)
//
//  Xcode previews for every branch of the multi-vehicle picker: the fleet-sentinel trigger, a partial
//  specific selection, a single selection, a selection carrying unknown ids, the empty-fleet disabled trigger
//  + help, the validation-error trigger + inline error, the loading skeleton, the fetch-error retry tile, and
//  the stale + offline freshness chips. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let vmsDemoFleet: [VehicleMultiSelectVehicle] = [
        VehicleMultiSelectVehicle(id: 1, displayName: "Roadster", model: "Roadster", vin: "5YJ3E1EA7KF000001"),
        VehicleMultiSelectVehicle(id: 2, displayName: "Plaid", model: "Model S", vin: "5YJSA1E26HF000002"),
        VehicleMultiSelectVehicle(id: 3, displayName: nil, model: "Model 3", vin: "5YJYGDEE0LF000003")
    ]

    @MainActor
    private func vmsModel(
        vehicles: [VehicleMultiSelectVehicle] = vmsDemoFleet,
        value: VehicleMultiSelectValue = .allSticky,
        errorKey: String? = nil,
        disabled: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleMultiSelectConnection = .live
    ) -> VehicleMultiSelectModel {
        let snapshot = VehicleMultiSelectSnapshot(
            vehicles: vehicles,
            value: value,
            errorKey: errorKey,
            disabled: disabled,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
        let model = VehicleMultiSelectModel(source: InMemoryVehicleMultiSelectSource(snapshot: snapshot))
        model.start()
        return model
    }

    @MainActor
    private func vmsStaged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
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

    #Preview("Trigger · all-sticky / partial / single") {
        vmsStaged("summary variants") {
            VehicleMultiSelect(model: vmsModel(value: .allSticky))
            VehicleMultiSelect(model: vmsModel(value: .specific([1, 3])))
            VehicleMultiSelect(model: vmsModel(value: .specific([2])))
        }
    }

    #Preview("Trigger · none / unknown ids") {
        vmsStaged("empty subset + orphaned (D10) ids") {
            VehicleMultiSelect(model: vmsModel(value: .specific([])))
            VehicleMultiSelect(model: vmsModel(value: .specific([2, 99])))
        }
    }

    #Preview("Empty fleet · disabled + help") {
        vmsStaged("web returns a disabled trigger + help line") {
            VehicleMultiSelect(model: vmsModel(vehicles: [], value: .allSticky))
        }
    }

    #Preview("Validation error · errorKey") {
        vmsStaged("errorKey → danger border + inline error") {
            VehicleMultiSelect(model: vmsModel(
                value: .specific([]),
                errorKey: "notifications.alertStudio.editor.vehiclesRequired"
            ))
        }
    }

    #Preview("Leaf states · loading / error") {
        vmsStaged("native always-render leaves") {
            VehicleMultiSelect(model: vmsModel(isLoading: true))
            VehicleMultiSelect(model: vmsModel(errorMessage: "Network unavailable"))
        }
    }

    #Preview("Freshness · stale / offline") {
        vmsStaged("freshness chips") {
            VehicleMultiSelect(model: vmsModel(value: .specific([1]), connection: .stale))
            VehicleMultiSelect(model: vmsModel(value: .specific([1]), connection: .offline))
        }
    }
#endif
