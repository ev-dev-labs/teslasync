//
//  AnnotationList.swift
//  TeslaSync — P4 shared surface · 0063 · AnnotationList (Apple)
//
//  The chart-annotation list — the SwiftUI parity of `components/charts/AnnotationList.tsx`. The web
//  component takes the parent's already-fetched `annotations` + an `onRemove` callback (its only hook
//  is `useTranslation`) and renders `null` when the list is empty. This native surface reproduces
//  that composition — the uppercase title, the per-category rows, the remove affordance, and the
//  empty collapse — binding through `AnnotationListModel` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading   — annotations resolving (web parent fetch) → skeleton chrome.
//    • error     — fetch failed → a `QueryError` peer with retry.
//    • empty     — resolved + no rows, `.emptyState` policy → friendly empty state (P4 default).
//    • withdrawn — resolved + no rows, `.withdraw` policy → nothing (faithful web `null`).
//    • populated — the title + rows, decorated by the P4 freshness axis (stale / offline).
//

import SwiftUI

// MARK: - AnnotationList (the shared surface)

/// The chart-annotation list — the SwiftUI parity of `components/charts/AnnotationList.tsx`. Renders
/// every state plus the P4 leaf freshness axis, binding through `AnnotationListModel`.
public struct AnnotationList: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AnnotationListMeta.surfaceSlug

    @State private var model: AnnotationListModel

    public init(model: AnnotationListModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production annotations-backed source — the parity of
    /// mounting `<AnnotationList annotations={…} onRemove={…} />` under a chart. `input` is the host's
    /// current annotation snapshot (web parent fetch) plus the connectivity axis + empty policy;
    /// `onRemove` is the web `onRemove` prop.
    public init(input: AnnotationListInput, onRemove: @escaping @MainActor (String) -> Void) {
        _model = State(initialValue: AnnotationListModel(
            source: LiveAnnotationListSource(input: input),
            onRemove: onRemove
        ))
    }

    public var body: some View {
        ZStack {
            if case .withdrawn = model.resolved.phase {
                // Faithful `if (annotations.length === 0) return null` parity: under the `.withdraw`
                // policy an empty list collapses to nothing (for chart-embedded use).
                EmptyView()
            } else {
                content
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            AnnotationListLoadingView()
        case let .error(errorContent):
            AnnotationListErrorView(content: errorContent) { model.refresh() }
        case let .empty(empty):
            AnnotationListEmptyView(content: empty)
        case .withdrawn:
            EmptyView()
        case let .populated(rows):
            AnnotationListPopulatedView(
                title: model.resolved.title,
                freshness: model.resolved.freshness,
                rows: rows,
                onRefresh: { model.refresh() },
                onRemove: { model.remove(id: $0) }
            )
        }
    }
}
