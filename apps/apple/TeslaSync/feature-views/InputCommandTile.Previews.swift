//
//  InputCommandTile.Previews.swift
//  TeslaSync — P4 feature view · 0232 · InputCommandTile (Apple)
//
//  Xcode previews for each surface state (data / favorite / executing / success /
//  failure / empty / loading / error / stale / offline). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum InputCommandPreviewData {
        static let def = CommandTileDef(
            id: "set_speed_limit",
            command: "set_speed_limit",
            labelKey: "commands.security.speedLimit",
            labelFallback: "Speed Limit",
            sublabelKey: "commands.security.setMph",
            sublabelFallback: "Set MPH",
            systemImage: "speedometer",
            variant: .danger
        )
    }

    @MainActor
    private func previewModel(_ input: InputCommandTileInput) -> InputCommandTileModel {
        let source = InMemoryInputCommandSource(initial: input)
        let model = InputCommandTileModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewTile(_ input: InputCommandTileInput) -> some View {
        InputCommandTile(model: previewModel(input))
            .frame(width: 168)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        previewTile(InputCommandTileInput(def: InputCommandPreviewData.def))
    }

    #Preview("Favorite") {
        previewTile(InputCommandTileInput(def: InputCommandPreviewData.def, isFavorite: true))
    }

    #Preview("Executing") {
        previewTile(InputCommandTileInput(def: InputCommandPreviewData.def, isExecuting: true))
    }

    #Preview("Status · Success") {
        previewTile(InputCommandTileInput(def: InputCommandPreviewData.def, lastStatusRaw: "✓ 2m ago"))
    }

    #Preview("Status · Failure") {
        previewTile(InputCommandTileInput(def: InputCommandPreviewData.def, lastStatusRaw: "✗ just now"))
    }

    #Preview("Empty") {
        previewTile(InputCommandTileInput(def: nil))
    }

    #Preview("Loading") {
        previewTile(InputCommandTileInput(isLoading: true))
    }

    #Preview("Error") {
        previewTile(InputCommandTileInput(errorMessage: "Network request timed out"))
    }

    #Preview("Stale") {
        previewTile(InputCommandTileInput(def: InputCommandPreviewData.def, connection: .stale))
    }

    #Preview("Offline") {
        previewTile(InputCommandTileInput(
            def: InputCommandPreviewData.def,
            lastStatusRaw: "✓ 5m ago",
            connection: .offline
        ))
    }
#endif
