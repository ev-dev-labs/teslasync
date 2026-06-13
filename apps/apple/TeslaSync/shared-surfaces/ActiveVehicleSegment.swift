//
//  ActiveVehicleSegment.swift
//  TeslaSync — P4 shared surface · 0176 · ActiveVehicleSegment (Apple)
//
//  The public API of the footer active-vehicle segment — the SwiftUI parity of
//  `components/layout/status-bar/ActiveVehicleSegment.tsx`. The web component reads the composed
//  `useSelectedVehicle()` + `useVehicleState()` + `useUnits()` state and renders: a static chip for a
//  single-vehicle account, a switcher button + listbox popover for multiple vehicles (each routing through
//  `setVehicleId`), and `null` for an empty fleet — each chip showing the active vehicle's name and its
//  `battery% · range` metrics, optionally collapsed to just the glyph (`iconOnly`). The native surface
//  reproduces that and adds the P4 always-render leaf states (loading skeleton, friendly empty chip, error
//  tile with retry) plus the orthogonal freshness chip, so it never collapses to a blank box. It binds
//  through ``ActiveVehicleSegmentModel`` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading  — the fleet is resolving → skeleton chip.
//    • content  — the active-vehicle chip (single) or the `Menu` switcher (multiple), optionally `iconOnly`.
//    • empty    — the fleet resolved empty (web returns `null`) → friendly "No vehicle" chip.
//    • error    — the fleet read failed → compact retry tile (web has no peer).
//    • stale / offline — the connectivity axis → freshness chip beside the chip (stale auto-refreshes once;
//                 offline keeps the cached value).
//

import SwiftUI

// MARK: - ActiveVehicleSegment (the shared surface)

/// The footer active-vehicle segment — the SwiftUI parity of `ActiveVehicleSegment.tsx`. Renders every
/// state, binding through ``ActiveVehicleSegmentModel``.
public struct ActiveVehicleSegment: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ActiveVehicleSegmentSurface.slug

    @State private var model: ActiveVehicleSegmentModel
    private let iconOnly: Bool

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    ///
    /// - Parameters:
    ///   - model: the bound state-holder (P1/S8).
    ///   - iconOnly: collapses each chip to the lone `Car` glyph (web `iconOnly`). Defaults to `false`.
    public init(model: ActiveVehicleSegmentModel, iconOnly: Bool = false) {
        _model = State(initialValue: model)
        self.iconOnly = iconOnly
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting
    /// `<ActiveVehicleSegment iconOnly />` with the production source + commit callback. The host implements
    /// `source` over the shared selected-vehicle store + vehicle-state + units feeds and routes `onSelect` to
    /// `setVehicleId`.
    public init(
        source: any ActiveVehicleSegmentSource,
        onSelect: @escaping @MainActor (Int) -> Void = { _ in },
        iconOnly: Bool = false,
        telemetry: any ActiveVehicleSegmentTelemetry = OSLogActiveVehicleSegmentTelemetry()
    ) {
        _model = State(initialValue: ActiveVehicleSegmentModel(
            source: source,
            onSelect: onSelect,
            telemetry: telemetry
        ))
        self.iconOnly = iconOnly
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            phaseContent
            if model.connection != .live {
                ActiveVehicleSegmentFreshnessChip(connection: model.connection) { model.refresh() }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch model.phase {
        case .loading:
            ActiveVehicleSegmentLoadingChip(iconOnly: iconOnly)
        case .content:
            if model.projection.isSwitchable {
                ActiveVehicleSegmentSwitcher(
                    projection: model.projection,
                    iconOnly: iconOnly,
                    onSelect: { model.select(id: $0) }
                )
            } else {
                ActiveVehicleSegmentStaticChip(projection: model.projection, iconOnly: iconOnly)
            }
        case .empty:
            ActiveVehicleSegmentEmptyChip(iconOnly: iconOnly)
        case let .error(message):
            ActiveVehicleSegmentErrorChip(message: message, iconOnly: iconOnly) { model.refresh() }
        }
    }
}
