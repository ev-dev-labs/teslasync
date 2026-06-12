//
//  FormField.Previews.swift
//  TeslaSync — P4 shared surface · 0154 · FormField (Apple)
//
//  Xcode previews for every render branch of the web source: the bare field, the
//  required field, the field with a hint, the validation-error state (which hides the
//  hint), and the accessibility variants (large Dynamic Type, dark appearance). The
//  label resolves through the P1/S10 facade (web `t('alerts.signal', 'Signal')`) so
//  the previews exercise the real localization path. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A representative control for the slot — a bordered text field, styled with the
    /// shared tokens so the previews read like a real form row.
    private struct PreviewControl: View {
        var text: String = ""

        var body: some View {
            TextField("", text: .constant(text))
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
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

    private func previewLabel() -> String {
        FormFieldStrings.string("alerts.signal", "Signal")
    }

    #Preview("Default") {
        FormField(label: previewLabel()) {
            PreviewControl()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Required") {
        FormField(label: previewLabel(), required: true) {
            PreviewControl()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("With hint") {
        FormField(
            label: previewLabel(),
            required: true,
            hint: "Pick the telemetry signal to alert on."
        ) {
            PreviewControl(text: "battery_level")
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error hides hint") {
        FormField(
            label: previewLabel(),
            required: true,
            hint: "Pick the telemetry signal to alert on.",
            error: "Signal is required."
        ) {
            PreviewControl()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Large Dynamic Type") {
        FormField(
            label: previewLabel(),
            required: true,
            error: "Signal is required."
        ) {
            PreviewControl()
        }
        .padding()
        .background(Color.TS.bg)
        .environment(\.dynamicTypeSize, .accessibility3)
    }

    #Preview("Dark") {
        FormField(
            label: previewLabel(),
            required: true,
            hint: "Pick the telemetry signal to alert on."
        ) {
            PreviewControl(text: "battery_level")
        }
        .padding()
        .background(Color.TS.bg)
        .preferredColorScheme(.dark)
    }
#endif
