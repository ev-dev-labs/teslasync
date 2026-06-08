//
//  SettingField.swift
//  TeslaSync — P4 feature view · 0213 · SettingField (Apple)
//
//  Native, Apple-idiomatic parity of the web `SettingField`
//  (features/settings/components/SettingField.tsx).
//
//  A pure presentational wrapper: an uppercase, wide-tracked field label (web
//  `text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]`) with an
//  optional inline help trigger, stacked above the caller-supplied control (web
//  `children`). It owns no data — exactly like the web component — so the
//  loading/empty/error/stale/offline lifecycle belongs to whatever control the caller
//  embeds, not to this leaf. The only branch the web source carries (render the help
//  icon, and within it render nothing when there is no help text) is reproduced by
//  ``SettingFieldLabelRow`` + ``SettingFieldHelpButton`` via the pure
//  ``SettingFieldHelpResolver``.
//
//  On appear it emits the P1/S11 `view.opened` diagnostics event with
//  ``SettingFieldSurface/slug``.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web `SettingField`: a labelled wrapper with an
/// optional inline help trigger above caller-supplied content. Owns no data.
public struct SettingField<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SettingFieldSurface.slug
    }

    private let label: LocalizedStringKey
    private let help: SettingFieldHelp?
    private let telemetry: any SettingFieldTelemetry
    private let content: Content

    /// - Parameters:
    ///   - label: the field label (a P1/S10 catalog key — never raw English); web `label`.
    ///   - help: optional inline help attached to the label; web `help`.
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    ///   - content: the embedded control (web `children`).
    public init(
        _ label: LocalizedStringKey,
        help: SettingFieldHelp? = nil,
        telemetry: any SettingFieldTelemetry = OSLogSettingFieldTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        self.label = label
        self.help = help
        self.telemetry = telemetry
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            SettingFieldLabelRow(label: label, help: help)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .task { SettingFieldSurface.reportOpen(to: telemetry) }
    }
}
