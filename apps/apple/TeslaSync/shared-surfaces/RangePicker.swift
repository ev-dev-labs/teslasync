//
//  RangePicker.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The public API of the single-trigger date-range filter — the SwiftUI parity of
//  `components/forms/RangePicker.tsx`. The web component renders a compact trigger that opens a popover of
//  preset list + 2-month calendar + optional comparison toggle: a preset click commits immediately and
//  closes; a calendar pick stages and only Apply commits; Cancel / dismiss discards. The native surface
//  presents that same piece and adds the P4 always-render leaf states (loading skeleton trigger, error tile
//  with retry) plus the orthogonal freshness chip, so it never collapses to a blank box. It binds through
//  ``RangePickerModel`` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading  — the page's range is resolving → skeleton trigger pill.
//    • content  — the trigger + popover (preset listbox + calendar + footer) — the web body.
//    • empty    — `presetsOnly` with no resolvable presets → friendly empty popover content.
//    • error    — the range failed to resolve → retry tile (web has no QueryError peer).
//    • stale / offline — the connectivity axis → freshness chip beside the trigger (stale auto-refreshes
//                 once; offline keeps the cached selection).
//

import SwiftUI

// MARK: - RangePicker (the shared surface)

/// The date-range filter surface — the SwiftUI parity of `RangePicker.tsx`. Renders every state, binding
/// through ``RangePickerModel``.
public struct RangePicker: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RangePickerSurface.slug

    @State private var model: RangePickerModel

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    public init(model: RangePickerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting
    /// `<RangePicker value onChange … />` with the production source + commit callbacks.
    public init(
        source: any RangePickerSource,
        onChange: @escaping @MainActor (RangePickerValue, String?) -> Void = { _, _ in },
        onCompareChange: (@MainActor (Bool) -> Void)? = nil,
        telemetry: any RangePickerTelemetry = OSLogRangePickerTelemetry()
    ) {
        _model = State(initialValue: RangePickerModel(
            source: source,
            onChange: onChange,
            onCompareChange: onCompareChange,
            telemetry: telemetry
        ))
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            phaseContent
            if model.connection != .live {
                RangePickerFreshnessChip(connection: model.connection) { model.refresh() }
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
            RangePickerLoadingTrigger(size: model.input.size)
        case let .error(message):
            RangePickerErrorView(message: message) { model.refresh() }
        case .content, .empty:
            RangePickerTrigger(projection: model.projection, size: model.input.size) {
                model.toggleOpen()
            }
            .popover(isPresented: openBinding, arrowEdge: .top) {
                RangePickerPopoverContent(model: model)
                    .presentationCompactAdaptation(.popover)
            }
        }
    }

    /// A binding that routes the popover's dismiss (set `false`) through the model so the staged range is
    /// discarded on click-outside / Esc (web's discard-on-dismiss), while keeping `isOpen` `private(set)`.
    private var openBinding: Binding<Bool> {
        Binding(get: { model.isOpen }, set: { model.setOpen($0) })
    }
}
