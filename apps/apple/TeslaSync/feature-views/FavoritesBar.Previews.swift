//
//  FavoritesBar.Previews.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  Xcode previews — one per state the surface produces: content (favorites resolved),
//  empty (no favorites pinned), loading (initial skeleton), error (fetch failed → retry),
//  and the stale / offline freshness variants, plus a custom-tile variant proving the
//  `renderTile` seam. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentFavoritesTelemetry: FavoritesTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op action sink so previews don't log tile intents.
    private struct SilentFavoritesActionSink: FavoritesActionSink {
        func execute(_: FavoriteCommand) {}
        func toggleFavorite(_: FavoriteCommand) {}
    }

    /// Sample commands + favorites spanning the default / danger / success variants and a
    /// command with a sublabel, so the tiles exercise every render branch.
    private enum FavoritesPreviewData {
        static func commands() -> [FavoriteCommand] {
            [
                FavoriteCommand(
                    id: "wake",
                    command: "wake_up",
                    labelKey: "commands.wake.label",
                    labelFallback: "Wake",
                    systemImage: "sun.max.fill",
                    category: "vehicle",
                    variant: .success
                ),
                FavoriteCommand(
                    id: "lock",
                    command: "door_lock",
                    labelKey: "commands.lock.label",
                    labelFallback: "Lock",
                    sublabelKey: "commands.lock.sub",
                    sublabelFallback: "Doors",
                    systemImage: "lock.fill",
                    category: "security"
                ),
                FavoriteCommand(
                    id: "climate",
                    command: "auto_conditioning_start",
                    labelKey: "commands.climate.label",
                    labelFallback: "Climate",
                    systemImage: "fan.fill",
                    category: "climate"
                ),
                FavoriteCommand(
                    id: "honk",
                    command: "honk_horn",
                    labelKey: "commands.honk.label",
                    labelFallback: "Honk",
                    systemImage: "speaker.wave.2.fill",
                    category: "vehicle",
                    variant: .danger,
                    dangerous: true
                )
            ]
        }

        static func favorites() -> [String] {
            ["wake", "lock", "climate", "honk"]
        }

        static func update(
            status: FavoritesLoadStatus = .loaded,
            connection: FavoritesConnection = .live,
            empty: Bool = false
        ) -> FavoritesBarUpdate {
            FavoritesBarUpdate(
                status: status,
                favorites: empty ? [] : favorites(),
                commands: empty ? [] : commands(),
                connection: connection
            )
        }
    }

    @MainActor
    private func favoritesPreview(_ update: FavoritesBarUpdate) -> FavoritesBar<FavoriteCommandTile> {
        let model = FavoritesBarModel(
            source: InMemoryFavoritesSource(initial: update),
            telemetry: SilentFavoritesTelemetry(),
            actionSink: SilentFavoritesActionSink()
        )
        return FavoritesBar(model: model)
    }

    #Preview("Content") {
        ScrollView { favoritesPreview(FavoritesPreviewData.update()).padding() }
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        favoritesPreview(FavoritesPreviewData.update(empty: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        favoritesPreview(FavoritesPreviewData.update(status: .loading, empty: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        favoritesPreview(FavoritesPreviewData.update(status: .failed("Request timed out"), empty: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView { favoritesPreview(FavoritesPreviewData.update(connection: .stale)).padding() }
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView { favoritesPreview(FavoritesPreviewData.update(connection: .offline)).padding() }
            .background(Color.TS.bg)
    }

    #Preview("Custom tile (renderTile seam)") {
        let update = FavoritesPreviewData.update()
        let model = FavoritesBarModel(
            source: InMemoryFavoritesSource(initial: update),
            telemetry: SilentFavoritesTelemetry(),
            actionSink: SilentFavoritesActionSink()
        )
        return ScrollView {
            FavoritesBar(model: model) { command in
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: command.systemImage)
                    Text(verbatim: command.labelFallback)
                }
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
            }
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
