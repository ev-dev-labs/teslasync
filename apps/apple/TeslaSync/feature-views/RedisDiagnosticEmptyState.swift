//
//  RedisDiagnosticEmptyState.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  The composable Redis-diagnostic empty-state surface — the SwiftUI parity of
//  features/admin/components/RedisDiagnosticEmptyState.tsx. Replaces the generic "no
//  signals cached" empty state with a structured, actionable banner that branches on the
//  diagnostic `meta` block + the upstream request error. Binds through
//  `RedisDiagnosticModel` (P1/S8); no networking lives here. Renders every state the web
//  source has: the four upstream-error branches, the legacy no-meta fallback, and the
//  four meta branches (mode-local / mirror-broken / no-telemetry / fallthrough).
//

import SwiftUI

/// The composable Redis-diagnostic empty-state surface — the SwiftUI parity of
/// `features/admin/components/RedisDiagnosticEmptyState.tsx`, binding through
/// `RedisDiagnosticModel` (P1/S8). No networking lives here.
public struct RedisDiagnosticEmptyState: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RedisDiagnosticEmptyState"

    @State private var model: RedisDiagnosticModel

    public init(model: RedisDiagnosticModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        if model.resolved.kind == .legacyEmpty {
            RedisLegacyEmptyState(message: model.resolved.title.resolved(RDStrings.string))
        } else {
            RedisDiagnosticBanner(
                resolved: model.resolved,
                meta: model.meta,
                chips: model.chips,
                docsBaseURL: model.docsBaseURL,
                onRetry: { model.refresh() },
                onSelect: { model.selectVehicle($0) }
            )
        }
    }
}
