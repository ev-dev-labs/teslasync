//
//  AppearanceSettings.Controls.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The reusable interactive controls the composed sections share: the selectable
//  choice card (web ghost `Button` choice tile), the labelled toggle row (web
//  `Toggle` line), the token-styled action button (web `Button`), and the hex →
//  Color swatch helper. Each is a pure function of its inputs; copy resolves through
//  the P1/S10 facade (no hardcoded English) and every control carries a VoiceOver
//  label + selection value.
//

import SwiftUI

// MARK: - Selectable choice card

/// A reusable selectable card (web ghost `Button` choice tile): an optional leading
/// accessory, the label + help copy, optional trailing detail (e.g. swatches), and
/// an active check. Routes selection through `action` and disables while saving.
struct AppearanceChoiceCard<Leading: View, Detail: View>: View {
    let label: String
    let help: String
    let isActive: Bool
    var isDisabled: Bool = false
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var detail: () -> Detail
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                leading()
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: label)
                        .font(Font.TS.bodySm).fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: help)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    detail()
                }
                Spacer(minLength: TSSpacing.sm)
                if isActive {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.TS.accent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                isActive ? Color.TS.accent.opacity(0.08) : Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(isActive ? Color.TS.accent : Color.TS.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled && !isActive ? 0.55 : 1)
        .accessibilityLabel(Text(verbatim: "\(label). \(help)"))
        .accessibilityValue(isActive ? Text(verbatim: AppearanceSettingsAccessibility.selectedLabel()) : Text(""))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}

extension AppearanceChoiceCard where Leading == EmptyView, Detail == EmptyView {
    init(label: String, help: String, isActive: Bool, isDisabled: Bool = false, action: @escaping () -> Void) {
        self.init(
            label: label, help: help, isActive: isActive, isDisabled: isDisabled,
            leading: { EmptyView() }, detail: { EmptyView() }, action: action
        )
    }
}

extension AppearanceChoiceCard where Detail == EmptyView {
    init(
        label: String,
        help: String,
        isActive: Bool,
        isDisabled: Bool = false,
        @ViewBuilder leading: @escaping () -> Leading,
        action: @escaping () -> Void
    ) {
        self.init(
            label: label, help: help, isActive: isActive, isDisabled: isDisabled,
            leading: leading, detail: { EmptyView() }, action: action
        )
    }
}

// MARK: - Toggle row

/// A labelled switch row (web toggle line inside a panel): a title + help on the
/// leading edge, a `Toggle` trailing. Reports changes through `onChange` so the
/// panel stays decoupled from the view-model. Dims when disabled.
struct AppearanceToggleRow: View {
    let titleKey: String
    let titleFallback: String
    let helpKey: String
    let helpFallback: String
    let isOn: Bool
    var isDimmed: Bool = false
    let onChange: @MainActor (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: 2) {
                AppearanceSettingsStrings.text(titleKey, titleFallback)
                    .font(Font.TS.bodySm).fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                AppearanceSettingsStrings.text(helpKey, helpFallback)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .opacity(isDimmed ? 0.5 : 1)
            Spacer(minLength: TSSpacing.sm)
            Toggle("", isOn: Binding(get: { isOn }, set: onChange))
                .labelsHidden()
                .tint(Color.TS.accent)
                .accessibilityValue(
                    Text(verbatim: AppearanceSettingsAccessibility.toggleStateLabel(isOn))
                )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AppearanceSettingsStrings.text(titleKey, titleFallback))
    }
}

// MARK: - Action button

/// Visual emphasis for the local `AppearanceButton`.
enum AppearanceButtonVariant { case primary, secondary, danger }

/// A small token-styled action button with an optional leading SF Symbol — the
/// native port of the web `Button` (size sm). Resolves its title through the
/// surface i18n facade so no English literal is hardcoded.
struct AppearanceButton: View {
    let titleKey: String
    let fallback: String
    var variant: AppearanceButtonVariant = .secondary
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 12, weight: .semibold))
                }
                AppearanceSettingsStrings.text(titleKey, fallback).font(Font.TS.caption).fontWeight(.semibold)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, TSSpacing.md).padding(.vertical, TSSpacing.sm)
            .frame(minHeight: 34)
            .background(background, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous).strokeBorder(border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AppearanceSettingsStrings.text(titleKey, fallback))
    }

    private var foreground: Color {
        switch variant {
        case .primary, .danger: Color.white
        case .secondary: Color.TS.textPrimary
        }
    }

    private var background: Color {
        switch variant {
        case .primary: Color.TS.accent
        case .danger: Color.TS.statusDanger
        case .secondary: Color.TS.surfaceGlass
        }
    }

    private var border: Color {
        variant == .secondary ? Color.TS.border : Color.clear
    }
}

// MARK: - Swatch helper

/// Parses a `#RRGGBB` hex string into a `Color`, falling back to the accent token
/// for an unparseable value. Used by the chart-palette swatches + accent presets.
func appearanceHexColor(_ hex: String) -> Color {
    var trimmed = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("#") { trimmed.removeFirst() }
    guard trimmed.count == 6, let value = UInt32(trimmed, radix: 16) else { return Color.TS.accent }
    let red = Double((value >> 16) & 0xFF) / 255
    let green = Double((value >> 8) & 0xFF) / 255
    let blue = Double(value & 0xFF) / 255
    return Color(.sRGB, red: red, green: green, blue: blue, opacity: 1)
}
