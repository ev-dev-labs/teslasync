//
//  ActionBuilderPage.Views.swift
//  TeslaSync — P7 page · automations/ActionBuilder (Apple)
//
//  Token-driven presentational primitives for the ActionBuilder page, mapping the web
//  `@/components/ui` controls to native HIG counterparts: the labeled menu select (web
//  `Select`), the per-item-disablable channel picker (web `Select` with disabled options), the
//  single-line input (web `Input`), the multi-line editor with inline error (web `Textarea`),
//  and the move/remove row controls (web ghost `Button`s). Every literal resolves from
//  `Localizable.xcstrings` with the web key names; all surfaces use the P2 design tokens.
//

import SwiftUI

// MARK: - Field chrome (token surface + rounded border, red when errored)

/// Shared input chrome mirroring the web `Input` / `Textarea` shell.
struct ActionBuilderPageFieldChrome: ViewModifier {
    var hasError = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(hasError ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Field label (web Input/Select label)

/// The small field label (web control `label`).
struct ActionBuilderPageFieldLabel: View {
    let key: String
    let fallback: String

    var body: some View {
        Text(verbatim: ActionBuilderPageStrings.localize(key, fallback))
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: - Labeled menu select (web Select)

/// One option of an `ActionBuilderPagePicker` (already-localized label).
struct ActionBuilderPageOption<Tag: Hashable>: Identifiable {
    let tag: Tag
    let label: String

    var id: Tag {
        tag
    }
}

/// A labeled dropdown (web `Select`) over a native menu `Picker`. The optional visible label
/// mirrors the web row-0-only label; an accessibility label is always supplied so VoiceOver
/// announces the control even when the visible label is hidden.
struct ActionBuilderPagePicker<Tag: Hashable>: View {
    var labelKey: String?
    var labelFallback = ""
    let accessibilityKey: String
    let accessibilityFallback: String
    let options: [ActionBuilderPageOption<Tag>]
    @Binding var selection: Tag

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let labelKey {
                ActionBuilderPageFieldLabel(key: labelKey, fallback: labelFallback)
            }
            Picker(selection: $selection) {
                ForEach(options) { option in
                    Text(verbatim: option.label).tag(option.tag)
                }
            } label: {
                Text(verbatim: accessibilityLabel)
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .modifier(ActionBuilderPageFieldChrome())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        ActionBuilderPageStrings.localize(accessibilityKey, accessibilityFallback)
    }
}

// MARK: - Channel select (web Select with disabled options)

/// The notify channel select (web `Select`) as a native `Menu` so disabled channels
/// (`!channel.enabled`) cannot be chosen, exactly like the web `disabled` option. When no
/// channels exist it shows the "No channels configured" sentinel.
struct ActionBuilderPageChannelPicker: View {
    let options: [ChannelOption]
    @Binding var channelID: Int

    private var emptyLabel: String {
        ActionBuilderPageStrings.localize("automations.builder.noChannels", "No channels configured")
    }

    private var selectedLabel: String {
        options.first { $0.id == channelID }?.label ?? emptyLabel
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ActionBuilderPageFieldLabel(key: "automations.builder.channel", fallback: "Channel")
            Menu {
                ForEach(options) { option in
                    Button {
                        channelID = option.id
                    } label: {
                        channelRow(option)
                    }
                    .disabled(option.disabled)
                }
            } label: {
                menuTrigger
            }
            .disabled(options.isEmpty)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ActionBuilderPageStrings.localize("automations.builder.channel", "Channel")))
        .accessibilityValue(Text(verbatim: selectedLabel))
    }

    @ViewBuilder
    private func channelRow(_ option: ChannelOption) -> some View {
        if option.id == channelID {
            Label { Text(verbatim: option.label) } icon: { Image(systemName: "checkmark") }
        } else {
            Text(verbatim: option.label)
        }
    }

    private var menuTrigger: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: selectedLabel)
                .font(Font.TS.body)
                .foregroundStyle(options.isEmpty ? Color.TS.textMuted : Color.TS.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 0)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 10))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .modifier(ActionBuilderPageFieldChrome())
    }
}

// MARK: - Single-line input (web Input)

/// A labeled single-line text field (web `Input`). `numeric` requests a numeric keyboard on iOS
/// (the web `type="number"`); the value stays a string and is coerced by the adapter.
struct ActionBuilderPageTextField: View {
    let labelKey: String
    let labelFallback: String
    var promptKey = ""
    var promptFallback = ""
    @Binding var value: String
    var numeric = false

    private var prompt: String {
        ActionBuilderPageStrings.localize(promptKey, promptFallback)
    }

    private var label: String {
        ActionBuilderPageStrings.localize(labelKey, labelFallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ActionBuilderPageFieldLabel(key: labelKey, fallback: labelFallback)
            field
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .autocorrectionDisabled(true)
                .modifier(ActionBuilderPageFieldChrome())
                .accessibilityLabel(Text(verbatim: label))
        }
    }

    private var field: some View {
        TextField("", text: $value, prompt: Text(verbatim: prompt))
        #if os(iOS)
            .keyboardType(numeric ? .numbersAndPunctuation : .default)
        #endif
    }
}

// MARK: - Multi-line editor with inline error (web Textarea)

/// A labeled multi-line editor (web `Textarea`) with an example overlay while empty (native
/// `TextEditor` has no prompt) and an optional inline error (web `error` prop). `mono` renders
/// monospaced (the command-params editor).
struct ActionBuilderPageTextArea: View {
    let labelKey: String
    let labelFallback: String
    var promptKey = ""
    var promptFallback = ""
    @Binding var value: String
    var error: String?
    var mono = false

    private var prompt: String {
        ActionBuilderPageStrings.localize(promptKey, promptFallback)
    }

    private var label: String {
        ActionBuilderPageStrings.localize(labelKey, labelFallback)
    }

    private var editorFont: Font {
        mono ? .system(.caption, design: .monospaced) : Font.TS.body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ActionBuilderPageFieldLabel(key: labelKey, fallback: labelFallback)
            ZStack(alignment: .topLeading) {
                if value.isEmpty {
                    Text(verbatim: prompt)
                        .font(editorFont)
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.horizontal, TSSpacing.sm + 4)
                        .padding(.vertical, TSSpacing.sm + 4)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $value)
                    .font(editorFont)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 64)
                    .padding(.horizontal, TSSpacing.xs)
                    .padding(.vertical, TSSpacing.xs)
                    .autocorrectionDisabled(true)
            }
            .modifier(ActionBuilderPageFieldChrome(hasError: error != nil))
            .accessibilityLabel(Text(verbatim: label))
            if let error {
                Text(verbatim: error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
    }
}

// MARK: - Row controls (web move-up / move-down / remove ghost buttons)

/// The vertical move-up / move-down / remove control stack (web ghost `Button`s with chevron +
/// trash icons). Disabled states mirror the web `disabled` guards.
struct ActionBuilderPageRowControls: View {
    let canMoveUp: Bool
    let canMoveDown: Bool
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            control(icon: "chevron.up", key: "automations.builder.moveUp", fallback: "Move up", action: onMoveUp)
                .disabled(!canMoveUp)
            control(
                icon: "chevron.down",
                key: "automations.builder.moveDown",
                fallback: "Move down",
                action: onMoveDown
            )
            .disabled(!canMoveDown)
            control(
                icon: "trash",
                key: "automations.builder.removeAction",
                fallback: "Remove action",
                action: onRemove
            )
            .foregroundStyle(Color.TS.statusDanger)
        }
    }

    private func control(icon: String, key: String, fallback: String, action: @escaping () -> Void) -> some View {
        TSButton(variant: .ghost, size: .small, action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
        }
        .accessibilityLabel(Text(verbatim: ActionBuilderPageStrings.localize(key, fallback)))
    }
}
