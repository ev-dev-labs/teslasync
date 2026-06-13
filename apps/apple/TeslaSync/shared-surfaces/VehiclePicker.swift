//
//  VehiclePicker.swift
//  TeslaSync — P4 shared surface · 0183 · VehiclePicker (Apple)
//
//  The public API of the persistent app-wide vehicle selector — the SwiftUI parity of
//  `components/layout/VehiclePicker.tsx`. The web component reads the composed `useSelectedVehicle()` +
//  `usePinned('vehicle')` state and renders a sidebar `<Select>` of the fleet (pinned vehicles floated to the
//  top, each routing through `setVehicleId`), hiding itself entirely for a 0/1-vehicle account. The native
//  surface reproduces that — a HIG-idiomatic `Menu` picker for multi-vehicle fleets — and adds the P4
//  always-render leaf states (loading skeleton, friendly single/empty chips, error tile with retry) plus the
//  orthogonal freshness chip, so it never collapses to a blank box. It binds through ``VehiclePickerModel``
//  (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading  — the fleet is resolving → skeleton picker.
//    • content  — the `Menu` picker (fleet > 1) or the static single chip (fleet == 1, where the web hides).
//    • empty    — the fleet resolved empty (web returns `null`) → friendly "No vehicles" chip.
//    • error    — the fleet read failed → compact retry tile (web has no peer).
//    • stale / offline — the connectivity axis → freshness chip beside the picker (stale auto-refreshes once;
//                 offline keeps the cached fleet).
//

import SwiftUI

// MARK: - VehiclePicker (the shared surface)

/// The persistent app-wide vehicle selector — the SwiftUI parity of `VehiclePicker.tsx`. Renders every state,
/// binding through ``VehiclePickerModel``.
public struct VehiclePicker: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehiclePickerSurface.slug

    @State private var model: VehiclePickerModel

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    ///
    /// - Parameter model: the bound state-holder (P1/S8).
    public init(model: VehiclePickerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting
    /// `<VehiclePicker />` with the production source + commit callback. The host implements `source` over the
    /// shared selected-vehicle store + the `usePinned('vehicle')` feed and routes `onSelect` to `setVehicleId`.
    public init(
        source: any VehiclePickerSource,
        onSelect: @escaping @MainActor (Int) -> Void = { _ in },
        telemetry: any VehiclePickerTelemetry = OSLogVehiclePickerTelemetry()
    ) {
        _model = State(initialValue: VehiclePickerModel(
            source: source,
            onSelect: onSelect,
            telemetry: telemetry
        ))
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            phaseContent
            if model.connection != .live {
                VehiclePickerFreshnessChip(connection: model.connection) { model.refresh() }
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch model.phase {
        case .loading:
            VehiclePickerLoadingChip()
        case .content:
            if model.projection.isPickable {
                VehiclePickerMenu(projection: model.projection) { model.select(id: $0) }
            } else {
                VehiclePickerStaticChip(projection: model.projection)
            }
        case .empty:
            VehiclePickerEmptyChip()
        case let .error(message):
            VehiclePickerErrorChip(message: message) { model.refresh() }
        }
    }
}
