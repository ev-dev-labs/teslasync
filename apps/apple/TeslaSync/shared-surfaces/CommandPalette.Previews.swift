//
//  CommandPalette.Previews.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  Xcode previews for every branch of the command palette: the empty-query landing (Most Used + Recent +
//  Pages + Vehicle Commands), the live search results, an active scope chip, the vehicle-select step, the
//  no-results empty message, the loading skeleton, the error tile, and the stale / offline freshness chips.
//  Rendered through the card directly (bypassing the open gate) so each state is inspectable in isolation.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum CommandPalettePreviewData {
        static let vehicles: [PaletteVehicle] = [
            PaletteVehicle(
                id: 1,
                displayName: "Lightning",
                vin: "5YJ3E1EA7KF000001",
                model: "Model 3",
                state: "online"
            ),
            PaletteVehicle(
                id: 2,
                displayName: "Garage Loaner",
                vin: "5YJSA1E26HF000002",
                model: "Model S",
                state: "asleep"
            ),
            PaletteVehicle(id: 3, displayName: nil, vin: "5YJYGDEE0LF000003", model: "Model Y", state: "online")
        ]

        static let nav: [PaletteNavEntry] = [
            PaletteNavEntry(
                path: "/",
                label: "Dashboard",
                sectionTitle: "Overview",
                keywords: ["home", "summary"],
                iconName: "gauge.with.dots.needle.bottom.50percent"
            ),
            PaletteNavEntry(
                path: "/drives",
                label: "Drives",
                sectionTitle: "Fleet",
                keywords: ["trips", "routes", "miles"],
                iconName: "road.lanes"
            ),
            PaletteNavEntry(
                path: "/charging",
                label: "Charging",
                sectionTitle: "Fleet",
                keywords: ["energy", "kwh"],
                iconName: "bolt.fill"
            ),
            PaletteNavEntry(
                path: "/battery",
                label: "Battery Health",
                sectionTitle: "Analytics",
                keywords: ["degradation", "soc"],
                iconName: "battery.100"
            ),
            PaletteNavEntry(
                path: "/me/activity",
                label: "My Activity",
                sectionTitle: "Account",
                keywords: ["audit"],
                iconName: "person.fill",
                requiresAuth: true
            )
        ]

        static let registry: [PaletteRegistryEntry] = [
            PaletteRegistryEntry(
                id: "toggle-theme",
                label: "Toggle Theme",
                section: .preferences,
                keywords: ["dark", "light", "appearance"],
                shortcut: "g t",
                iconName: "circle.lefthalf.filled"
            ),
            PaletteRegistryEntry(
                id: "refresh-data",
                label: "Refresh Data",
                section: .actions,
                keywords: ["reload", "sync"],
                iconName: "arrow.clockwise"
            )
        ]

        static let recent: [PaletteRecentPage] = [
            PaletteRecentPage(
                path: "/drives/482",
                title: "Morning Commute",
                kind: .drive,
                visitedAt: Date().addingTimeInterval(-90)
            ),
            PaletteRecentPage(
                path: "/charging/120",
                title: "Supercharger Stop",
                kind: .charging,
                visitedAt: Date().addingTimeInterval(-3 * 3600)
            )
        ]

        static let scores: [String: Double] = ["/drives": 9, "cmd-lock": 6, "toggle-theme": 3]

        static let hits: [PaletteSearchHit] = [
            PaletteSearchHit(
                type: .drive,
                id: 482,
                title: "Morning Commute",
                subtitle: "18.2 mi · 32 min",
                url: "/drives/482"
            ),
            PaletteSearchHit(type: .vehicle, id: 1, title: "Lightning", subtitle: "Model 3", url: "/vehicles/1")
        ]

        static func snapshot(
            searchHits: [PaletteSearchHit] = [],
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: PaletteConnection = .live
        ) -> CommandPaletteSnapshot {
            CommandPaletteSnapshot(
                vehicles: vehicles,
                selectedVehicleID: 1,
                isForwardAuth: true,
                navEntries: nav,
                registryEntries: registry,
                recentPages: recent,
                commandScores: scores,
                searchHits: searchHits,
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection
            )
        }

        @MainActor
        static func model(
            snapshot: CommandPaletteSnapshot,
            query: String? = nil,
            command: String? = nil
        ) -> CommandPaletteModel {
            let source = InMemoryCommandPaletteSource(snapshot: snapshot, searchProvider: { _ in hits })
            let model = CommandPaletteModel(source: source, runner: InMemoryCommandPaletteRunner())
            if let command { model.activate(commandRow(command)) }
            if let query { model.setRawQuery(query) }
            return model
        }

        static func commandRow(_ command: String) -> PaletteItem {
            PaletteItem(
                id: "cmd-\(command)",
                label: command,
                section: "",
                iconName: "bolt.fill",
                kind: .command,
                action: .selectCommand(command: command)
            )
        }
    }

    /// A host that renders the card directly (bypassing the open gate) and owns the keyboard focus state.
    private struct CommandPalettePreviewHost: View {
        @FocusState private var focus: CommandPaletteField?
        let label: String
        let model: CommandPaletteModel

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                CommandPaletteCard(model: model, focus: $focus)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 560, alignment: .leading)
            .background(Color.TS.bg)
            .onAppear { model.start() }
        }
    }

    #Preview("Empty-query landing") {
        CommandPalettePreviewHost(
            label: "Most Used · Recent · Pages · Vehicle Commands",
            model: CommandPalettePreviewData.model(snapshot: CommandPalettePreviewData.snapshot())
        )
    }

    #Preview("Live search results") {
        CommandPalettePreviewHost(
            label: "query \"model\" → server hits + scored items",
            model: CommandPalettePreviewData.model(
                snapshot: CommandPalettePreviewData.snapshot(searchHits: CommandPalettePreviewData.hits),
                query: "model"
            )
        )
    }

    #Preview("Scope · commands") {
        CommandPalettePreviewHost(
            label: "\"> \" → command scope chip",
            model: CommandPalettePreviewData.model(snapshot: CommandPalettePreviewData.snapshot(), query: "> ")
        )
    }

    #Preview("Vehicle-select") {
        CommandPalettePreviewHost(
            label: "multi-vehicle \"lock\" → pick a vehicle",
            model: CommandPalettePreviewData.model(snapshot: CommandPalettePreviewData.snapshot(), command: "lock")
        )
    }

    #Preview("Empty · no results") {
        CommandPalettePreviewHost(
            label: "query \"zzz\" → friendly empty message",
            model: CommandPalettePreviewData.model(snapshot: CommandPalettePreviewData.snapshot(), query: "zzz")
        )
    }

    #Preview("Loading / error") {
        VStack(spacing: TSSpacing.lg) {
            CommandPalettePreviewHost(
                label: "loading skeleton",
                model: CommandPalettePreviewData.model(snapshot: CommandPaletteSnapshot(isLoading: true))
            )
            CommandPalettePreviewHost(
                label: "error tile + retry",
                model: CommandPalettePreviewData.model(
                    snapshot: CommandPaletteSnapshot(errorMessage: "Network unavailable")
                )
            )
        }
    }

    #Preview("Freshness · stale / offline") {
        VStack(spacing: TSSpacing.lg) {
            CommandPalettePreviewHost(
                label: "stale chip",
                model: CommandPalettePreviewData.model(
                    snapshot: CommandPalettePreviewData.snapshot(connection: .stale)
                )
            )
            CommandPalettePreviewHost(
                label: "offline chip",
                model: CommandPalettePreviewData.model(
                    snapshot: CommandPalettePreviewData.snapshot(connection: .offline)
                )
            )
        }
    }
#endif
