//
//  AchievementUnlockedToast.Previews.swift
//  TeslaSync — P4 shared surface · 0111 · AchievementUnlockedToast (Apple)
//
//  Xcode previews for each surface state (single / multiple unlocks, empty, loading, error, stale,
//  offline) plus the lone celebration toast. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AchievementUnlockedPreviewData {
        static func achievement(
            _ id: String,
            _ name: String,
            _ detail: String,
            _ icon: String
        ) -> AchievementUnlockedAchievement {
            AchievementUnlockedAchievement(id: id, name: name, detail: detail, icon: icon)
        }

        static func event(
            _ id: String,
            _ name: String,
            _ detail: String,
            _ icon: String
        ) -> AchievementUnlockedEventData {
            AchievementUnlockedEventData(
                achievement: achievement(id, name, detail, icon),
                vehicleID: 1,
                unlockedAt: Date()
            )
        }

        static let roadWarrior = event(
            "road-warrior",
            "Road Warrior",
            "Drove more than 10,000 km in a single year.",
            "🏆"
        )

        static let nightOwl = event(
            "night-owl",
            "Night Owl",
            "Completed 25 drives after midnight.",
            "🦉"
        )

        static let efficiencyAce = event(
            "efficiency-ace",
            "Efficiency Ace",
            "Averaged under 150 Wh/km across a full week of driving.",
            "⚡️"
        )
    }

    @MainActor
    private func previewModel(_ update: AchievementUnlockedUpdate) -> AchievementUnlockedToastModel {
        let source = InMemoryAchievementUnlockedSource(initial: update)
        let model = AchievementUnlockedToastModel(source: source, onView: { _ in })
        model.start()
        return model
    }

    #Preview("Data — single unlock") {
        AchievementUnlockedToastStack(
            model: previewModel(AchievementUnlockedUpdate(
                status: .loaded,
                events: [AchievementUnlockedPreviewData.roadWarrior]
            )),
            lifetimeSeconds: 0
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — stacked unlocks") {
        AchievementUnlockedToastStack(
            model: previewModel(AchievementUnlockedUpdate(
                status: .loaded,
                events: [
                    AchievementUnlockedPreviewData.efficiencyAce,
                    AchievementUnlockedPreviewData.nightOwl,
                    AchievementUnlockedPreviewData.roadWarrior
                ]
            )),
            lifetimeSeconds: 0
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AchievementUnlockedToastStack(model: previewModel(AchievementUnlockedUpdate(status: .empty)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AchievementUnlockedToastStack(model: previewModel(AchievementUnlockedUpdate(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AchievementUnlockedToastStack(model: previewModel(AchievementUnlockedUpdate(
            status: .failed("The achievement stream disconnected")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AchievementUnlockedToastStack(
            model: previewModel(AchievementUnlockedUpdate(
                status: .loaded,
                connection: .stale,
                events: [AchievementUnlockedPreviewData.roadWarrior]
            )),
            lifetimeSeconds: 0
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AchievementUnlockedToastStack(
            model: previewModel(AchievementUnlockedUpdate(
                status: .loaded,
                connection: .offline,
                events: [AchievementUnlockedPreviewData.nightOwl]
            )),
            lifetimeSeconds: 0
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Single toast") {
        AchievementUnlockedToast(
            event: AchievementUnlockedPreviewData.efficiencyAce,
            lifetimeSeconds: 0,
            onView: {},
            onDismiss: {}
        )
        .padding()
        .background(Color.TS.bg)
    }
#endif
