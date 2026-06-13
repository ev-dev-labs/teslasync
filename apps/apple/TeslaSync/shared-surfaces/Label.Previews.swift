//
//  Label.Previews.swift
//  TeslaSync — P4 shared surface · 0218 · Label (Apple)
//
//  Xcode previews for every real branch of the form label: the plain (not-required) label, the required
//  label (visible `*` + the screen-reader "required" suffix), a required label paired with a field (the web
//  `htmlFor` association), and the native "never a blank box" empty-text leaf. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ caption: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: caption)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Plain — not required") {
        staged("required: false") {
            FormLabel("Email address")
        }
    }

    #Preview("Required") {
        staged("required: true · visible * · spoken \"Email address required\"") {
            FormLabel("Email address", required: true)
        }
    }

    #Preview("Required — paired with a field") {
        staged("fieldIdentifier wires the htmlFor association") {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                FormLabel("Vehicle name", required: true, fieldIdentifier: "vehicle-name")
                TextField("", text: .constant(""))
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    #Preview("Empty — never a blank box") {
        staged("blank content · muted fallback leaf") {
            FormLabel("", required: true)
        }
    }
#endif
