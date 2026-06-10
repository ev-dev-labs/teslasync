//
//  AIThinkingIndicator.Previews.swift
//  TeslaSync — P4 shared surface · 0053 · AIThinkingIndicator (Apple)
//
//  Xcode previews for the presentation forms the web source has — the full indicator (default
//  label), the full indicator with a caller override, and the compact in-button dots. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope. Reduce Motion is
//  environment-driven (handled in the Views and exercised by the inert-path view tests); it is
//  toggled through the canvas accessibility overrides rather than a get-only environment key.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 360, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Full — thinking (default label)") {
        staged(AIThinkingIndicator(model: AIThinkingIndicatorModel()))
    }

    #Preview("Full — custom label override") {
        staged(AIThinkingIndicator(label: AIThinkingStrings.string(
            AIThinkingIndicatorMeta.altLabelKey,
            AIThinkingIndicatorMeta.altLabelFallback
        )))
    }

    #Preview("Compact dots (in-button)") {
        staged(
            AIThinkingDots(label: AIThinkingStrings.string(
                AIThinkingIndicatorMeta.altLabelKey,
                AIThinkingIndicatorMeta.altLabelFallback
            ))
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.accent)
        )
    }
#endif
