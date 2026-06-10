//
//  AIFeatureCard.Previews.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  Xcode previews for each surface state (idle / disabled+hint / streaming / text / error /
//  stale / offline) plus the layout variants (button-below, prompt-input slot, domain children).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope. The sample
//  content resolves through the P1/S10 facade so the previews carry no hardcoded literals.
//

import Foundation
import SwiftUI

#if DEBUG
    enum AIFeatureCardPreviewData {
        static var content: AIFeatureCardContent {
            AIFeatureCardContent(
                title: AIFeatureCardStrings.string("aiFeatureCard.preview.title", "Summarize incidents"),
                description: AIFeatureCardStrings.string(
                    "aiFeatureCard.preview.description",
                    "Helix reviews the selected window and writes a short incident summary."
                ),
                buttonLabel: AIFeatureCardStrings.string("aiFeatureCard.preview.button", "Summarize"),
                emptyHint: AIFeatureCardStrings.string(
                    "aiFeatureCard.preview.emptyHint",
                    "Select a window with at least one incident to summarize."
                )
            )
        }

        static let sampleText = """
        Three incidents in the selected window: a vampire-drain spike overnight, a slow charge \
        session at the office, and a regen drop on the mountain descent. None require action.
        """
    }

    @MainActor
    private func previewModel(_ input: AIFeatureCardInput) -> AIFeatureCardModel {
        let model = AIFeatureCardModel(source: InMemoryAIFeatureCardSource(initial: input))
        model.start()
        return model
    }

    @MainActor
    private func staged(
        _ input: AIFeatureCardInput,
        placement: AIFeatureCardButtonPlacement = .inline
    ) -> some View {
        AIFeatureCard(
            model: previewModel(input),
            content: AIFeatureCardPreviewData.content,
            placement: placement
        )
        .padding()
        .frame(maxWidth: 460)
        .background(Color.TS.bg)
    }

    #Preview("Idle") {
        staged(AIFeatureCardInput(phase: .idle, canStart: true))
    }

    #Preview("Disabled + hint") {
        staged(AIFeatureCardInput(phase: .idle, canStart: false))
    }

    #Preview("Streaming") {
        staged(AIFeatureCardInput(phase: .streaming, text: "", canStart: true))
    }

    #Preview("Text") {
        staged(AIFeatureCardInput(phase: .done, text: AIFeatureCardPreviewData.sampleText, canStart: true))
    }

    #Preview("Error") {
        staged(AIFeatureCardInput(phase: .error("rate limit exceeded"), canStart: true))
    }

    #Preview("Stale") {
        staged(AIFeatureCardInput(phase: .done, text: AIFeatureCardPreviewData.sampleText, connection: .stale))
    }

    #Preview("Offline") {
        staged(AIFeatureCardInput(phase: .idle, canStart: true, connection: .offline))
    }

    #Preview("Button below") {
        staged(AIFeatureCardInput(phase: .idle, canStart: true), placement: .below)
    }

    #Preview("Prompt-input slot") {
        AIFeatureCard(
            model: previewModel(AIFeatureCardInput(phase: .idle, canStart: true)),
            content: AIFeatureCardPreviewData.content,
            placement: .below,
            inputSlot: { TSSkeleton(height: 64, cornerRadius: TSRadius.md) },
            children: { EmptyView() }
        )
        .padding()
        .frame(maxWidth: 460)
        .background(Color.TS.bg)
    }

    #Preview("Domain children") {
        AIFeatureCard(
            model: previewModel(AIFeatureCardInput(phase: .done, text: AIFeatureCardPreviewData.sampleText)),
            content: AIFeatureCardPreviewData.content
        ) {
            TSBadge("aiFeatureCard.preview.button", tone: .info)
        }
        .padding()
        .frame(maxWidth: 460)
        .background(Color.TS.bg)
    }
#endif
