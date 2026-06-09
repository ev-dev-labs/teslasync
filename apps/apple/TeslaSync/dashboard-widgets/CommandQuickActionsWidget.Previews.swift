//
//  CommandQuickActionsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0030 · CommandQuickActionsWidget (Apple)
//
//  Xcode previews for each surface state (content wide / content standard / running /
//  loading / empty / error / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ update: CommandQuickActionsUpdate,
        result: CommandDispatchResult = CommandDispatchResult(success: true, message: "")
    ) -> CommandQuickActionsModel {
        let source = InMemoryCommandQuickActionsSource(initial: update, result: result)
        let model = CommandQuickActionsModel(source: source)
        model.start()
        return model
    }

    private let vehicleUpdate = CommandQuickActionsUpdate(
        status: .loaded,
        connection: .live,
        isFetching: false,
        vehicleID: 42,
        updatedAt: Date()
    )

    #Preview("Content (4×3 wide)") {
        CommandQuickActionsWidget(
            model: previewModel(vehicleUpdate),
            size: DashboardWidgetSize(cols: 4, rows: 3)
        )
        .frame(width: 520, height: 230)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (2×2 standard)") {
        CommandQuickActionsWidget(
            model: previewModel(vehicleUpdate),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        CommandQuickActionsWidget(
            model: previewModel(CommandQuickActionsUpdate(status: .loading, vehicleID: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — no vehicle") {
        CommandQuickActionsWidget(
            model: previewModel(CommandQuickActionsUpdate(status: .loaded, vehicleID: 0)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        CommandQuickActionsWidget(
            model: previewModel(CommandQuickActionsUpdate(status: .failed("Network unavailable"), vehicleID: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached vehicle)") {
        CommandQuickActionsWidget(
            model: previewModel(CommandQuickActionsUpdate(
                status: .loaded,
                connection: .offline,
                vehicleID: 42,
                updatedAt: Date().addingTimeInterval(-360)
            )),
            size: DashboardWidgetSize(cols: 4, rows: 3)
        )
        .frame(width: 520, height: 260)
        .padding()
        .background(Color.TS.bg)
    }
#endif
