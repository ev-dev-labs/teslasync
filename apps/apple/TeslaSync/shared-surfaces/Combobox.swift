//
//  Combobox.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The combobox surface — the SwiftUI parity of `components/forms/Combobox.tsx`, the shared WAI-ARIA
//  "type to filter then pick" primitive (signal pickers, geocoded address inputs, vehicle pickers). The
//  web component is a controlled autocomplete: the parent owns the selected `value`, the field filters a
//  static array OR a debounced async loader by the typed text, the keyboard drives an active-descendant
//  highlight, and Enter / click commits an option (or, with `allowFreeText`, the raw text). This surface
//  reproduces that interaction and adds the P4 leaf states (loading / error / stale / offline) so it
//  never collapses to a blank box. It binds through ``ComboboxModel`` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — an in-flight async fetch (or the `loading` prop) with nothing cached → loading row +
//                inline spinner.
//    • empty   — resolved with zero rows → the friendly "No results" row, never a blank dropdown.
//    • error   — the async loader threw → a retry affordance (web `QueryError` peer; the web swallows
//                the loader failure to empty).
//    • populated — the capped option list with the active-descendant + selected highlight and the
//                "+N more — refine search" footer.
//    • stale / offline — the orthogonal `connection` axis → a freshness chip beneath the field with a
//                one-shot auto-refresh on the stale transition.
//
//  Native-idiom note: the web dropdown is an absolutely-positioned `<ul>`; the native parity is an
//  inline expanding listbox beneath the field (HIG-friendly in a form, no z-index/popover-sizing
//  pitfalls on iPhone), with the same keyboard contract wired through `.onKeyPress` for hardware
//  keyboards (macOS / iPadOS) and tap selection for touch.
//

import SwiftUI

// MARK: - Combobox (the shared surface)

/// The combobox surface — the SwiftUI parity of `components/forms/Combobox.tsx`. Renders every state
/// plus the P4 leaf freshness states, binding through ``ComboboxModel``.
public struct Combobox: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = ComboboxMeta.surfaceSlug

    @State private var model: ComboboxModel

    /// Designated initializer — adopts a fully-wired model (the production app threads the P1/S8 source
    /// through it; previews + tests inject an in-memory source).
    public init(model: ComboboxModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for a STATIC option array — the parity of `<Combobox options={items}
    /// value={…} onChange={…} />`. Wires a ``LiveComboboxSource`` over the snapshot and forwards the
    /// user's selection / free-text / typing to the host closures.
    public init(
        label: String,
        items: [ComboboxItem],
        selection: ComboboxItem?,
        prompt: String? = nil,
        hideLabel: Bool = false,
        disabled: Bool = false,
        loading: Bool = false,
        connection: ComboboxConnection = .live,
        allowFreeText: Bool = false,
        maxVisibleOptions: Int = ComboboxMeta.defaultMaxVisibleOptions,
        noChevron: Bool = false,
        noClearButton: Bool = false,
        iconSystemName: String? = nil,
        telemetry: any ComboboxTelemetry = OSLogComboboxTelemetry(),
        onFreeTextCommit: (@MainActor (String) -> Void)? = nil,
        onInputChange: (@MainActor (String) -> Void)? = nil,
        onChange: @escaping @MainActor (ComboboxItem?) -> Void
    ) {
        let config = ComboboxConfig(
            label: label, prompt: prompt, hideLabel: hideLabel, disabled: disabled,
            allowFreeText: allowFreeText, maxVisibleOptions: maxVisibleOptions,
            noChevron: noChevron, noClearButton: noClearButton, iconSystemName: iconSystemName
        )
        let snapshot = ComboboxSnapshot(
            selection: selection, staticItems: items, isLoading: loading, connection: connection
        )
        _model = State(initialValue: Self.makeModel(
            config: config, provider: .staticItems, snapshot: snapshot, onChange: onChange,
            telemetry: telemetry, onFreeText: onFreeTextCommit, onInput: onInputChange
        ))
    }

    /// Convenience initializer for an ASYNC option loader — the parity of `<Combobox options={async
    /// (query, signal) => …} value={…} onChange={…} />`. The loader is debounced + cancelled on the next
    /// keystroke (web `AbortController`).
    public init(
        label: String,
        selection: ComboboxItem?,
        asyncOptions: @escaping ComboboxAsyncLoader,
        prompt: String? = nil,
        hideLabel: Bool = false,
        disabled: Bool = false,
        connection: ComboboxConnection = .live,
        allowFreeText: Bool = false,
        maxVisibleOptions: Int = ComboboxMeta.defaultMaxVisibleOptions,
        noChevron: Bool = false,
        noClearButton: Bool = false,
        iconSystemName: String? = nil,
        debounce: Duration = ComboboxMeta.defaultAsyncDebounce,
        telemetry: any ComboboxTelemetry = OSLogComboboxTelemetry(),
        onFreeTextCommit: (@MainActor (String) -> Void)? = nil,
        onInputChange: (@MainActor (String) -> Void)? = nil,
        onChange: @escaping @MainActor (ComboboxItem?) -> Void
    ) {
        let config = ComboboxConfig(
            label: label, prompt: prompt, hideLabel: hideLabel, disabled: disabled,
            allowFreeText: allowFreeText, maxVisibleOptions: maxVisibleOptions,
            noChevron: noChevron, noClearButton: noClearButton, iconSystemName: iconSystemName
        )
        let snapshot = ComboboxSnapshot(selection: selection, connection: connection)
        _model = State(initialValue: Self.makeModel(
            config: config, provider: .async(asyncOptions), snapshot: snapshot, onChange: onChange,
            debounce: debounce, telemetry: telemetry, onFreeText: onFreeTextCommit, onInput: onInputChange
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if !model.config.hideLabel, !model.config.label.isEmpty {
                ComboboxLabel(text: model.config.label)
            }
            ComboboxField(model: model)
            if model.isOpen {
                ComboboxListbox(model: model)
            }
            if model.connection != .live {
                ComboboxFreshnessChip(connection: model.connection) { model.refresh() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.config.label))
    }

    /// Builds a model over a fresh ``LiveComboboxSource`` wired to the host closures — the shared body of
    /// the static + async convenience initializers.
    private static func makeModel(
        config: ComboboxConfig,
        provider: ComboboxOptionProvider,
        snapshot: ComboboxSnapshot,
        onChange: @escaping @MainActor (ComboboxItem?) -> Void,
        debounce: Duration = ComboboxMeta.defaultAsyncDebounce,
        telemetry: any ComboboxTelemetry = OSLogComboboxTelemetry(),
        onFreeText: (@MainActor (String) -> Void)? = nil,
        onInput: (@MainActor (String) -> Void)? = nil
    ) -> ComboboxModel {
        let source = LiveComboboxSource(
            value: snapshot, onSelect: onChange, onFreeText: onFreeText, onInput: onInput
        )
        return ComboboxModel(
            config: config, provider: provider, source: source, debounce: debounce, telemetry: telemetry
        )
    }
}
