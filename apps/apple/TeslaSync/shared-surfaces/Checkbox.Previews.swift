//
//  Checkbox.Previews.swift
//  TeslaSync — P4 shared surface · 0204 · Checkbox (Apple)
//
//  Xcode previews for every real branch the web source supports — the unchecked / checked states, the
//  indeterminate (mixed) state, the three size variants (`sm` / `md` / `lg`), the labelled and
//  unlabeled forms, the disabled box, and a long label exercising Dynamic Type wrapping. The
//  interactive previews drive a live `@State` binding so the box flips, the native parity of the web
//  controlled `checked` + `onChange`. The accent + border + type + radius + spacing come from the
//  P1/S9 tokens. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Interactive — labelled") {
        @Previewable @State var on = true
        return staged("uncontrolled binding · tap to flip") {
            Checkbox(isChecked: $on, label: "Remember this vehicle")
        }
    }

    #Preview("Unchecked / checked") {
        staged("controlled · both states") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Checkbox(isChecked: false, label: "Sentry mode", onChange: { _ in })
                Checkbox(isChecked: true, label: "Climate keeper", onChange: { _ in })
            }
        }
    }

    #Preview("Indeterminate — mixed") {
        staged("select-all header · mixed glyph") {
            Checkbox(isChecked: false, indeterminate: true, label: "Select all drives", onChange: { _ in })
        }
    }

    #Preview("Sizes — sm / md / lg") {
        staged("three size variants · checked") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Checkbox(isChecked: true, label: "Small", size: .small, onChange: { _ in })
                Checkbox(isChecked: true, label: "Medium", size: .medium, onChange: { _ in })
                Checkbox(isChecked: true, label: "Large", size: .large, onChange: { _ in })
            }
        }
    }

    #Preview("No label — accessible name only") {
        staged("bare box · VoiceOver name from fallback") {
            Checkbox(isChecked: true, onChange: { _ in })
        }
    }

    #Preview("Disabled") {
        staged("non-interactive · dimmed") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Checkbox(isChecked: true, label: "Locked on", isDisabled: true, onChange: { _ in })
                Checkbox(isChecked: false, label: "Locked off", isDisabled: true, onChange: { _ in })
            }
        }
    }

    #Preview("Long label — Dynamic Type") {
        @Previewable @State var on = false
        return staged("wrapping label at accessibility size") {
            Checkbox(
                isChecked: $on,
                label: "Share anonymized telemetry to improve route efficiency estimates"
            )
        }
        .environment(\.dynamicTypeSize, .accessibility3)
    }
#endif
