//
//  Input.Views.swift
//  TeslaSync — P4 shared surface · 0217 · Input (Apple)
//
//  The presentational subviews composed by `InputField`, reproducing the web `components/ui/Input.tsx`
//  output: the label row (the web `<Label htmlFor required>` + the optional `<HelpIcon>`), the field
//  box (the native peer of the web `relative` wrapper — the optional leading icon, the `<input>`
//  itself, and the optional trailing suffix, all inside a rounded, bordered, glass-filled control),
//  and the message line (the web error / hint `<p>`). Copy arrives pre-resolved through the projection
//  (P1/S10); the accent, border, surface, type, radius, and spacing come from the P1/S9 tokens — no
//  raw hex, no Tailwind ports. The focus + error border transition honors Reduce Motion. The visible
//  label + asterisk + message are folded into the field's spoken name / hint (the native peer of the
//  web `htmlFor` / `aria-describedby` association) so VoiceOver reads them as one control; the help
//  trigger stays a distinct, focusable element.
//

import SwiftUI

// MARK: - Focus / error transition (web `transition-colors` + `focus:ring`)

/// Builds the SwiftUI border transition — the native boundary that turns the web field's
/// `transition-colors` (rest → focus ring → error border) into a single token-driven `Animation`.
/// Returns `nil` under reduced motion so the border snaps between states with no movement. The
/// duration is the design system's `fast` motion token (P1/S9).
public enum InputFieldMotion {
    /// The focus / error border transition, or `nil` when reduced motion is in effect.
    public static func focus(reduce: Bool) -> Animation? {
        guard !reduce else { return nil }
        return .easeInOut(duration: TSMotion.fastDuration)
    }
}

// MARK: - Label row (web `<Label required>` + optional `<HelpIcon>`)

/// The label row — the native peer of the web `<div class="flex items-center gap-1">`: the field
/// label (web `<Label class="text-sm font-medium text-[--text-secondary]">`), the red required marker
/// (web `<span aria-hidden>*`), and the optional help trigger (web `<HelpIcon>`). The label + marker
/// are hidden from VoiceOver because their content is folded into the field's accessible name (the web
/// `htmlFor` association); the help trigger remains its own focusable element.
struct InputFieldLabelRow: View {
    let resolved: InputFieldResolved

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let labelText = resolved.labelText {
                Text(verbatim: labelText)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityHidden(true)
                if resolved.isRequired {
                    Text(verbatim: "*")
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.statusDanger)
                        .accessibilityHidden(true)
                }
            }
            if let helpText = resolved.helpText {
                InputFieldHelpButton(text: helpText, accessibilityLabel: resolved.helpAccessibilityLabel)
            }
        }
    }
}

// MARK: - Help trigger (web `<HelpIcon>`)

/// The field-level help trigger — the native peer of the web `<HelpIcon>` `(?)` button. Reveals the
/// caller-supplied help text in a popover (the native peer of the web `<Tooltip>`); carries the
/// "Help for {field}" accessible name (web HelpIcon `aria-label`). The popover adapts to a sheet-free
/// popover even in compact width so the affordance is identical across iPhone / iPad / Mac.
struct InputFieldHelpButton: View {
    let text: String
    let accessibilityLabel: String
    @State private var isPresented = false

    var body: some View {
        Button {
            isPresented = true
        } label: {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .popover(isPresented: $isPresented) {
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.leading)
                .padding(TSSpacing.md)
                .frame(maxWidth: 260)
                .presentationCompactAdaptation(.popover)
        }
    }
}

// MARK: - Field control (web `relative` wrapper: icon + `<input>` + suffix)

/// The field box — the native peer of the web `<div class="relative">`: an optional leading icon (web
/// `icon`, muted), the editable `TextField` / `SecureField` (web `<input>`), and an optional trailing
/// suffix (web `suffix`), inside a rounded, glass-filled, bordered control. The border is the strong
/// border at rest, the accent on focus (web `focus:ring`), and the danger color on error (web
/// `border-red-500`). The field carries the resolved accessible name + hint; the decorative leading
/// icon is hidden from VoiceOver.
struct InputFieldControl<Icon: View, Suffix: View>: View {
    let resolved: InputFieldResolved
    @Binding var text: String
    let reduceMotion: Bool
    let icon: Icon
    let suffix: Suffix
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if resolved.hasLeadingIcon {
                icon
                    .font(.system(size: CGFloat(resolved.metrics.fontPointSize)))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            fieldView
            if resolved.hasTrailingSuffix {
                suffix
            }
        }
        .padding(.horizontal, CGFloat(resolved.metrics.horizontalPadding))
        .padding(.vertical, CGFloat(resolved.metrics.verticalPadding))
        .frame(minHeight: resolved.metrics.minHeight > 0 ? CGFloat(resolved.metrics.minHeight) : nil)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(borderColor, lineWidth: isEmphasized ? 2 : 1)
        )
        .opacity(resolved.isDisabled ? 0.5 : 1)
        .animation(InputFieldMotion.focus(reduce: reduceMotion), value: focused)
        .animation(InputFieldMotion.focus(reduce: reduceMotion), value: resolved.borderIsError)
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }

    private var fieldView: some View {
        field
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(.system(size: CGFloat(resolved.metrics.fontPointSize)))
            .foregroundStyle(Color.TS.textPrimary)
            .focused($focused)
            .disabled(resolved.isDisabled)
            .frame(maxWidth: .infinity)
            .accessibilityHint(Text(verbatim: resolved.accessibilityHint ?? ""))
    }

    @ViewBuilder private var field: some View {
        let prompt = resolved.placeholder.map { Text(verbatim: $0) }
        let label = Text(verbatim: resolved.accessibilityLabel)
        if resolved.isSecure {
            SecureField(text: $text, prompt: prompt) { label }
        } else {
            TextField(text: $text, prompt: prompt) { label }
        }
    }

    private var borderColor: Color {
        if resolved.borderIsError { return Color.TS.statusDanger }
        return focused ? Color.TS.accent : Color.TS.border
    }

    private var isEmphasized: Bool {
        focused || resolved.borderIsError
    }
}

// MARK: - Message line (web error / hint `<p>`)

/// The supporting line beneath the field — the web error `<p class="text-xs text-red-500">` or, when
/// there is no error, the hint `<p class="text-xs text-[--text-muted]">`. Hidden from VoiceOver
/// because the field already voices the error / hint through its accessible hint (the native peer of
/// the web `aria-describedby`), so it is not announced twice.
struct InputFieldMessage: View {
    let resolved: InputFieldResolved

    var body: some View {
        if let errorText = resolved.errorText {
            messageText(errorText, color: Color.TS.statusDanger)
        } else if let hintText = resolved.hintText {
            messageText(hintText, color: Color.TS.textMuted)
        }
    }

    private func messageText(_ text: String, color: Color) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityHidden(true)
    }
}
