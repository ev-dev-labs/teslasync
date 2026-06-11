//
//  AchievementUnlockListener.Previews.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  Xcode previews for each surface state (loading / unavailable / empty-no-unlocks / celebrations-off
//  / one unlock / several unlocks / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope. Previews use the silent chime + manual ticker so no
//  audio plays and no real timer fires while authoring.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AchievementUnlockListenerPreviewData {
        static let roadWarrior = AchievementUnlockListenerAchievement(
            id: "road-warrior",
            name: "Road Warrior",
            detail: "Drove more than 1,000 km in a single week.",
            icon: "🏎️"
        )
        static let nightOwl = AchievementUnlockListenerAchievement(
            id: "night-owl",
            name: "Night Owl",
            detail: "Completed a drive between midnight and 4 AM.",
            icon: "🦉"
        )
        static let superCharged = AchievementUnlockListenerAchievement(
            id: "supercharged",
            name: "Supercharged",
            detail: "Added 200 km of range in under 15 minutes.",
            icon: "⚡️"
        )

        static func event(_ achievement: AchievementUnlockListenerAchievement) -> AchievementUnlockListenerEvent {
            AchievementUnlockListenerEvent(vehicleID: 1, unlockedAt: Date(), achievement: achievement)
        }

        static let single = [event(roadWarrior)]
        static let several = [event(superCharged), event(nightOwl), event(roadWarrior)]
    }

    @MainActor
    private func previewModel(_ input: AchievementUnlockListenerInput) -> AchievementUnlockListenerModel {
        let source = InMemoryAchievementUnlockListenerSource(initial: input)
        let model = AchievementUnlockListenerModel(
            source: source,
            chime: SilentAchievementUnlockListenerChime(),
            telemetry: OSLogAchievementUnlockListenerTelemetry()
        )
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: AchievementUnlockListenerModel) -> some View {
        AchievementUnlockListener(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(AchievementUnlockListenerInput(status: .loading)))
    }

    #Preview("Unavailable") {
        staged(previewModel(AchievementUnlockListenerInput(status: .failed)))
    }

    #Preview("Empty — no unlocks") {
        staged(previewModel(AchievementUnlockListenerInput(status: .resolved)))
    }

    #Preview("Celebrations off") {
        staged(previewModel(AchievementUnlockListenerInput(
            status: .resolved,
            events: AchievementUnlockListenerPreviewData.single,
            prefs: AchievementUnlockListenerPrefs(showToasts: false, playSound: false)
        )))
    }

    #Preview("One unlock") {
        staged(previewModel(AchievementUnlockListenerInput(
            status: .resolved,
            events: AchievementUnlockListenerPreviewData.single
        )))
    }

    #Preview("Several unlocks") {
        staged(previewModel(AchievementUnlockListenerInput(
            status: .resolved,
            events: AchievementUnlockListenerPreviewData.several
        )))
    }

    #Preview("Stale") {
        staged(previewModel(AchievementUnlockListenerInput(
            status: .resolved,
            events: AchievementUnlockListenerPreviewData.single,
            connection: .stale
        )))
    }

    #Preview("Offline (cached)") {
        staged(previewModel(AchievementUnlockListenerInput(
            status: .resolved,
            events: AchievementUnlockListenerPreviewData.several,
            connection: .offline
        )))
    }
#endif
