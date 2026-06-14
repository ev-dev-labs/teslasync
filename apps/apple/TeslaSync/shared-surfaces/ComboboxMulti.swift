//
//  ComboboxMulti.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The multi-select combobox surface — the SwiftUI parity of `components/forms/ComboboxMulti.tsx`, the
//  WAI-ARIA "type to filter, pick many" primitive whose value is an ARRAY: selected options render as
//  removable chips inside the field, and the dropdown ALWAYS hides options that are already chosen (the
//  user never sees the same row twice). The web component is controlled: the parent owns the `value`
//  array, the field filters a static array OR a debounced async loader by the typed text, the keyboard
//  drives an active-descendant highlight, Enter / click ADDS a chip (keeping the list open for rapid
//  multi-select), Backspace at the empty input removes the trailing chip, and `maxItems` caps the
//  selection. This surface reproduces that interaction and adds the P4 leaf states (loading / error /
//  stale / offline) so it never collapses to a blank box. It binds through ``ComboboxMultiModel``
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — an in-flight async fetch (or the `loading` prop) with nothing cached → loading row +
//                inline spinner.
//    • empty   — resolved with zero rows → the friendly "No results" row (or "Maximum reached" at the
//                cap), never a blank dropdown.
//    • error   — the async loader threw → a retry affordance (web `QueryError` peer; the web swallows
//                the loader failure to empty).
//    • populated — the capped option list with the active-descendant highlight (rows non-interactive at
//                the cap) and the "+N more — refine search" footer.
//    • stale / offline — the orthogonal `connection` axis → a freshness chip beneath the field with a
//                one-shot auto-refresh on the stale transition.
//
//  Native-idiom note: the web field renders chips and the input on one `flex-wrap` row; the native peer
//  keeps the chips "inside the field" (the same bordered chrome) as a wrapping chip strip above the
//  typing row (the in-tree TagInput precedent), which is HIG-friendly on iPhone and keeps a comfortable
//  touch target for the input. The dropdown is an inline expanding listbox beneath the field (no
//  z-index/popover-sizing pitfalls), with the keyboard contract wired through `.onKeyPress` for hardware
//  keyboards (macOS / iPadOS) and tap selection for touch.
//

import SwiftUI

// MARK: - ComboboxMulti (the shared surface)

/// The multi-select combobox surface — the SwiftUI parity of `components/forms/ComboboxMulti.tsx`.
/// Renders every state plus the P4 leaf freshness states, binding through ``ComboboxMultiModel``.
public struct ComboboxMulti: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = ComboboxMultiMeta.surfaceSlug

    @State private var model: ComboboxMultiModel

    /// Designated initializer — adopts a fully-wired model (the production app threads the P1/S8 source
    /// through it; previews + tests inject an in-memory source).
    public init(model: ComboboxMultiModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for a STATIC option array — the parity of `<ComboboxMulti options={items}
    /// value={…} onChange={…} />`. Wires a ``LiveComboboxMultiSource`` over the snapshot and forwards the
    /// user's edited value array to the host closure.
    public init(
        label: String,
        items: [ComboboxMultiItem],
        value: [ComboboxMultiItem],
        prompt: String? = nil,
        hideLabel: Bool = false,
        disabled: Bool = false,
        loading: Bool = false,
        connection: ComboboxMultiConnection = .live,
        maxVisibleOptions: Int = ComboboxMultiMeta.defaultMaxVisibleOptions,
        maxItems: Int? = nil,
        noChevron: Bool = false,
        iconSystemName: String? = nil,
        telemetry: any ComboboxMultiTelemetry = OSLogComboboxMultiTelemetry(),
        onChange: @escaping @MainActor ([ComboboxMultiItem]) -> Void
    ) {
        let config = ComboboxMultiConfig(
            label: label, prompt: prompt, hideLabel: hideLabel, disabled: disabled,
            maxVisibleOptions: maxVisibleOptions, maxItems: maxItems,
            noChevron: noChevron, iconSystemName: iconSystemName
        )
        let snapshot = ComboboxMultiSnapshot(
            selected: value, staticItems: items, isLoading: loading, connection: connection
        )
        _model = State(initialValue: Self.makeModel(
            config: config, provider: .staticItems, snapshot: snapshot, onChange: onChange,
            telemetry: telemetry
        ))
    }

    /// Convenience initializer for an ASYNC option loader — the parity of `<ComboboxMulti options={async
    /// (query, signal) => …} value={…} onChange={…} />`. The loader is debounced + cancelled on the next
    /// keystroke (web `AbortController`).
    public init(
        label: String,
        value: [ComboboxMultiItem],
        asyncOptions: @escaping ComboboxMultiAsyncLoader,
        prompt: String? = nil,
        hideLabel: Bool = false,
        disabled: Bool = false,
        connection: ComboboxMultiConnection = .live,
        maxVisibleOptions: Int = ComboboxMultiMeta.defaultMaxVisibleOptions,
        maxItems: Int? = nil,
        noChevron: Bool = false,
        iconSystemName: String? = nil,
        debounce: Duration = ComboboxMultiMeta.defaultAsyncDebounce,
        telemetry: any ComboboxMultiTelemetry = OSLogComboboxMultiTelemetry(),
        onChange: @escaping @MainActor ([ComboboxMultiItem]) -> Void
    ) {
        let config = ComboboxMultiConfig(
            label: label, prompt: prompt, hideLabel: hideLabel, disabled: disabled,
            maxVisibleOptions: maxVisibleOptions, maxItems: maxItems,
            noChevron: noChevron, iconSystemName: iconSystemName
        )
        let snapshot = ComboboxMultiSnapshot(selected: value, connection: connection)
        _model = State(initialValue: Self.makeModel(
            config: config, provider: .async(asyncOptions), snapshot: snapshot, onChange: onChange,
            debounce: debounce, telemetry: telemetry
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if !model.config.hideLabel, !model.config.label.isEmpty {
                ComboboxMultiLabel(
                    text: model.config.label,
                    count: model.selected.count,
                    maxItems: model.config.maxItems
                )
            }
            ComboboxMultiField(model: model)
            if model.isOpen {
                ComboboxMultiListbox(model: model)
            }
            if model.connection != .live {
                ComboboxMultiFreshnessChip(connection: model.connection) { model.refresh() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.config.label))
    }

    /// Builds a model over a fresh ``LiveComboboxMultiSource`` wired to the host closure — the shared
    /// body of the static + async convenience initializers.
    private static func makeModel(
        config: ComboboxMultiConfig,
        provider: ComboboxMultiOptionProvider,
        snapshot: ComboboxMultiSnapshot,
        onChange: @escaping @MainActor ([ComboboxMultiItem]) -> Void,
        debounce: Duration = ComboboxMultiMeta.defaultAsyncDebounce,
        telemetry: any ComboboxMultiTelemetry = OSLogComboboxMultiTelemetry()
    ) -> ComboboxMultiModel {
        let source = LiveComboboxMultiSource(value: snapshot, onChange: onChange)
        return ComboboxMultiModel(
            config: config, provider: provider, source: source, debounce: debounce, telemetry: telemetry
        )
    }
}
