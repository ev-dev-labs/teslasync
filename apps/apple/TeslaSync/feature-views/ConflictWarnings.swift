//
//  ConflictWarnings.swift
//  TeslaSync — P4 feature view · 0084 · ConflictWarnings (Apple)
//
//  The composable automation-conflict warnings surface — the SwiftUI parity of
//  features/automations/pages/ConflictWarnings.tsx. Binds through
//  `ConflictWarningsModel` (P1/S8); no networking lives here. Renders the web
//  leaf's conflict-banner list plus the P4 states the leaf delegates to its
//  parent: loading skeleton, never-a-blank-box empty (web `return null`),
//  query-error retry, and the stale/offline status chips.
//

import SwiftUI

/// The composable conflict-warnings surface — the SwiftUI parity of
/// `features/automations/pages/ConflictWarnings.tsx`, binding through
/// `ConflictWarningsModel` (P1/S8). No networking lives here.
public struct ConflictWarnings: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ConflictWarnings"

    @State private var model: ConflictWarningsModel

    public init(model: ConflictWarningsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.isOffline {
                ConflictStatusChip(copy: CWCopy.offline, tone: .warning, systemImage: "wifi.slash")
            }
            if model.isStale {
                ConflictStatusChip(
                    copy: CWCopy.stale,
                    tone: .neutral,
                    systemImage: "clock.badge.exclamationmark"
                )
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.render {
        case .loading:
            ConflictWarningsLoading()
        case .failed:
            ConflictWarningsError(onRetry: { model.refresh() })
        case .empty:
            ConflictWarningsEmpty()
        case let .conflicts(rows):
            ConflictWarningsList(rows: rows)
        }
    }
}
