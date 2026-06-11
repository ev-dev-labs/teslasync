//
//  withAiFeature.swift
//  TeslaSync — P4 shared surface · 0062 · withAiFeature (Apple)
//
//  The AI-Off visibility gate — the SwiftUI parity of components/ai/withAiFeature.tsx. The web
//  source is a higher-order component (ADR-015): it gates an AI feature's UI behind
//  `useAiEnabled(feature)`, returning `null` unless the feature is on end-to-end and otherwise
//  wrapping the inner element in a `<div data-ai-feature data-testid>` marker. The native peer is
//  `WithAiFeature`, a generic container that wraps any inner SwiftUI view, plus the ergonomic
//  `.withAiFeature(_:gate:)` modifier (the idiomatic Swift spelling of an HOC). Both bind through
//  `WithAiFeatureGateModel` (P1/S8); no networking lives in the view.
//
//  Outcomes (faithful to the transparent web HOC — it renders no chrome of its own):
//    • withdrawn — every fail-closed gate verdict (unknown feature / settings unresolved / settings
//                  failed / AI mode off / per-feature flag off) → the surface renders nothing
//                  (web `withAiFeature` returns `null`; ADR-015 AI-Off contract). No skeleton, no
//                  error panel, no stale/offline chip — the inner content owns all visible UI.
//    • presented — gate enabled → the inner content renders, stamped with the marker identifier
//                  (web `data-testid`) so the off-mode invariant UI tests have a stable selector.
//

import SwiftUI

// MARK: - WithAiFeature (the shared surface)

/// The AI-Off visibility gate — the SwiftUI parity of `withAiFeature`. Renders the wrapped `Inner`
/// content only when the gate is enabled, withdrawing the surface entirely otherwise, and binding
/// through `WithAiFeatureGateModel`.
public struct WithAiFeature<Inner: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        AiFeatureGateSurface.slug
    }

    @State private var model: WithAiFeatureGateModel
    private let inner: Inner

    /// Primary initializer — binds a caller-built model (the parity of mounting the HOC with an
    /// already-resolved gate). Used by previews / tests that drive an `InMemoryWithAiFeatureGateSource`.
    public init(model: WithAiFeatureGateModel, @ViewBuilder inner: () -> Inner) {
        _model = State(initialValue: model)
        self.inner = inner()
    }

    /// Convenience initializer wiring the production settings-backed source — the parity of
    /// `withAiFeature(feature, Inner)` at a call site. `input` is the host's current settings
    /// snapshot (web `useSettings` → `useAiEnabled(feature)`) plus the connectivity axis; `testID`
    /// overrides the default `ai-feature-<id>` marker with the feature's registered ui-test id when
    /// the caller knows it (web `meta.uiTestIds[0]`).
    ///
    /// An unknown feature id trips a debug assertion — the native peer of the web HOC's
    /// construction-time `throw` (a typo is caught the first time the surface is built rather than
    /// silently rendering nothing forever). In release the gate fails closed (the surface is
    /// withdrawn), which is strictly safer than crashing a shipped build.
    public init(
        _ feature: String,
        gate input: AiFeatureGateInput,
        testID: String? = nil,
        @ViewBuilder inner: () -> Inner
    ) {
        assert(
            AiFeatureRegistryGuard.isKnown(feature),
            "withAiFeature: unknown AI feature id \"\(feature)\". " +
                "Add it to internal/ai/features/registry.go and run `make generate`."
        )
        var snapshot = input
        snapshot.featureID = feature
        let model = WithAiFeatureGateModel(
            feature: feature,
            source: LiveWithAiFeatureGateSource(input: snapshot),
            testID: testID
        )
        _model = State(initialValue: model)
        self.inner = inner()
    }

    public var body: some View {
        Group {
            if model.isPresented {
                inner.modifier(WithAiFeatureMarker(identifier: model.markerIdentifier))
            } else {
                // Faithful `withAiFeature` / ADR-015 AI-Off parity: every fail-closed verdict
                // withdraws the surface so no AI UI leaks (web HOC returns null).
                EmptyView()
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - View modifier (idiomatic HOC spelling)

public extension View {
    /// Gates `self` behind the AI-Off contract — the ergonomic, idiomatic-Swift spelling of the web
    /// `withAiFeature(feature, Inner)` HOC. The receiver renders only when the gate is enabled and
    /// is stamped with the marker identifier; otherwise the surface is withdrawn (web `null`).
    ///
    /// - Parameters:
    ///   - feature: the registered AI feature id (web `withAiFeature(feature, …)`).
    ///   - input: the current settings + connectivity snapshot (web `useSettings` → `useAiEnabled`).
    ///   - testID: optional override for the marker identifier (web `meta.uiTestIds[0]`).
    func withAiFeature(
        _ feature: String,
        gate input: AiFeatureGateInput,
        testID: String? = nil
    ) -> some View {
        WithAiFeature(feature, gate: input, testID: testID) { self }
    }
}
