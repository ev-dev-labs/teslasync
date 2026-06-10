//
//  AIDriveCoaching.swift
//  TeslaSync — P4 shared surface · 0017 · AIDriveCoaching (Apple)
//
//  The Helix drive-coaching card — the SwiftUI parity of
//  web/src/components/ai/AIDriveCoaching.tsx. It is `withAiFeature('drive-coaching')` in the web
//  source (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection streams from
//  POST /ai/drives/{driveID}/coach (empty `{}` body) and renders the shared `AIFeatureCard`
//  (title "Drive coaching", a description, the Ask-Helix button, the "Helix" badge) feeding
//  `AiOutputPanel`. This surface reproduces that composition natively, bound through
//  `DriveCoachingModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no coaching has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIDriveCoaching (the shared surface)

/// The Helix drive-coaching card — the SwiftUI parity of `AIDriveCoaching.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through `DriveCoachingModel`.
public struct AIDriveCoaching: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIDriveCoaching"

    @State private var model: DriveCoachingModel

    public init(model: DriveCoachingModel) {
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

private extension AIDriveCoaching {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                DriveCoachingConnectivityBanner(connection: model.connection)
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
            Text(verbatim: DriveCoachingStrings.string(
                "driveDetail.aiCoaching.title",
                "Drive coaching"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: DriveCoachingStrings.string(
                "driveDetail.aiCoaching.title",
                "Drive coaching"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            DriveCoachingHelixBadge(label: DriveCoachingStrings.string("driveDetail.aiCoaching.badge", "Helix"))
            Spacer(minLength: TSSpacing.sm)
            DriveCoachingFreshnessChip(connection: model.connection)
            DriveCoachingRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIDriveCoaching {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            DriveCoachingLoadingView()
        case let .error(message):
            DriveCoachingGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                DriveCoachingReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
