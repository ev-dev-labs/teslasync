//
//  AIVehiclePaintPreview.swift
//  TeslaSync — P4 shared surface · 0058 · AIVehiclePaintPreview (Apple)
//
//  The Helix vehicle-paint-preview card — the SwiftUI parity of
//  web/src/components/ai/AIVehiclePaintPreview.tsx. It is `withAiFeature('vehicle-paint-preview')`
//  in the web source (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection
//  streams from POST /ai/vehicles/{vehicleID}/paint-preview/draft (an optional `{ style_hint }` body
//  so the LLM only receives the one-word style hint) and renders the shared `AIFeatureCard` (title
//  "Draft a Helix paint preview", a description, the Preview-paint-color button, the "Helix" badge,
//  and the `emptyHint` shown when no vehicle is in scope) feeding `AiOutputPanel`. This surface
//  reproduces that composition natively, bound through `PaintPreviewModel` (P1/S8); no networking
//  lives here.
//
//  It never replaces the deterministic VehicleConfigSection or the manual per-vehicle Color setting
//  on VehicleDetailPage; like the web source it adds an opt-in, propose-only image-prompt drafting
//  section beneath the canonical appearance controls (ADR-015 §I3 baseline intact). Helix drafts an
//  image prompt; the user applies paint through the existing Color setting.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no preview has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + the header vehicle hint (when no vehicle) + Preview-paint-color
//                button + output panel (empty / no-vehicle / thinking / prose / error), plus the
//                orthogonal connectivity axis (live / stale / offline) driving the header freshness
//                chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIVehiclePaintPreview (the shared surface)

/// The Helix vehicle-paint-preview card — the SwiftUI parity of `AIVehiclePaintPreview.tsx`. Renders
/// every state from the web source plus the P4 leaf freshness states, binding through
/// `PaintPreviewModel`.
public struct AIVehiclePaintPreview: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIVehiclePaintPreview"

    @State private var model: PaintPreviewModel

    public init(model: PaintPreviewModel) {
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

private extension AIVehiclePaintPreview {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                PaintPreviewConnectivityBanner(connection: model.connection)
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
            Text(verbatim: PaintPreviewStrings.string(
                "vehicles.aiPaintPreview.title",
                "Draft a Helix paint preview"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: PaintPreviewStrings.string(
                "vehicles.aiPaintPreview.title",
                "Draft a Helix paint preview"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            PaintPreviewHelixBadge(
                label: PaintPreviewStrings.string("vehicles.aiPaintPreview.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            PaintPreviewFreshnessChip(connection: model.connection)
            PaintPreviewRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIVehiclePaintPreview {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            PaintPreviewLoadingView()
        case let .error(message):
            PaintPreviewGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                PaintPreviewReadyView(ready: ready) { model.preview() }
            }
        }
    }
}
