//
//  AIDigestNarration.swift
//  TeslaSync — P4 shared surface · 0016 · AIDigestNarration (Apple)
//
//  The Helix weekly-digest narration card — the SwiftUI parity of
//  web/src/components/ai/AIDigestNarration.tsx. It is `withAiFeature('digest-narration')` in the web
//  source (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection streams from
//  POST /ai/digests/weekly/narrate (body `{ vehicle_id: vehicleId ?? 0, week_offset_weeks: 0 }`) and
//  renders the shared `AIFeatureCard` (title "Helix narration", a description, the Ask-Helix button,
//  the "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that composition natively,
//  bound through `DigestNarrationModel` (P1/S8); no networking lives here.
//
//  It does NOT replace the deterministic template digest (the Driving / Charging / Battery-health
//  sections); like the web source it is opt-in narrative prose layered alongside the canonical
//  baseline.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no narration has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIDigestNarration (the shared surface)

/// The Helix weekly-digest narration card — the SwiftUI parity of `AIDigestNarration.tsx`. Renders
/// every state from the web source plus the P4 leaf freshness states, binding through
/// `DigestNarrationModel`.
public struct AIDigestNarration: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIDigestNarration"

    @State private var model: DigestNarrationModel

    public init(model: DigestNarrationModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.isGated {
                // Web `withAiFeature` off → the whole surface is withdrawn.
                EmptyView()
            } else {
                card
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - Card chrome

private extension AIDigestNarration {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                DigestNarrationConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: DigestNarrationStrings.string(
                "analytics.weeklyDigest.aiNarration.title",
                "Helix narration"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: DigestNarrationStrings.string(
                "analytics.weeklyDigest.aiNarration.title",
                "Helix narration"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            DigestNarrationHelixBadge(
                label: DigestNarrationStrings.string("analytics.weeklyDigest.aiNarration.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            DigestNarrationFreshnessChip(connection: model.connection)
            DigestNarrationRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIDigestNarration {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            DigestNarrationLoadingView()
        case let .error(message):
            DigestNarrationGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                DigestNarrationReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
