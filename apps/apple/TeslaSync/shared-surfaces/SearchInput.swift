//
//  SearchInput.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The public API of the debounced search field — the SwiftUI parity of `components/forms/SearchInput.tsx`.
//  Like the web component it is driven by its props (the controlled `value` + `onChange`, the optional
//  `prompt` / `debounce` / `autoFocus` / `clearLabel`, and the recent-searches `historyScope` /
//  `showHistoryOnFocus` / `maxHistory`); there is no fetcher. The view binds through ``SearchInputModel``
//  for the buffered local text + the debounce + the focus-gated recent-searches dropdown + the once-only
//  `view.opened` telemetry (P1/S11), composes the token-driven chrome (P1/S9), floats the recent-searches
//  dropdown under the field (the native peer of the web absolutely-positioned popover), honors Reduce
//  Motion at the reveal boundary, and pushes prop changes into the holder via `.onChange` so a re-bound
//  controlled `value` re-syncs faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The debounced search field — the SwiftUI parity of `components/forms/SearchInput.tsx`. Renders a leading
/// magnifier, a debounced text field (the parent owns the committed `value`; local typing is buffered until
/// `debounce` elapses, then `onChange` fires), and a trailing clear button when non-empty. When
/// `historyScope` is set it also floats a focus-gated "recent searches" dropdown — keyboard-navigable rows
/// with per-row remove + a clear-all action — backed by the ``SearchInputHistoryStore`` seam. Mount it
/// wherever a list needs a resilient, history-aware filter field.
public struct SearchInput: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SearchInputSurface.slug
    }

    private let input: SearchInputInput
    private let onChange: (@MainActor (String) -> Void)?
    @State private var model: SearchInputModel
    @State private var fieldHeight: CGFloat = 0
    @FocusState private var fieldFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<SearchInput value onChange debounceMs autoFocus
    /// clearLabel historyScope showHistoryOnFocus maxHistory />`. The `store` + `telemetry` seams
    /// default to the production `UserDefaults` history + `os.Logger` diagnostics; previews / tests inject
    /// doubles. The web `placeholder` prop is surfaced here as `prompt` (SwiftUI idiom). // parity:allow web prop name
    public init(
        value: String,
        onChange: @escaping @MainActor (String) -> Void,
        prompt: String? = nil,
        debounce: TimeInterval = SearchInputProjector.defaultDebounce,
        autoFocus: Bool = false,
        clearLabel: String? = nil,
        historyScope: String? = nil,
        showHistoryOnFocus: Bool = true,
        maxHistory: Int = SearchInputHistory.defaultReturn,
        store: any SearchInputHistoryStore = UserDefaultsSearchInputHistoryStore(),
        telemetry: any SearchInputTelemetry = OSLogSearchInputTelemetry()
    ) {
        let resolved = SearchInputInput(
            value: value,
            prompt: prompt,
            debounce: debounce,
            autoFocus: autoFocus,
            clearLabel: clearLabel,
            historyScope: historyScope,
            showHistoryOnFocus: showHistoryOnFocus,
            maxHistory: maxHistory
        )
        input = resolved
        self.onChange = onChange
        _model = State(initialValue: SearchInputModel(
            input: resolved,
            onChange: onChange,
            store: store,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a seeded history store, a spy telemetry,
    /// a pre-focused field).
    public init(model: SearchInputModel) {
        input = model.input
        onChange = nil
        _model = State(initialValue: model)
    }

    public var body: some View {
        SearchInputField(
            model: model,
            focus: $fieldFocused,
            prompt: input.prompt ?? "",
            clearLabel: clearLabelResolved,
            fieldLabel: SearchInputStrings.fieldLabel,
            fieldHint: input.historyEnabled ? SearchInputStrings.fieldHint : nil
        )
        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }, action: { fieldHeight = $0 })
        .overlay(alignment: .topLeading) { dropdown }
        .animation(SearchInputMotion.reveal(reduce: reduceMotion), value: model.projection.dropdownVisible)
        .onAppear {
            model.start()
            if input.autoFocus { fieldFocused = true }
        }
        .onDisappear {
            model.flushPendingChange()
            model.stop()
        }
        .onChange(of: fieldFocused) { _, focused in
            model.setFocused(focused)
        }
        .onChange(of: model.focusRequestCount) { _, _ in
            fieldFocused = true
        }
        .onChange(of: input) { _, newInput in
            model.update(newInput, onChange: onChange)
        }
    }

    /// The floating recent-searches dropdown — positioned just below the measured field, the native peer of
    /// the web `absolute left-0 right-0 top-full` popover. Rendered only when the projection says so (web
    /// `dropdownVisible`); it never affects the field's layout.
    @ViewBuilder
    private var dropdown: some View {
        if model.projection.dropdownVisible {
            SearchInputHistoryDropdown(model: model)
                .padding(.top, fieldHeight + TSSpacing.xs)
                .zIndex(30)
                .transition(SearchInputMotion.dropdownTransition)
        }
    }

    /// The resolved clear-button label — the web `clearLabel ?? t('common.clear', 'Clear')`.
    private var clearLabelResolved: String {
        SearchInputProjector.clearAccessibilityLabel(
            explicit: input.clearLabel,
            fallback: SearchInputStrings.clearLabel
        )
    }
}
