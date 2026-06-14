//
//  Input.Previews.swift
//  TeslaSync — P4 shared surface · 0217 · Input (Apple)
//
//  Xcode previews for every real branch the web source supports — the bare field, the labeled field,
//  the required field with a help trigger, the leading-icon and trailing-suffix regions, the error
//  state (red border + message), the hint state, the disabled and secure fields, and the four size
//  variants (`sm` / `md` / `lg` / `auto`). The interactive previews drive a live `@State` binding so
//  the value edits, the native parity of the web controlled `value` + `onChange`. The surface, border,
//  accent, type, radius, and spacing come from the P1/S9 tokens. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
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
        .frame(maxWidth: 380, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Interactive — labeled") {
        @Previewable @State var value = ""
        return staged("bound value · type to edit") {
            InputField(text: $value, label: "Display name", placeholder: "Model 3 Performance")
        }
    }

    #Preview("Bare field — no label") {
        @Previewable @State var value = "S3XY"
        return staged("placeholder only · accessible name from fallback") {
            InputField(text: $value, placeholder: "Search vehicles")
        }
    }

    #Preview("Required + help") {
        @Previewable @State var value = ""
        return staged("required marker · help trigger") {
            InputField(
                text: $value,
                label: "Charge limit",
                help: "The battery percentage at which charging stops.",
                placeholder: "80",
                isRequired: true
            )
        }
    }

    #Preview("Leading icon") {
        @Previewable @State var value = ""
        return staged("icon region · web pl-10") {
            InputField(
                text: $value,
                label: "Find a trip",
                placeholder: "Destination",
                icon: { Image(systemName: "magnifyingglass") }
            )
        }
    }

    #Preview("Trailing suffix") {
        @Previewable @State var value = "240"
        return staged("suffix region · web pr-10") {
            InputField(
                text: $value,
                label: "Range estimate",
                placeholder: "0",
                icon: { EmptyView() },
                suffix: {
                    Text(verbatim: "km")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            )
        }
    }

    #Preview("Error — suppresses hint") {
        @Previewable @State var value = "-10"
        return staged("invalid · red border + message") {
            InputField(
                text: $value,
                label: "Charge limit",
                error: "Enter a value between 50 and 100.",
                hint: "This hint is hidden while an error is shown.",
                placeholder: "80"
            )
        }
    }

    #Preview("Hint") {
        @Previewable @State var value = ""
        return staged("supporting hint · no error") {
            InputField(
                text: $value,
                label: "Vehicle nickname",
                hint: "Shown across the app instead of the VIN.",
                placeholder: "Bluey"
            )
        }
    }

    #Preview("Disabled / secure") {
        @Previewable @State var token = "tesla-fleet-key"
        return staged("non-interactive + masked") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                InputField(text: .constant("VIN locked"), label: "VIN", isDisabled: true)
                InputField(text: $token, label: "API token", isSecure: true)
            }
        }
    }

    #Preview("Sizes — sm / md / lg / auto") {
        @Previewable @State var value = "Tesla"
        return staged("four size variants") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                InputField(text: $value, label: "Small", size: .small)
                InputField(text: $value, label: "Medium", size: .medium)
                InputField(text: $value, label: "Large", size: .large)
                InputField(text: $value, label: "Auto (density)", size: .auto)
            }
        }
    }

    #Preview("Long label — Dynamic Type") {
        @Previewable @State var value = ""
        return staged("wrapping label at accessibility size") {
            InputField(
                text: $value,
                label: "Share anonymized telemetry to improve route efficiency estimates",
                hint: "You can change this any time in Settings.",
                isRequired: true
            )
        }
        .environment(\.dynamicTypeSize, .accessibility3)
    }
#endif
