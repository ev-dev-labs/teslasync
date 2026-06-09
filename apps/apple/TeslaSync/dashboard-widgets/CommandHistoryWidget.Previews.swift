//
//  CommandHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0029 · CommandHistoryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / stale /
//  content / wide / compact). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: CommandUpdate) -> CommandModel {
        let source = InMemoryCommandSource(initial: update)
        let model = CommandModel(source: source)
        model.start()
        return model
    }

    private func previewCommands(now: Date = Date()) -> [CommandInput] {
        [
            CommandInput(
                id: 1,
                vehicleID: 7,
                command: "lock_doors",
                status: "success",
                createdAt: now.addingTimeInterval(-45)
            ),
            CommandInput(
                id: 2,
                vehicleID: 7,
                command: "start_climate",
                status: "pending",
                createdAt: now.addingTimeInterval(-300)
            ),
            CommandInput(
                id: 3,
                vehicleID: 7,
                command: "flash_lights",
                status: "failed",
                createdAt: now.addingTimeInterval(-1800)
            ),
            CommandInput(
                id: 4,
                vehicleID: 7,
                command: "wake_up",
                status: "success",
                createdAt: now.addingTimeInterval(-5400)
            ),
            CommandInput(
                id: 5,
                vehicleID: 7,
                command: "honk_horn",
                status: "queued",
                createdAt: now.addingTimeInterval(-9000)
            )
        ]
    }

    #Preview("Content (2×4)") {
        CommandHistoryWidget(
            model: previewModel(
                CommandUpdate(
                    status: .loaded,
                    connection: .live,
                    commands: previewCommands(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        CommandHistoryWidget(
            model: previewModel(
                CommandUpdate(status: .loaded, connection: .live, commands: previewCommands(), updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        CommandHistoryWidget(
            model: previewModel(
                CommandUpdate(status: .loaded, connection: .live, commands: previewCommands(), updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 120)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        CommandHistoryWidget(model: previewModel(CommandUpdate(status: .loaded, commands: [])))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        CommandHistoryWidget(model: previewModel(CommandUpdate(status: .loading, commands: [])))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        CommandHistoryWidget(model: previewModel(CommandUpdate(status: .failed("Network unavailable"), commands: [])))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        CommandHistoryWidget(
            model: previewModel(
                CommandUpdate(
                    status: .loaded,
                    connection: .offline,
                    commands: previewCommands(),
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        CommandHistoryWidget(
            model: previewModel(
                CommandUpdate(
                    status: .loaded,
                    connection: .stale,
                    commands: previewCommands(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
