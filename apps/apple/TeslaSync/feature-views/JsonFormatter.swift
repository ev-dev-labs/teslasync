//
//  JsonFormatter.swift
//  TeslaSync — P4 feature view · 0017 · JsonFormatter (Apple)
//
//  The composable JsonFormatter devtools surface — the SwiftUI parity of
//  features/admin/components/devtools/tools/JsonFormatter.tsx. Binds through
//  `JsonFormatterModel` (P1/S8); renders the empty / formatted / invalid states the
//  web source produces. No networking lives here — it is a pure local transform.
//

import SwiftUI

/// The composable JsonFormatter tool — the SwiftUI parity of the web
/// `JsonFormatterTool`. Renders inside a ToolCard-style glass surface, binding
/// through `JsonFormatterModel`.
public struct JsonFormatter: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = JsonFormatterSurface.slug

    @State private var model: JsonFormatterModel

    public init(model: JsonFormatterModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: TSSpacing.md) {
            JsonFormatterHeader()
            JsonFormatterInputField(text: $model.input)
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

    /// The web `{result.error && …}` / `{result.formatted && …}` branches, expanded
    /// so every state renders (never a blank box): a friendly empty hint, the inline
    /// invalid treatment, or the formatted-output panel.
    @ViewBuilder
    private func result(for result: JsonFormatResult) -> some View {
        switch result {
        case .empty:
            JsonFormatterEmptyHint()
        case let .formatted(output):
            JsonFormatterOutputPanel(output: output)
        case let .invalid(error):
            JsonFormatterInvalidPanel(message: model.message(for: error))
        }
    }
}
