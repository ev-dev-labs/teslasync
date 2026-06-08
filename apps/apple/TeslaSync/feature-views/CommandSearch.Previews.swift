//
//  CommandSearch.Previews.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (content / idle / loading / empty /
//  error / stale / offline), so the vehicle-command search can be eyeballed in Xcode without the live
//  store.
//

#if DEBUG
    import SwiftUI

    private enum CommandSearchPreviewData {
        static let commands: [CommandDTO] = [
            CommandDTO(
                id: "flash_lights",
                command: "flash_lights",
                title: "Flash Lights",
                subtitle: "Flash the headlights once",
                category: "security",
                systemImage: "lightbulb.max"
            ),
            CommandDTO(
                id: "honk_horn",
                command: "honk_horn",
                title: "Honk Horn",
                category: "security",
                systemImage: "speaker.wave.2"
            ),
            CommandDTO(
                id: "climate_on",
                command: "auto_conditioning_start",
                title: "Start Climate",
                subtitle: "Precondition the cabin",
                category: "climate",
                systemImage: "fan"
            ),
            CommandDTO(
                id: "charge_start",
                command: "charge_start",
                title: "Start Charging",
                category: "charging",
                systemImage: "bolt.fill"
            ),
            CommandDTO(
                id: "door_lock",
                command: "door_lock",
                title: "Lock Doors",
                category: "doors",
                systemImage: "lock.fill"
            )
        ]

        @MainActor
        static func model(query: String, update: CommandSearchUpdate) -> CommandSearchModel {
            CommandSearchModel(
                source: InMemoryCommandSearchSource(initial: update),
                copy: .fallback,
                initialQuery: query
            )
        }

        static func loaded(
            _ rows: [CommandDTO] = commands,
            connection: CommandSearchConnection = .live
        ) -> CommandSearchUpdate {
            CommandSearchUpdate(status: .loaded, commands: rows, connection: connection, updatedAt: Date())
        }
    }

    private struct CommandSearchPreviewStage: View {
        let model: CommandSearchModel

        var body: some View {
            ScrollView {
                CommandSearch(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Content") {
        CommandSearchPreviewStage(
            model: CommandSearchPreviewData.model(
                query: "lock",
                update: CommandSearchPreviewData.loaded()
            )
        )
    }

    #Preview("Idle (type to search)") {
        CommandSearchPreviewStage(
            model: CommandSearchPreviewData.model(
                query: "",
                update: CommandSearchPreviewData.loaded()
            )
        )
    }

    #Preview("Loading") {
        CommandSearchPreviewStage(
            model: CommandSearchPreviewData.model(
                query: "",
                update: CommandSearchUpdate(status: .loading)
            )
        )
    }

    #Preview("Empty (no matches)") {
        CommandSearchPreviewStage(
            model: CommandSearchPreviewData.model(
                query: "teleport",
                update: CommandSearchPreviewData.loaded()
            )
        )
    }

    #Preview("Error") {
        CommandSearchPreviewStage(
            model: CommandSearchPreviewData.model(
                query: "",
                update: CommandSearchUpdate(status: .failed("Network unavailable"))
            )
        )
    }

    #Preview("Stale") {
        CommandSearchPreviewStage(
            model: CommandSearchPreviewData.model(
                query: "charge",
                update: CommandSearchPreviewData.loaded(
                    connection: .stale
                )
            )
        )
    }

    #Preview("Offline") {
        CommandSearchPreviewStage(
            model: CommandSearchPreviewData.model(
                query: "charge",
                update: CommandSearchPreviewData.loaded(connection: .offline)
            )
        )
    }
#endif
