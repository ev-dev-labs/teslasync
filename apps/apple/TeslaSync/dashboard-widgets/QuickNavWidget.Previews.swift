//
//  QuickNavWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0075 · QuickNavWidget (Apple)
//
//  Xcode previews for each surface state (content 4×2 / content 2×2 / loading /
//  empty / error). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: QuickNavUpdate) -> QuickNavModel {
        let source = InMemoryQuickNavSource(initial: update)
        let model = QuickNavModel(source: source)
        model.start()
        return model
    }

    private let loadedUpdate = QuickNavUpdate(
        status: .loaded,
        destinations: QuickNavCatalog.all,
        updatedAt: Date()
    )

    #Preview("Content (4×2)") {
        QuickNavWidget(
            model: previewModel(loadedUpdate),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onNavigate: { _ in }
        )
        .frame(width: 520, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (2×2)") {
        QuickNavWidget(
            model: previewModel(loadedUpdate),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onNavigate: { _ in }
        )
        .frame(width: 300, height: 230)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        QuickNavWidget(model: previewModel(QuickNavUpdate(status: .loading, destinations: [])))
            .frame(width: 520, height: 150)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        QuickNavWidget(model: previewModel(QuickNavUpdate(status: .loaded, destinations: [])))
            .frame(width: 520, height: 150)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        QuickNavWidget(model: previewModel(QuickNavUpdate(status: .failed("Network unavailable"), destinations: [])))
            .frame(width: 520, height: 200)
            .padding()
            .background(Color.TS.bg)
    }
#endif
