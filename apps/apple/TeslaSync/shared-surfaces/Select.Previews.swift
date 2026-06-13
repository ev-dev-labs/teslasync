//
//  Select.Previews.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  Xcode previews for each branch the web source renders: the labelled select, the label + help affordance,
//  the unselected prompt, the error + hint captions, per-option disabling, the four size scales, the required
//  field, the disabled control, the native "never a blank box" empty leaf, and a live controlled demo wired
//  to a selection. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A faux form section hosting the select, so the control reads in context.
    private struct SelectPreviewRow<Content: View>: View {
        let title: String
        @ViewBuilder let content: Content

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
        }
    }

    private let previewVehicles: [SelectOptionInput] = [
        SelectOptionInput(value: "model-s", label: "Model S"),
        SelectOptionInput(value: "model-3", label: "Model 3"),
        SelectOptionInput(value: "model-x", label: "Model X (in service)", isDisabled: true),
        SelectOptionInput(value: "model-y", label: "Model Y")
    ]

    #Preview("Labelled") {
        SelectPreviewRow(title: "Default (md)") {
            FormSelect(options: previewVehicles, selection: "model-3", label: "Vehicle")
        }
    }

    #Preview("Label + help") {
        SelectPreviewRow(title: "With help affordance") {
            FormSelect(
                options: previewVehicles,
                selection: "model-y",
                label: "Vehicle",
                help: HelpIconInput(content: "Pick the vehicle to sync telemetry for.")
            )
        }
    }

    #Preview("Prompt (unselected)") {
        SelectPreviewRow(title: "Prompt shown, nothing chosen") {
            FormSelect(options: previewVehicles, label: "Vehicle", prompt: "Choose a vehicle…")
        }
    }

    #Preview("Error") {
        SelectPreviewRow(title: "Errored + required") {
            FormSelect(
                options: previewVehicles,
                label: "Vehicle",
                error: "Select a vehicle to continue.",
                required: true
            )
        }
    }

    #Preview("Hint") {
        SelectPreviewRow(title: "With helper hint") {
            FormSelect(
                options: previewVehicles,
                selection: "model-s",
                label: "Vehicle",
                hint: "Only vehicles paired to this account are listed."
            )
        }
    }

    #Preview("Sizes") {
        VStack(spacing: TSSpacing.lg) {
            FormSelect(options: previewVehicles, selection: "model-3", label: "Small", size: .small)
            FormSelect(options: previewVehicles, selection: "model-3", label: "Medium", size: .medium)
            FormSelect(options: previewVehicles, selection: "model-3", label: "Large", size: .large)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("Disabled control") {
        SelectPreviewRow(title: "Whole control disabled") {
            FormSelect(options: previewVehicles, selection: "model-3", label: "Vehicle", disabled: true)
        }
    }

    #Preview("Empty (no options)") {
        SelectPreviewRow(title: "No options resolve") {
            FormSelect(options: [], label: "Vehicle")
        }
    }

    #Preview("Live controlled demo") {
        @Previewable @State var selection = "model-3"
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            FormSelect(
                options: previewVehicles,
                selection: selection,
                label: "Vehicle",
                prompt: "Choose a vehicle…",
                onChange: { selection = $0 }
            )
            Text(verbatim: "selection = \"\(selection)\"")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }
#endif
