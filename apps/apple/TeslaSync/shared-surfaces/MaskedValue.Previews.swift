//
//  MaskedValue.Previews.swift
//  TeslaSync — P4 shared surface · 0220 · MaskedValue (Apple)
//
//  Xcode previews for every real branch of the privacy primitive: the five masking variants (token, vin,
//  coords, email, generic), the copyable variant, the revealed state (via an injected model), and the
//  em-dash empty branch. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
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
        .frame(maxWidth: 480, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Variants — masked") {
        staged("token · vin · coords · email · generic") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                MaskedValue(value: "sk_live_8sQ2k1z0Vb7nPqRt", variant: .token, ariaLabel: "API token")
                MaskedValue(value: "5YJ3E1EA7JF000316", variant: .vin, ariaLabel: "Vehicle VIN")
                MaskedValue(value: "37.7749,-122.4194", variant: .coords, ariaLabel: "Home coordinates")
                MaskedValue(value: "jane.doe@example.com", variant: .email, ariaLabel: "Account e-mail")
                MaskedValue(value: "supersecretvalue", variant: .generic, ariaLabel: "Secret value")
            }
        }
    }

    #Preview("Copyable + reveal") {
        staged("copy button · revealed via injected model") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                MaskedValue(
                    value: "ghp_AbC0123456789DeFgHiJkLmNoPqRsTuV",
                    variant: .token,
                    copyable: true,
                    ariaLabel: "Personal access token"
                )
                MaskedValue(model: revealedModel())
            }
        }
    }

    #Preview("Empty — em-dash") {
        staged("nil / empty value → em-dash, no toggle") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                MaskedValue(value: nil, variant: .token, ariaLabel: "API token")
                MaskedValue(value: "", variant: .generic, ariaLabel: "Secret value")
            }
        }
    }

    /// A model seeded into the revealed state (auto-hide disabled) so the preview shows the cleartext +
    /// accent tone + the `eye.slash` toggle without waiting on the timer.
    @MainActor
    private func revealedModel() -> MaskedValueModel {
        let model = MaskedValueModel(
            input: MaskedValueInput(
                value: "5YJ3E1EA7JF000316",
                variant: .vin,
                copyable: true,
                ariaLabel: "Vehicle VIN",
                autoHideMs: 0
            )
        )
        model.reveal()
        return model
    }
#endif
