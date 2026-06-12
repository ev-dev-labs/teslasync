//
//  VehiclePaintPicker.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The public API of the Digital-Twin paint picker — the SwiftUI parity of
//  `components/vehicles/VehiclePaintPicker.tsx`. Like the web component it is a small, self-contained
//  control that renders without page chrome (no panel / title); callers drop it into a VehicleTwin
//  card, a settings row, or a popover. It binds through ``VehiclePaintPickerModel`` for the selection
//  state, the once-only `view.opened` telemetry (P1/S11), and the store seam (P1/S8); composes the
//  token-driven chrome (P1/S9); resolves every string through the i18n facade (P1/S10); and honours
//  Reduce Motion at the selection boundary. No networking, no Tailwind ports.
//

import SwiftUI

/// The Digital-Twin paint picker — the SwiftUI parity of `components/vehicles/VehiclePaintPicker.tsx`.
/// Renders a labelled radiogroup of paint swatches, the live current-paint name, and a Reset affordance
/// that appears only while a local override is active. For a degenerate catalog with no palettes it shows
/// the native "never a blank box" empty leaf.
public struct VehiclePaintPicker: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehiclePaintPickerSurface.slug

    @State private var model: VehiclePaintPickerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Convenience initializer wiring the dependency seams directly — the parity of mounting
    /// `<VehiclePaintPicker vehicleId={…} exteriorColor={…} />`. Supply the per-vehicle paint `store`
    /// (the native `useVehiclePaint`) and the props.
    public init(
        store: any VehiclePaintStore,
        input: VehiclePaintPickerInput,
        palettes: [VehiclePaintPalette] = VehiclePaintCatalog.list,
        telemetry: any VehiclePaintPickerTelemetry = OSLogVehiclePaintPickerTelemetry()
    ) {
        _model = State(initialValue: VehiclePaintPickerModel(
            store: store,
            input: input,
            palettes: palettes,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a seeded selection, a spy telemetry).
    public init(model: VehiclePaintPickerModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        let projection = model.projection
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if projection.isEmpty {
                VehiclePaintPickerEmptyState()
            } else {
                VehiclePaintSwatchHeader(
                    sectionLabel: projection.sectionLabel,
                    pickerLabel: projection.pickerLabel,
                    swatches: projection.swatches,
                    layout: VehiclePaintPickerProjector.layout(),
                    onSelect: { model.selectPaint($0) }
                )
                VehiclePaintStatusRow(
                    currentPaintName: projection.currentPaintName,
                    showsReset: projection.showsReset,
                    resetLabel: projection.resetLabel,
                    onReset: { model.reset() }
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.state)
        .onAppear { model.markAppeared() }
    }
}
