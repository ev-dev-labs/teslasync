//
//  SettingField.Previews.swift
//  TeslaSync — P4 feature view · 0213 · SettingField (Apple)
//
//  Xcode previews for each branch the web source carries: a field with keyed help, a
//  field with plain-text help, a field whose help resolves to nothing (so no trigger
//  renders — the web `if (!text) return null`), and a bare field with no help. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A small host that supplies a bound control as the field's `children`, so the
    /// previews exercise the wrapper around a real input rather than static text.
    private struct SettingFieldPreviewHost: View {
        let label: LocalizedStringKey
        let help: SettingFieldHelp?

        @State private var value = ""

        var body: some View {
            SettingField(label, help: help) {
                TextField("settingField.preview.prompt", text: $value)
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    #Preview("Keyed help") {
        SettingFieldPreviewHost(
            label: "settingField.preview.displayName",
            help: SettingFieldHelp(
                i18nKey: "settingField.preview.help",
                content: "This name appears on your dashboard and in shared links.",
                fieldID: "display_name"
            )
        )
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("Plain-text help") {
        SettingFieldPreviewHost(
            label: "settingField.preview.apiToken",
            help: SettingFieldHelp(content: "Paste the token from your Tesla developer account.")
        )
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("Empty help · no trigger") {
        SettingFieldPreviewHost(
            label: "settingField.preview.region",
            help: SettingFieldHelp(content: "")
        )
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("No help") {
        SettingFieldPreviewHost(label: "settingField.preview.nickname", help: nil)
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
    }
#endif
