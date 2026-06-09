//
//  ToggleCommandTile.Previews.swift
//  TeslaSync — P4 feature view · 0260 · ToggleCommandTile (Apple)
//
//  Xcode previews for each surface state (off / on / success-on / danger-on / local
//  optimistic / input-gated / executing / succeeded / failed / stale / offline) plus a
//  grid. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

#if DEBUG
    import Foundation
    import SwiftUI

    private enum ToggleCommandTilePreviewData {
        static let lock = ToggleCommandTileDef(
            id: "lock",
            command: "lock",
            commandOff: "unlock",
            labelKey: "commands.security.lock",
            labelFallback: "Lock",
            systemImageOn: "lock.fill",
            systemImageOff: "lock.open.fill",
            variant: .default,
            stateField: "is_locked"
        )

        static let charge = ToggleCommandTileDef(
            id: "charge",
            command: "charge_start",
            commandOff: "charge_stop",
            labelKey: "commands.charging.charge",
            labelFallback: "Charge",
            systemImageOn: "bolt.fill",
            variant: .success,
            stateField: "is_charging"
        )

        static let sentry = ToggleCommandTileDef(
            id: "sentry",
            command: "sentry_on",
            commandOff: "sentry_off",
            labelKey: "commands.security.sentry",
            labelFallback: "Sentry",
            systemImageOn: "shield.lefthalf.filled",
            variant: .danger,
            stateField: "sentry_mode"
        )

        static let valet = ToggleCommandTileDef(
            id: "valet_mode",
            command: "set_valet_mode",
            commandOff: "valet_off",
            labelKey: "commands.security.valet",
            labelFallback: "Valet",
            systemImageOn: "person.crop.circle.badge.checkmark",
            systemImageOff: "person.crop.circle.badge.xmark",
            variant: .danger
        )

        static let speedLimit = ToggleCommandTileDef(
            id: "speed_limit",
            command: "speed_limit_activate",
            commandOff: "speed_limit_deactivate",
            labelKey: "commands.drive.speedLimit",
            labelFallback: "Speed Limit",
            systemImageOn: "gauge.with.dots.needle.50percent",
            variant: .default,
            requiresInput: true
        )
    }

    /// A clock that returns a base time on its first read (the outcome `lastOutcomeAt`)
    /// and an advanced time afterwards, so the freshness-window preview renders stale.
    private final class ToggleCommandTilePreviewClock: @unchecked Sendable {
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
        def: ToggleCommandTileDef = ToggleCommandTilePreviewData.lock,
        isFavorite: Bool = false,
        lastStatus: String? = nil,
        liveState: Bool? = nil,
        event: ToggleCommandEvent? = nil,
        autoEmits: Bool = true,
        then events: [ToggleCommandEvent] = [],
        activate: Bool = false,
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 120
    ) -> ToggleCommandTileModel {
        let dispatcher = InMemoryToggleCommandDispatcher(event: event, autoEmits: autoEmits)
        let stateSource = InMemoryToggleStateSource(initial: liveState)
        let favorites = InMemoryToggleFavoriteToggle(initial: isFavorite)
        let model = ToggleCommandTileModel(
            def: def,
            isFavorite: isFavorite,
            lastStatus: lastStatus,
            dispatcher: dispatcher,
            stateSource: stateSource,
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
    private func stalePreviewModel() -> ToggleCommandTileModel {
        let clock = ToggleCommandTilePreviewClock(advance: 600)
        return previewModel(lastStatus: "✓ Locked", now: { clock.now() }, stalenessWindow: 120)
    }

    private func framed(_ view: some View) -> some View {
        view
            .frame(width: 160)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Off") {
        framed(ToggleCommandTile(model: previewModel(liveState: false)))
    }

    #Preview("On (bound state)") {
        framed(ToggleCommandTile(model: previewModel(isFavorite: true, liveState: true)))
    }

    #Preview("On — success variant") {
        framed(ToggleCommandTile(model: previewModel(def: ToggleCommandTilePreviewData.charge, liveState: true)))
    }

    #Preview("On — danger variant") {
        framed(ToggleCommandTile(model: previewModel(def: ToggleCommandTilePreviewData.sentry, liveState: true)))
    }

    #Preview("Local optimistic (unbound)") {
        framed(ToggleCommandTile(model: previewModel(def: ToggleCommandTilePreviewData.valet)))
    }

    #Preview("Input-gated turn-on") {
        framed(ToggleCommandTile(model: previewModel(def: ToggleCommandTilePreviewData.speedLimit)))
    }

    #Preview("Executing") {
        framed(ToggleCommandTile(model: previewModel(autoEmits: false, activate: true)))
    }

    #Preview("Succeeded") {
        framed(ToggleCommandTile(model: previewModel(lastStatus: "✓ Locked", liveState: true)))
    }

    #Preview("Failed") {
        framed(ToggleCommandTile(model: previewModel(lastStatus: "Command failed — vehicle asleep")))
    }

    #Preview("Stale") {
        framed(ToggleCommandTile(model: stalePreviewModel()))
    }

    #Preview("Offline (cached)") {
        framed(ToggleCommandTile(model: previewModel(
            lastStatus: "✓ Locked",
            liveState: true,
            autoEmits: false,
            then: [.offline(detail: "No connection")]
        )))
    }

    #Preview("Grid") {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: TSSpacing.md),
                GridItem(.flexible(), spacing: TSSpacing.md)
            ],
            spacing: TSSpacing.md
        ) {
            ToggleCommandTile(model: previewModel(isFavorite: true, liveState: true))
            ToggleCommandTile(model: previewModel(def: ToggleCommandTilePreviewData.charge, liveState: true))
            ToggleCommandTile(model: previewModel(def: ToggleCommandTilePreviewData.sentry))
            ToggleCommandTile(model: previewModel(def: ToggleCommandTilePreviewData.valet))
            ToggleCommandTile(model: previewModel(def: ToggleCommandTilePreviewData.speedLimit))
            ToggleCommandTile(model: previewModel(lastStatus: "✓ Locked", liveState: true))
        }
        .padding()
        .background(Color.TS.bg)
    }
#endif
