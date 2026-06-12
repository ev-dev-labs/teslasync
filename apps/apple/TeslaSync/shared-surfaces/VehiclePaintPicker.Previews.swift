//
//  VehiclePaintPicker.Previews.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  Xcode previews for every real branch of the picker: the default (no override, Pearl-White inferred),
//  an active override (Red selected, the Reset affordance revealed), an inferred non-fallback colour
//  (Deep Blue auto-detected from the Tesla `exterior_color` code), and the empty leaf (a degenerate
//  catalog with no palettes). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
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

    @MainActor
    private func picker(
        exteriorColor: String? = nil,
        override: VehiclePaintPaletteID? = nil
    ) -> VehiclePaintPicker {
        VehiclePaintPicker(model: VehiclePaintPickerModel(
            store: InMemoryVehiclePaintStore(exteriorColor: exteriorColor, override: override),
            input: VehiclePaintPickerInput(vehicleID: 1, exteriorColor: exteriorColor)
        ))
    }

    #Preview("Default — no override (Pearl White inferred)") {
        staged("default · inferred fallback, no Reset") {
            picker()
        }
    }

    #Preview("Overridden — Red selected, Reset shown") {
        staged("override active · Reset revealed") {
            picker(override: .redMulticoat)
        }
    }

    #Preview("Auto-detected — Deep Blue inferred") {
        staged("exterior_color = DeepBlueMetallic") {
            picker(exteriorColor: "DeepBlueMetallic")
        }
    }

    #Preview("Empty — no palettes configured") {
        staged("degenerate catalog · never a blank box") {
            VehiclePaintPicker(model: VehiclePaintPickerModel(
                store: InMemoryVehiclePaintStore(),
                input: VehiclePaintPickerInput(vehicleID: 1),
                palettes: []
            ))
        }
    }
#endif
