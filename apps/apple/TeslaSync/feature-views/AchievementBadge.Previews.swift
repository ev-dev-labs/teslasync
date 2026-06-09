//
//  AchievementBadge.Previews.swift
//  TeslaSync — P4 feature view · 0051 · AchievementBadge (Apple)
//
//  Xcode previews for each surface state (unlocked / near-complete / locked / empty /
//  loading / error / stale / offline) and each size variant. DEBUG-only; compiled by
//  the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AchievementBadgePreviewData {
        static let unlocked = AchievementBadgeData(
            id: "road-warrior",
            name: "Road Warrior",
            description: "Drive 10,000 miles",
            icon: "🏆",
            unlocked: true,
            unlockedAt: "2026-05-01T12:00:00Z",
            progress: 1,
            target: 10000,
            current: 10000
        )

        static let nearComplete = AchievementBadgeData(
            id: "night-owl",
            name: "Night Owl",
            description: "Charge 50 times overnight",
            icon: "🦉",
            unlocked: false,
            unlockedAt: nil,
            progress: 0.86,
            target: 50,
            current: 43
        )

        static let locked = AchievementBadgeData(
            id: "globetrotter",
            name: "Globetrotter",
            description: "Visit 25 unique destinations",
            icon: "🌍",
            unlocked: false,
            unlockedAt: nil,
            progress: 0.32,
            target: 25,
            current: 8
        )
    }

    @MainActor
    private func previewModel(_ input: AchievementBadgeInput) -> AchievementBadgeModel {
        let source = InMemoryAchievementBadgeSource(initial: input)
        let model = AchievementBadgeModel(source: source)
        model.start()
        return model
    }

    #Preview("Unlocked") {
        AchievementBadge(model: previewModel(AchievementBadgeInput(
            achievement: AchievementBadgePreviewData.unlocked
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Near complete") {
        AchievementBadge(model: previewModel(AchievementBadgeInput(
            achievement: AchievementBadgePreviewData.nearComplete
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Locked") {
        AchievementBadge(model: previewModel(AchievementBadgeInput(
            achievement: AchievementBadgePreviewData.locked
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Sizes") {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            AchievementBadge(model: previewModel(AchievementBadgeInput(
                achievement: AchievementBadgePreviewData.locked, size: .sm
            )))
            AchievementBadge(model: previewModel(AchievementBadgeInput(
                achievement: AchievementBadgePreviewData.locked, size: .md
            )))
            AchievementBadge(model: previewModel(AchievementBadgeInput(
                achievement: AchievementBadgePreviewData.unlocked, size: .lg
            )))
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AchievementBadge(model: previewModel(AchievementBadgeInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AchievementBadge(model: previewModel(AchievementBadgeInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AchievementBadge(model: previewModel(AchievementBadgeInput(
            errorMessage: "Network request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AchievementBadge(model: previewModel(AchievementBadgeInput(
            achievement: AchievementBadgePreviewData.nearComplete,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AchievementBadge(model: previewModel(AchievementBadgeInput(
            achievement: AchievementBadgePreviewData.unlocked,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
