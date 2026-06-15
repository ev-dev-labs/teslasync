import SwiftUI

/// The filter panel for `LiveLogsPage` (web `GlassPanel` #1 — the filter grid). Reproduces the
/// web controls: a minimum-level dropdown (server-side, restarts the subscription), a grep
/// field (server-side, draft + commit on submit/blur, 256-char cap + help text), and a numeric
/// vehicle-id field (client-side, applied to the current buffer). Kept as a dedicated surface
/// (mirroring `ApiLogsFiltersPanel`) so the page file stays focused on chrome.
///
/// Adaptive (ADR-002/006): a three-column row (grep wider) on macOS/iPad regular width, a
/// single stacked column on compact iPhone. All copy resolves from `Localizable.xcstrings`; the
/// panel binds to the `@Observable` `LiveLogsPageModel`.
struct LiveLogsFiltersPanel: View {
    @Bindable var model: LiveLogsPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    var body: some View {
        TSGlassPanel {
            Group {
                if isCompact {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        levelControl
                        grepControl
                        vehicleControl
                    }
                } else {
                    HStack(alignment: .top, spacing: TSSpacing.md) {
                        levelControl.frame(width: 200)
                        grepControl.frame(maxWidth: .infinity)
                        vehicleControl.frame(width: 220)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("translation.liveLogs.filters.level"))
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Level (web `Select` — Minimum level)

    private var levelControl: some View {
        TSSelect(
            selection: $model.level,
            options: LiveLogLevel.allCases.map { TSSelectOption($0, LocalizedStringKey($0.labelKey)) },
            label: "translation.liveLogs.filters.level"
        )
        .accessibilityLabel(Text("translation.liveLogs.filters.level"))
    }

    // MARK: - Grep (web `Input` — server-side regex, draft + commit)

    private var grepControl: some View {
        LiveLogsTextField(
            label: "translation.liveLogs.filters.grep",
            prompt: "translation.liveLogs.filters.grepPlaceholder", // parity:allow i18n key name, not a stub
            text: $model.grepDraft,
            helper: "translation.liveLogs.filters.grepHelp",
            maxLength: 256,
            onCommit: { model.applyGrep() }
        )
    }

    // MARK: - Vehicle id (web `Input` — client-side numeric filter)

    private var vehicleControl: some View {
        LiveLogsTextField(
            label: "translation.liveLogs.filters.vehicleId",
            prompt: "translation.liveLogs.filters.vehicleIdPlaceholder", // parity:allow i18n key name, not a stub
            text: $model.vehicleFilter,
            keyboard: .numeric
        )
    }
}

// MARK: - Field (token-styled native input with submit/blur commit + length cap)

/// The keyboard hint for `LiveLogsTextField` (iOS maps numeric → number pad; macOS ignores it).
private enum LiveLogsFieldKeyboard {
    case `default`, numeric
}

/// A labelled single-line input styled with the design tokens (web `Input`). Native (not
/// `TSTextField`) so it can commit on submit/blur (web `onKeyDown` Enter + `onBlur` → grep),
/// cap the length (web `maxLength=256`), and pick a numeric keyboard (web `inputMode="numeric"`)
/// — behaviors the shared field does not expose. Helper text mirrors the web `hint`.
private struct LiveLogsTextField: View {
    let label: LocalizedStringKey
    let prompt: LocalizedStringKey
    @Binding var text: String
    var helper: LocalizedStringKey?
    var maxLength: Int?
    var keyboard: LiveLogsFieldKeyboard = .default
    var onCommit: (() -> Void)?

    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel(label)
            field
            if let helper {
                TSHelperText(helper)
            }
        }
    }

    private var field: some View {
        let input = TextField(prompt, text: $text)
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .focused($focused)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .onSubmit { onCommit?() }
            .onChange(of: focused) { _, isFocused in
                if !isFocused { onCommit?() }
            }
            .onChange(of: text) { _, newValue in
                if let maxLength, newValue.count > maxLength {
                    text = String(newValue.prefix(maxLength))
                }
            }
        #if os(iOS)
            return input
                .keyboardType(keyboard == .numeric ? .numberPad : .default)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        #else
            return input
        #endif
    }
}
