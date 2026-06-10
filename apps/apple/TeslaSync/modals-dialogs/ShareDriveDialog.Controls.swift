//
//  ShareDriveDialog.Controls.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  The interactive create-form controls, ported from the web `@/components/ui` primitives the source
//  composes: the title `Input` (the optional drive-title field with its prompt copy), the two `Toggle`s
//  (include speed / include detailed telemetry), and the expiry `Select` (a native menu over 7 / 30 /
//  90 days / Never). Each binds through `ShareDriveModel`, resolves copy through P1/S10, carries a
//  VoiceOver label, and is token-styled (P1/S9) — no web Tailwind ports.
//

import SwiftUI

// MARK: - Title field (web `Input`)

/// The optional drive-title field (web `<Input>` with a prompt). A plain `TextField`
/// over token chrome, using the web prompt copy.
struct ShareDriveTitleField: View {
    @Bindable var model: ShareDriveModel

    private var promptText: String {
        // The web i18n key name trips the gate's word filter; the next line opts out with a reason.
        let key = "share.titlePlaceholder" // parity:allow web i18n key from ShareDriveDialog.tsx
        return model.localize(key, "Optional title (e.g., \"SF to LA Road Trip\")")
    }

    var body: some View {
        TextField("", text: $model.title, prompt: Text(verbatim: promptText))
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(verbatim: model.localize("share.titleField", "Share title")))
    }
}

// MARK: - Toggle row (web `Toggle`)

/// One labeled switch (web `<Toggle label checked onChange />`). The native `Toggle` carries its own
/// VoiceOver label + switch trait, tinted with the brand accent.
struct ShareDriveToggleRow: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            Text(verbatim: label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .tint(Color.TS.accent)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Expiry picker (web `Select`)

/// The expiry picker (web `<Select label options value onChange />`) as a native menu. The label sits
/// above the trigger, which shows the selected option's copy; choosing one sets `expiry`.
struct ShareDriveExpiryPicker: View {
    @Bindable var model: ShareDriveModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: model.localize("share.expiry", "Link expires after"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Menu {
                ForEach(model.expiryOptions) { option in
                    Button {
                        model.expiry = option
                    } label: {
                        optionLabel(option)
                    }
                }
            } label: {
                trigger
            }
            .accessibilityLabel(
                Text(verbatim: model.localize("share.expiry", "Link expires after"))
            )
            .accessibilityValue(Text(verbatim: model.expiryDisplay))
        }
    }

    @ViewBuilder
    private func optionLabel(_ option: ShareExpiry) -> some View {
        let title = model.localize(option.labelKey, option.labelFallback)
        if option == model.expiry {
            Label { Text(verbatim: title) } icon: { Image(systemName: "checkmark") }
        } else {
            Text(verbatim: title)
        }
    }

    private var trigger: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: model.expiryDisplay)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}
