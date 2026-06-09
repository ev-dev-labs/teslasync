//
//  CodeBlock.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  The chatbot fenced-code block surface — the SwiftUI parity of
//  features/system/components/chatbot/CodeBlock.tsx, the presentational wrapper react-markdown hands its
//  fenced code: a bordered card with a header (the uppercased language tag + a copy-to-clipboard button)
//  over a horizontally scrollable monospaced body, with no syntax highlighting (web parity). Binds through
//  `CodeBlockModel` (P1/S8); no networking lives in the view. This view switches over the model's phase so
//  every prompt-required state renders (loading / content / empty / error) under the stale / offline
//  freshness envelope. A fully live, rendered snippet is just the card — exactly like the web source.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension CodeBlockStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so the
    /// model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - CodeBlock (the fenced-code surface)

/// The chatbot fenced-code block. The host supplies the snippet through the model's bound source (P1/S8);
/// this view renders the card and the surrounding state chrome.
public struct CodeBlock: View {
    @State private var model: CodeBlockModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: CodeBlockModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if model.connection != .live {
                CodeBlockConnectivityBanner(connection: model.connection)
            }
            phaseBody
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration), value: model.phase)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch model.phase {
        case .loading:
            CodeBlockLoadingState()
        case .content:
            if let projection = model.projection {
                CodeBlockCard(
                    projection: projection,
                    connection: model.connection,
                    isFetching: model.isFetching,
                    onCopy: { model.copy() }
                )
            } else {
                CodeBlockEmptyState()
            }
        case .empty:
            CodeBlockEmptyState()
        case let .error(message):
            CodeBlockErrorState(message: message) { model.refresh() }
        }
    }
}

// MARK: - Convenience + surface identity

public extension CodeBlock {
    /// Renders a ready, live snippet directly (call sites / simple hosts / previews). The production app
    /// injects a `CodeBlockModel` bound to the chatbot fenced-code stream instead.
    init(language: String? = nil, text: String) {
        self.init(model: CodeBlockModel(language: language, text: text))
    }

    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        CodeBlockSurface.slug
    }
}
