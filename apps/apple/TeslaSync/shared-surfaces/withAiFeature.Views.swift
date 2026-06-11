//
//  withAiFeature.Views.swift
//  TeslaSync — P4 shared surface · 0062 · withAiFeature (Apple)
//
//  The presentational pieces of the AI-Off gate: the marker modifier (the native parity of the web
//  wrapper `<div data-ai-feature data-testid>`) and a DEBUG-only sample inner surface used by the
//  previews + the view-composition tests. The marker is intentionally transparent — it stamps a
//  stable accessibility identifier for the off-mode invariant UI tests without altering the inner
//  content's own accessibility tree, exactly as the web `<div>` adds data attributes without an ARIA
//  role. No networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Marker (web `<div data-ai-feature data-testid>`)

/// Stamps the presented inner content with the surface's accessibility identifier — the native peer
/// of the web wrapper's `data-testid` (default `ai-feature-<id>`, or the feature's registered
/// ui-test id). It deliberately does not introduce an accessibility container or label: like the
/// transparent web `<div>`, the inner content keeps its own accessibility tree intact, and the
/// identifier exists purely as a stable selector for the off-mode invariant UI tests.
public struct WithAiFeatureMarker: ViewModifier {
    public let identifier: String

    public init(identifier: String) {
        self.identifier = identifier
    }

    public func body(content: Content) -> some View {
        content.accessibilityIdentifier(identifier)
    }
}

#if DEBUG

    // MARK: - Sample inner (DEBUG previews + view-composition tests)

    /// A small stand-in AI surface used only by the previews and the view-composition tests, so the
    /// gate's "presented" branch has something concrete to wrap. Production callers pass their own
    /// already-localized inner content; this is never shipped (it lives behind `#if DEBUG`).
    struct WithAiFeatureSampleInner: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: WithAiFeatureStrings.string(
                    "withAiFeature.sample.title",
                    "Helix sample surface"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: WithAiFeatureStrings.string(
                    "withAiFeature.sample.body",
                    "This inner content renders only when the AI feature is enabled."
                ))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }
#endif
