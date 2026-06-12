//
//  VehicleSelect.swift
//  TeslaSync — P4 shared surface · 0164 · VehicleSelect (Apple)
//
//  The public API of the canonical per-page vehicle scope picker — the SwiftUI parity of
//  `components/forms/VehicleSelect.tsx`. The web component is a drop-in `<Select>` wired to the global
//  `useSelectedVehicle()` store: it maps the fleet to options (`display_name || vin || `Vehicle ${id}``),
//  reflects the current `vehicleId`, and commits a chosen id through `setVehicleId`. The native surface
//  reproduces that piece and adds the P4 always-render leaf states (loading skeleton, empty indicator, error
//  tile with retry) plus the orthogonal freshness chip, so it never collapses to a blank box. It binds
//  through ``VehicleSelectModel`` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading  — the fleet is resolving → skeleton trigger pill.
//    • content  — the select control (the web body), optionally icon-prefixed (web `withIcon`).
//    • empty    — the fleet resolved empty (web returns `null`) → compact labelled indicator.
//    • error    — the fleet read failed → compact retry tile (web has no QueryError peer).
//    • stale / offline — the connectivity axis → freshness chip beside the control (stale auto-refreshes
//                 once; offline keeps the cached fleet).
//

import SwiftUI

// MARK: - VehicleSelect (the shared surface)

/// The vehicle scope picker surface — the SwiftUI parity of `VehicleSelect.tsx`. Renders every state,
/// binding through ``VehicleSelectModel``.
public struct VehicleSelect: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleSelectSurface.slug

    @State private var model: VehicleSelectModel
    private let withIcon: Bool
    private let ariaLabelOverride: String?

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    ///
    /// - Parameters:
    ///   - model: the bound state-holder (P1/S8).
    ///   - withIcon: prefixes a small `Car` glyph before the control (web `withIcon`). Defaults to `false`.
    ///   - ariaLabel: overrides the accessible label (web `ariaLabel` prop). Defaults to the model's
    ///     `vehicleSelect.aria` ("Select vehicle").
    public init(model: VehicleSelectModel, withIcon: Bool = false, ariaLabel: String? = nil) {
        _model = State(initialValue: model)
        self.withIcon = withIcon
        ariaLabelOverride = ariaLabel
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting
    /// `<VehicleSelect withIcon ariaLabel />` with the production source + commit callback. The host
    /// implements `source` over the shared selected-vehicle store and routes `onSelect` to `setVehicleId`.
    public init(
        source: any VehicleSelectSource,
        onSelect: @escaping @MainActor (Int?) -> Void = { _ in },
        withIcon: Bool = false,
        ariaLabel: String? = nil,
        telemetry: any VehicleSelectTelemetry = OSLogVehicleSelectTelemetry()
    ) {
        _model = State(initialValue: VehicleSelectModel(
            source: source,
            onSelect: onSelect,
            telemetry: telemetry
        ))
        self.withIcon = withIcon
        ariaLabelOverride = ariaLabel
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            phaseContent
            if model.connection != .live {
                VehicleSelectFreshnessChip(connection: model.connection) { model.refresh() }
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
            VehicleSelectLoadingView(label: VehicleSelectStrings.loadingA11y)
        case .content:
            VehicleSelectControl(
                projection: model.projection,
                ariaLabel: ariaLabelOverride ?? model.ariaLabel,
                selectedName: model.selectedVehicleName,
                withIcon: withIcon,
                onSelect: { model.select(value: $0) }
            )
        case .empty:
            VehicleSelectEmptyView(
                title: VehicleSelectStrings.emptyTitle,
                message: VehicleSelectStrings.emptyMessage
            )
        case let .error(message):
            VehicleSelectErrorView(
                title: VehicleSelectStrings.errorTitle,
                message: message,
                retryLabel: VehicleSelectStrings.retry,
                onRetry: { model.refresh() }
            )
        }
    }
}
