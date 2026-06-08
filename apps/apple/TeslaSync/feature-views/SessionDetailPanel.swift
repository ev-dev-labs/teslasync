//
//  SessionDetailPanel.swift
//  TeslaSync — P4 feature view · 0091 · SessionDetailPanel (Apple)
//
//  The composable Session Details feature view — the SwiftUI parity of
//  features/charging/components/charging-curve/SessionDetailPanel.tsx. Binds through
//  `SessionDetailModel` (no networking in the view) and renders every state: loading
//  (skeleton rows) · error (QueryError + retry) · empty (a friendly note) · data (the
//  label/value rows), with the live-state freshness chip + stale/offline banner (ADR-013)
//  layered on top inside a glass panel (web `GlassPanel`).
//

import SwiftUI

/// The composable Session Details surface — the SwiftUI parity of
/// `features/charging/components/charging-curve/SessionDetailPanel.tsx`. Renders every state,
/// binding through `SessionDetailModel` (P1/S8). No networking lives here.
public struct SessionDetailPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SessionDetailPanel"

    @State private var model: SessionDetailModel

    public init(model: SessionDetailModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.15) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SessionDetailHeader(title: title, connection: model.connection)
                if model.connection != .live {
                    SessionDetailConnectivityBanner(connection: model.connection)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.xl)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SessionDetailLoadingList()
        case let .error(message):
            SessionDetailErrorView(message: message) { model.refresh() }
        case .empty:
            SessionDetailEmptyView()
        case .data:
            SessionDetailRowsView(rows: model.rows)
        }
    }

    /// Web `t('charging.curve.sessionDetails', 'Session Details')`.
    private var title: String {
        SessionDetailStrings.string("charging.curve.sessionDetails", "Session Details")
    }
}
