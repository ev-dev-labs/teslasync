//
//  QueueStatusPanel.swift
//  TeslaSync — P4 feature view · 0037 · QueueStatusPanel (Apple)
//
//  The operator-facing Queue-status panel — the SwiftUI parity of
//  features/admin/components/QueueStatusPanel.tsx. Renders one card per known
//  background worker (notification, export, automation) with its heartbeat
//  severity, queue depth, 24h succeeded / failed counts, oldest-pending age, and
//  host · version, binding through `QueueStatusModel` (P1/S8) — no networking
//  lives in the view. The always-visible header (title + subtitle + "Updated …"
//  stamp + Refresh) sits above the state body, and every web render branch
//  (loading · error · empty · populated) is reproduced and lifted under the
//  standard P4 freshness / connectivity overlays (stale · offline).
//

import SwiftUI

/// The operator-facing Queue-status panel — the SwiftUI parity of
/// `features/admin/components/QueueStatusPanel.tsx`. Renders every state from the
/// web source, binding through `QueueStatusModel` (P1/S8). No networking lives
/// here; tapping a card hands the worker id to `onOpenWorker` (the per-worker
/// jobs drawer is a separate P4 surface).
public struct QueueStatusPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "QueueStatusPanel"

    @State private var model: QueueStatusModel
    private let onOpenWorker: (String) -> Void

    public init(
        model: QueueStatusModel,
        onOpenWorker: @escaping (String) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onOpenWorker = onOpenWorker
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                QSPanelHeader(
                    isFetching: model.isFetching,
                    isFirstLoad: model.phase == .loading,
                    isStale: model.isStale,
                    isOffline: model.isOffline,
                    generatedAt: model.generatedAt,
                    onRefresh: { model.refresh() }
                )
                stateBody
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var stateBody: some View {
        switch model.phase {
        case .loading:
            QSLoadingView()
        case let .error(message):
            QSErrorView(message: message) { model.refresh() }
        case .empty:
            QSEmptyView()
        case .data:
            QSContentView(workers: model.workers, onOpenWorker: onOpenWorker)
        }
    }
}
