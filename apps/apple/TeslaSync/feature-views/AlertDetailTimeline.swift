//
//  AlertDetailTimeline.swift
//  TeslaSync — P4 feature view · 0001 · AlertDetailTimeline (Apple)
//
//  The composable "Alert Detail Timeline" feature view — the SwiftUI parity of
//  web/src/features/admin/components/AlertDetailTimeline.tsx. The web leaf is bare: it
//  renders either the `<Timeline>` or the `<EmptyState>` for embedding inside a parent
//  panel. The native surface keeps that bare composition (no panel chrome of its own) and
//  adds the loading / error / stale / offline states the Apple HIG states contract requires,
//  bound through `AlertDetailTimelineModel` (P1/S8). No networking lives here.
//

import SwiftUI

/// The composable Alert Detail Timeline feature view — the SwiftUI parity of
/// `features/admin/components/AlertDetailTimeline.tsx`, binding through
/// `AlertDetailTimelineModel` (P1/S8). No networking lives here.
public struct AlertDetailTimeline: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AlertDetailTimelineSurface.slug

    @State private var model: AlertDetailTimelineModel

    public init(model: AlertDetailTimelineModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                AlertDetailTimelineConnectivityBanner(connection: model.connection)
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
        switch model.phase {
        case .loading:
            AlertDetailTimelineLoadingRows(rows: 4)
        case .empty:
            AlertDetailTimelineEmptyView()
        case let .error(message):
            AlertDetailTimelineErrorView(message: message) { model.refresh() }
        case .content:
            AlertDetailTimelineList(entries: model.events)
        }
    }
}
