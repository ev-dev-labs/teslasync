//
//  CommandTile.Previews.swift
//  TeslaSync — P4 feature view · 0226 · CommandTile (Apple)
//
//  Xcode previews for each surface state (idle / favorite / success-variant /
//  dangerous / executing / succeeded / failed / stale / offline) plus a grid. DEBUG-
//  only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

#if DEBUG
    import Foundation
    import SwiftUI

    private enum CommandTilePreviewData {
        static let lock = CommandTileDef(
            id: "lock",
            command: "lock",
            labelKey: "commands.security.lock",
            labelFallback: "Lock",
            systemImage: "lock.fill",
            variant: .default
        )

        static let wake = CommandTileDef(
            id: "wake_up",
            command: "wake_up",
            labelKey: "commands.security.wakeUp",
            labelFallback: "Wake Up",
            sublabelKey: "commands.security.wakeVehicle",
            sublabelFallback: "Wake vehicle",
            systemImage: "power",
            variant: .success
        )

        static let sentry = CommandTileDef(
            id: "sentry",
            command: "sentry_on",
            labelKey: "commands.security.sentry",
            labelFallback: "Sentry",
            systemImage: "shield.lefthalf.filled",
            variant: .danger,
            isDangerous: true
        )
    }

    /// A clock that returns a base time on its first read (the outcome `lastOutcomeAt`)
    /// and an advanced time afterwards, so the freshness-window preview renders stale.
    private final class CommandTilePreviewClock: @unchecked Sendable {
        private let base = Date()
        private let advance: TimeInterval
        private var reads = 0

        init(advance: TimeInterval) {
            self.advance = advance
        }

        func now() -> Date {
            defer { reads += 1 }
            return reads == 0 ? base : base.addingTimeInterval(advance)
        }
    }

    @MainActor
    private func previewModel(
        def: CommandTileDef = CommandTilePreviewData.lock,
        isFavorite: Bool = false,
        lastStatus: String? = nil,
        event: CommandExecutionEvent? = nil,
        autoEmits: Bool = true,
        then events: [CommandExecutionEvent] = [],
        activate: Bool = false,
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 120
    ) -> CommandTileModel {
        let dispatcher = InMemoryCommandDispatcher(event: event, autoEmits: autoEmits)
        let favorites = InMemoryFavoriteToggle(initial: isFavorite)
        let model = CommandTileModel(
            def: def,
            isFavorite: isFavorite,
            lastStatus: lastStatus,
            dispatcher: dispatcher,
            favorites: favorites,
            now: now,
            stalenessWindow: stalenessWindow
        )
        model.start()
        if activate { model.activate() }
        for event in events {
            dispatcher.push(event)
        }
        return model
    }

    @MainActor
    private func stalePreviewModel() -> CommandTileModel {
        let clock = CommandTilePreviewClock(advance: 600)
        return previewModel(lastStatus: "✓ Locked", now: { clock.now() }, stalenessWindow: 120)
    }

    private func framed(_ view: some View) -> some View {
        view
            .frame(width: 160)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle") {
        framed(CommandTile(model: previewModel()))
    }

    #Preview("Favorite") {
        framed(CommandTile(model: previewModel(isFavorite: true)))
    }

    #Preview("Success variant + sublabel") {
        framed(CommandTile(model: previewModel(def: CommandTilePreviewData.wake, isFavorite: true)))
    }

    #Preview("Dangerous") {
        framed(CommandTile(model: previewModel(def: CommandTilePreviewData.sentry)))
    }

    #Preview("Executing") {
        framed(CommandTile(model: previewModel(autoEmits: false, activate: true)))
    }

    #Preview("Succeeded") {
        framed(CommandTile(model: previewModel(lastStatus: "✓ Locked")))
    }

    #Preview("Failed") {
        framed(CommandTile(model: previewModel(lastStatus: "Command failed — vehicle asleep")))
    }

    #Preview("Stale") {
        framed(CommandTile(model: stalePreviewModel()))
    }

    #Preview("Offline (cached)") {
        framed(CommandTile(model: previewModel(
            lastStatus: "✓ Locked",
            autoEmits: false,
            then: [.offline(detail: "No connection")]
        )))
    }

    #Preview("Grid") {
        let columns = [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
        return LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            CommandTile(model: previewModel(isFavorite: true))
            CommandTile(model: previewModel(def: CommandTilePreviewData.wake))
            CommandTile(model: previewModel(def: CommandTilePreviewData.sentry))
            CommandTile(model: previewModel(lastStatus: "✓ Locked"))
        }
        .padding()
        .background(Color.TS.bg)
    }
#endif
