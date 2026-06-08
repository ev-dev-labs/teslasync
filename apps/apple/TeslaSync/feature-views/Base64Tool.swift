//
//  Base64Tool.swift
//  TeslaSync — P4 feature view · 0011 · Base64Tool (Apple)
//
//  The composable Base64 devtools surface — the SwiftUI parity of
//  features/admin/components/devtools/tools/Base64Tool.tsx. Binds through
//  `Base64ToolModel` (P1/S8); renders the empty / content / invalid states the web
//  source produces, across encode + decode modes. No networking lives here.
//

import SwiftUI

/// The composable Base64 tool — the SwiftUI parity of the web `Base64Tool`.
/// Renders inside a ToolCard-style glass surface, binding through `Base64ToolModel`.
public struct Base64Tool: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = Base64Surface.slug

    @State private var model: Base64ToolModel

    public init(model: Base64ToolModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: TSSpacing.md) {
            Base64ToolHeader()
            Base64ModeToggle(mode: model.mode, onSelect: model.select)
            Base64InputField(text: $model.input, example: model.example)
            result(for: model.result)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .task { model.start() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `{output && …}` branch, expanded so every state renders (never a
    /// blank box): a friendly empty hint, the inline invalid treatment, or the
    /// output panel.
    @ViewBuilder
    private func result(for result: Base64Result) -> some View {
        switch result {
        case .empty:
            Base64EmptyHint()
        case .invalid:
            Base64InvalidPanel()
        case let .encoded(output), let .decoded(output):
            Base64OutputPanel(output: output)
        }
    }
}
