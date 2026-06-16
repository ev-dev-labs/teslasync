//
//  ConditionBuilderPage.Views.swift
//  TeslaSync — P7 page · automations/ConditionBuilder (Apple)
//
//  Token-driven presentational primitives for the ConditionBuilder page, mapping the web
//  `@/components/ui` controls to native HIG counterparts: the labeled menu select (web `Select`),
//  the single-line input (web `Input`), the numeric input (web `Input type="number"`), the
//  multi-state geofence picker (web geofence `Select` bound to `useGeofences`, with the
//  loading / empty / error / stale / offline chrome the HIG states contract requires), the freshness
//  chip, the day-of-week toggle (web day `Button`), and the inline error/offline state. Every literal
//  resolves from `Localizable.xcstrings` with the web key names; all surfaces use the P2 design tokens.
//

import SwiftUI

// MARK: - Field chrome (token surface + rounded border)

/// Shared input chrome mirroring the web `Input` / `Select` shell.
struct ConditionBuilderPageFieldChrome: ViewModifier {
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
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Field label (web Input/Select label)

/// The small field label (web control `label`). Optional so the editor can hide it on non-first rows
/// (web `index === 0 ? label : undefined`) while still feeding VoiceOver a name on the control.
struct ConditionBuilderPageFieldLabel: View {
    let key: String
    let fallback: String

    var body: some View {
        Text(verbatim: ConditionBuilderPageStrings.localize(key, fallback))
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: - Labeled menu select (web Select)

/// One option of a `ConditionBuilderPagePicker` (already-localized label).
struct ConditionBuilderPageOption<Tag: Hashable>: Identifiable {
    let tag: Tag
    let label: String

    var id: Tag {
        tag
    }
}

/// A labeled dropdown (web `Select`) over a native menu `Picker`. The optional visible label mirrors
/// the web row-0-only label; an accessibility label is always supplied so VoiceOver announces the
/// control even when the visible label is hidden.
struct ConditionBuilderPagePicker<Tag: Hashable>: View {
    var labelKey: String?
    var labelFallback = ""
    let accessibilityKey: String
    let accessibilityFallback: String
    let options: [ConditionBuilderPageOption<Tag>]
    @Binding var selection: Tag
    var maxWidth: CGFloat = .infinity

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let labelKey {
                ConditionBuilderPageFieldLabel(key: labelKey, fallback: labelFallback)
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
            .frame(maxWidth: maxWidth, minHeight: 40, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .modifier(ConditionBuilderPageFieldChrome())
        }
        .frame(maxWidth: maxWidth, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        ConditionBuilderPageStrings.localize(accessibilityKey, accessibilityFallback)
    }
}

// MARK: - Single-line input (web Input)

/// A labeled single-line text field (web `Input`). `numeric` requests a numeric keyboard on iOS (the
/// web `type="number"` / `type="time"` text variants); the value stays a string.
struct ConditionBuilderPageTextField: View {
    let labelKey: String
    let labelFallback: String
    var promptKey = ""
    var promptFallback = ""
    @Binding var value: String
    var numeric = false
    var maxWidth: CGFloat = .infinity

    private var prompt: String {
        promptKey.isEmpty ? "" : ConditionBuilderPageStrings.localize(promptKey, promptFallback)
    }

    private var label: String {
        ConditionBuilderPageStrings.localize(labelKey, labelFallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ConditionBuilderPageFieldLabel(key: labelKey, fallback: labelFallback)
            field
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .autocorrectionDisabled(true)
                .modifier(ConditionBuilderPageFieldChrome())
                .accessibilityLabel(Text(verbatim: label))
        }
        .frame(maxWidth: maxWidth, alignment: .leading)
    }

    private var field: some View {
        TextField("", text: $value, prompt: prompt.isEmpty ? nil : Text(verbatim: prompt))
        #if os(iOS)
            .keyboardType(numeric ? .numbersAndPunctuation : .default)
        #endif
    }
}

// MARK: - Numeric input (web Input type="number", bound to Double)

/// A labeled numeric field bound to a `Double` (web `Input type="number"` with `value_num` /
/// `value_min` / `value_max`). The value stays numeric and renders without a trailing `.0`.
struct ConditionBuilderPageNumberField: View {
    let labelKey: String
    let labelFallback: String
    @Binding var value: Double
    var maxWidth: CGFloat = 120

    private var label: String {
        ConditionBuilderPageStrings.localize(labelKey, labelFallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ConditionBuilderPageFieldLabel(key: labelKey, fallback: labelFallback)
            TextField(value: $value, format: .number) { Text(verbatim: label) }
                .labelsHidden()
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .monospacedDigit()
                .modifier(ConditionBuilderPageFieldChrome())
                .accessibilityLabel(Text(verbatim: label))
            #if os(iOS)
                .keyboardType(.numbersAndPunctuation)
            #endif
        }
        .frame(maxWidth: maxWidth, alignment: .leading)
    }
}

// MARK: - Day-of-week toggle (web day buttons)

/// One day toggle button (web `DAYS.map(...) → <UiButton aria-pressed>`).
struct ConditionBuilderPageDayToggle: View {
    let dayIndex: Int
    let isActive: Bool
    let onToggle: () -> Void

    private var title: String {
        ConditionBuilderPageStrings.localize(
            "common.days.short.\(dayIndex)", ConditionBuilderAdapter.dayShortNames[dayIndex]
        )
    }

    var body: some View {
        Button(action: onToggle) {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .frame(width: 36, height: 36)
                .background(
                    isActive ? Color.TS.accent.opacity(0.2) : Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .foregroundStyle(isActive ? Color.TS.accent : Color.TS.textMuted)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(isActive ? Color.TS.accent.opacity(0.5) : Color.TS.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Wrapping field row (web `flex flex-wrap items-end`)

/// Lays its fields in a row when they fit, else stacks them — the native equivalent of the web
/// `flex-wrap` so the editor reflows on iPhone / narrow split views (ADR-002/006).
struct ConditionBuilderPageFieldRow<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: TSSpacing.md) { content() }
            VStack(alignment: .leading, spacing: TSSpacing.md) { content() }
        }
    }
}
