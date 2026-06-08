//
//  ActionBuilder.Views.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  Presentational primitives for the ActionBuilder, all token-driven (P1/S9) with
//  copy resolved through the P1/S10 facade: the labeled menu select (web `Select`),
//  the per-item-disablable channel picker (web `Select` with disabled options), the
//  single-line input (web `Input`), the multi-line editor with inline error (web
//  `Textarea`), and the move/remove row controls (web ghost `Button`s). These map the
//  web `@/components/ui` controls to native counterparts and are reused by the four
//  per-kind field groups.
//

import SwiftUI

// MARK: - Field chrome (token surface + rounded border, red when errored)

/// Shared input chrome mirroring the web `Input`/`Textarea` shell.
struct ActionFieldChrome: ViewModifier {
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

/// The small uppercase field label (web control `label`).
struct ActionFieldLabel: View {
    let key: String
    let fallback: String

    var body: some View {
        ActionBuilderStrings.text(key, fallback)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: - Labeled menu select (web Select)

/// One option of an `ActionLabeledPicker` (verbatim, already-localized label).
struct ActionLabeledOption<Tag: Hashable>: Identifiable {
    let tag: Tag
    let label: String

    var id: Tag {
        tag
    }
}

/// A labeled dropdown (web `Select`) over a native menu `Picker`. The optional
/// visible label mirrors the web's row-0-only label; an accessibility label is always
/// supplied so VoiceOver announces the control even when the label is hidden.
struct ActionLabeledPicker<Tag: Hashable>: View {
    var labelKey: String?
    var labelFallback = ""
    let accessibilityKey: String
    let accessibilityFallback: String
    let options: [ActionLabeledOption<Tag>]
    @Binding var selection: Tag

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let labelKey {
                ActionFieldLabel(key: labelKey, fallback: labelFallback)
            }
            Picker(selection: $selection) {
                ForEach(options) { option in
                    Text(verbatim: option.label).tag(option.tag)
                }
            } label: {
                ActionBuilderStrings.text(accessibilityKey, accessibilityFallback)
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .modifier(ActionFieldChrome())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ActionBuilderStrings.text(accessibilityKey, accessibilityFallback))
    }
}

// MARK: - Channel select (web Select with disabled options)

/// The notify channel select (web `Select`) as a native `Menu` so disabled channels
/// (`!channel.enabled`) cannot be chosen, exactly like the web `disabled` option. When
/// no channels exist it shows the "No channels configured" sentinel.
struct ActionChannelPicker: View {
    let options: [ChannelOption]
    @Binding var channelID: Int

    private var emptyLabel: String {
        ActionBuilderStrings.string("automations.builder.noChannels", "No channels configured")
    }

    private var selectedLabel: String {
        options.first { $0.id == channelID }?.label ?? emptyLabel
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ActionFieldLabel(key: "automations.builder.channel", fallback: "Channel")
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
        .accessibilityLabel(ActionBuilderStrings.text("automations.builder.channel", "Channel"))
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
        .modifier(ActionFieldChrome())
    }
}

// MARK: - Single-line input (web Input)

/// A labeled single-line text field (web `Input`). `numeric` requests a numeric
/// keyboard on iOS (the web `type="number"`); the value stays a string and is coerced
/// by the adapter, exactly like the web.
struct ActionTextRow: View {
    let labelKey: String
    let labelFallback: String
    var promptKey = ""
    var promptFallback = ""
    @Binding var value: String
    var numeric = false

    private var prompt: String {
        ActionBuilderStrings.string(promptKey, promptFallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ActionFieldLabel(key: labelKey, fallback: labelFallback)
            field
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .autocorrectionDisabled(true)
                .modifier(ActionFieldChrome())
                .accessibilityLabel(ActionBuilderStrings.text(labelKey, labelFallback))
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

/// A labeled multi-line editor (web `Textarea`) with an example overlay while empty
/// (native `TextEditor` has no prompt) and an optional inline error (web `error` prop).
/// `mono` renders monospaced (the params editor).
struct ActionTextAreaRow: View {
    let labelKey: String
    let labelFallback: String
    var promptKey = ""
    var promptFallback = ""
    @Binding var value: String
    var error: String?
    var mono = false

    private var prompt: String {
        ActionBuilderStrings.string(promptKey, promptFallback)
    }

    private var editorFont: Font {
        mono ? .system(.caption, design: .monospaced) : Font.TS.body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ActionFieldLabel(key: labelKey, fallback: labelFallback)
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
            .modifier(ActionFieldChrome(hasError: error != nil))
            .accessibilityLabel(ActionBuilderStrings.text(labelKey, labelFallback))
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

/// The vertical move-up / move-down / remove control stack (web ghost `Button`s with
/// chevron + trash icons). Disabled states mirror the web `disabled` guards.
struct ActionRowControls: View {
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
            control(icon: "trash", key: "automations.builder.removeAction", fallback: "Remove action", action: onRemove)
                .foregroundStyle(Color.TS.statusDanger)
        }
    }

    private func control(icon: String, key: String, fallback: String, action: @escaping () -> Void) -> some View {
        TSButton(variant: .ghost, size: .small, action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
        }
        .accessibilityLabel(ActionBuilderStrings.text(key, fallback))
    }
}
