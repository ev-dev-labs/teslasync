//
//  MarkdownRenderer.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The chatbot markdown renderer surface — the SwiftUI parity of
//  features/system/components/chatbot/MarkdownRenderer.tsx, which renders an assistant chat message as
//  sanitized markdown (react-markdown + remark-gfm) with a raw-text Suspense fallback. Binds through
//  `MarkdownRendererModel` (P1/S8); no networking lives in the view. The model parses the bound message
//  content into a `MarkdownDocument`; this view switches over its phase so every prompt-required state
//  renders (loading / ready / empty / error) under the stale / offline freshness envelope. A fully live,
//  rendered message is just the prose — exactly like the web source, which renders only the formatted text.
//

import SwiftUI

/// The chatbot markdown renderer. The host supplies the message content through the model's bound source
/// (P1/S8); this view renders the parsed document and the surrounding state chrome. Safe-by-default like
/// the web source: raw HTML never executes (it renders as escaped text) and links open only safe schemes.
public struct MarkdownRenderer: View {
    @State private var model: MarkdownRendererModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: MarkdownRendererModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                MarkdownConnectivityBanner(connection: model.connection)
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
            MarkdownLoadingState(rawText: model.rawText)
        case .ready:
            MarkdownDocumentView(document: model.document, onCopy: model.copyCode)
        case .empty:
            MarkdownEmptyState()
        case let .error(message):
            MarkdownErrorState(message: message) { model.retry() }
        }
    }
}

// MARK: - Convenience + surface identity

public extension MarkdownRenderer {
    /// Renders a ready, live markdown string directly (call sites / simple hosts / previews). The
    /// production app injects a `MarkdownRendererModel` bound to the chatbot message stream instead.
    init(markdown: String) {
        self.init(model: MarkdownRendererModel(markdown: markdown))
    }

    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        MarkdownRendererSurface.slug
    }
}
