//
//  VehicleMultiSelect.swift
//  TeslaSync — P4 shared surface · 0163 · VehicleMultiSelect (Apple)
//
//  The public API of the Alert Studio multi-vehicle picker — the SwiftUI parity of
//  `components/forms/VehicleMultiSelect.tsx`. The web component is a controlled popover multi-select: the
//  trigger shows a summary `Badge`, the popover lists an "All vehicles (current + future)" sentinel plus one
//  `role="checkbox"` row per vehicle (and per unknown, still-selected id), the sentinel is mutually exclusive
//  with a per-vehicle subset, an empty fleet disables the trigger and shows a help line, and an `errorKey`
//  tints the trigger + shows inline error text. The native surface reproduces all of that and adds the P4
//  always-render leaf states (loading skeleton, fetch-error retry tile) plus the orthogonal freshness chip, so
//  it never collapses to a blank box. It binds through ``VehicleMultiSelectModel`` (P1/S8); no networking lives
//  in the view.
//
//  States (every one renders — no hidden surface):
//    • loading  — the fleet is resolving → skeleton trigger pill.
//    • content  — the trigger + the popover option list (the web body).
//    • empty    — the fleet resolved empty (web disables the trigger) → disabled trigger + the help line.
//    • error    — the fleet read failed → compact retry tile (web has no QueryError peer).
//    • stale / offline — the connectivity axis → freshness chip beside the trigger (stale auto-refreshes once;
//                 offline keeps the cached fleet).
//    • validation error — the web `errorKey` → danger-tinted trigger border + inline error text (orthogonal to
//                 the phase, shown wherever the trigger is).
//

import SwiftUI

// MARK: - VehicleMultiSelect (the shared surface)

/// The multi-vehicle picker surface — the SwiftUI parity of `VehicleMultiSelect.tsx`. Renders every state,
/// binding through ``VehicleMultiSelectModel``.
public struct VehicleMultiSelect: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleMultiSelectSurface.slug

    @State private var model: VehicleMultiSelectModel

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    public init(model: VehicleMultiSelectModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting
    /// `<VehicleMultiSelect value onChange vehicles errorKey disabled />` with the production source + commit
    /// callback. The host implements `source` over `useVehicles()` + the editor's controlled value, and routes
    /// `onChange` to the editor's state setter.
    public init(
        source: any VehicleMultiSelectSource,
        onChange: @escaping @MainActor (VehicleMultiSelectValue) -> Void = { _ in },
        telemetry: any VehicleMultiSelectTelemetry = OSLogVehicleMultiSelectTelemetry()
    ) {
        _model = State(initialValue: VehicleMultiSelectModel(
            source: source,
            onChange: onChange,
            telemetry: telemetry
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                phaseLeading
                if model.connection != .live {
                    VehicleMultiSelectFreshnessChip(
                        connection: model.connection,
                        localize: model.localize,
                        onRefresh: { model.refresh() }
                    )
                }
            }
            if isTriggerVisible, model.projection.isFleetEmpty {
                VehicleMultiSelectEmptyHelp(message: VehicleMultiSelectStrings.emptyFleetHelp(model.localize))
            }
            if isTriggerVisible, let errorText = model.errorText {
                VehicleMultiSelectErrorText(message: errorText)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// Whether the trigger (and thus the empty-help / inline-error copy) is on screen — the web body is shown
    /// in both the populated and the empty-fleet branches; the native loading / fetch-error leaves replace it.
    private var isTriggerVisible: Bool {
        switch model.phase {
        case .content, .empty: true
        case .loading, .error: false
        }
    }

    @ViewBuilder
    private var phaseLeading: some View {
        switch model.phase {
        case .loading:
            VehicleMultiSelectLoadingView(label: VehicleMultiSelectStrings.loadingA11y(model.localize))
        case let .error(message):
            VehicleMultiSelectErrorTile(
                title: VehicleMultiSelectStrings.errorTitle(model.localize),
                message: message,
                retryLabel: VehicleMultiSelectStrings.retry(model.localize),
                onRetry: { model.refresh() }
            )
        case .content, .empty:
            VehicleMultiSelectTrigger(model: model)
        }
    }
}
