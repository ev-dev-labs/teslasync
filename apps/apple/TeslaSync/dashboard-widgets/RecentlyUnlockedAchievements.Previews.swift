//
//  RecentlyUnlockedAchievements.Previews.swift
//  TeslaSync — P4 dashboard widget · 0080 · RecentlyUnlockedAchievements (Apple)
//
//  Xcode previews for each surface state (loading / disabled / empty / error / offline / content)
//  and each layout (standard / wide). DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func recentlyUnlockedPreviewModel(_ update: RecentlyUnlockedUpdate) -> RecentlyUnlockedModel {
        let source = InMemoryRecentlyUnlockedSource(initial: update)
        let model = RecentlyUnlockedModel(source: source)
        model.start()
        return model
    }

    private let recentlyUnlockedSample: [AchievementUnlock] = [
        AchievementUnlock(
            id: "road-warrior",
            name: "Road Warrior",
            detail: "Drove 10,000 km",
            icon: "🏆",
            unlocked: true,
            unlockedAt: Date().addingTimeInterval(-3600)
        ),
        AchievementUnlock(
            id: "night-owl",
            name: "Night Owl",
            detail: "10 night drives",
            icon: "🦉",
            unlocked: true,
            unlockedAt: Date().addingTimeInterval(-86400)
        ),
        AchievementUnlock(
            id: "supercharged",
            name: "Supercharged",
            detail: "50 Supercharger sessions",
            icon: "⚡️",
            unlocked: true,
            unlockedAt: Date().addingTimeInterval(-172_800)
        ),
        AchievementUnlock(
            id: "eco-driver",
            name: "Eco Driver",
            detail: "Sub-150 Wh/km week",
            icon: "🌱",
            unlocked: true,
            unlockedAt: Date().addingTimeInterval(-259_200)
        ),
        AchievementUnlock(
            id: "globetrotter",
            name: "Globetrotter",
            detail: "Circled the Earth",
            icon: "🌍",
            unlocked: true,
            unlockedAt: Date().addingTimeInterval(-345_600)
        ),
        // Locked — excluded by the projector, present to prove filtering in previews.
        AchievementUnlock(
            id: "centurion",
            name: "Centurion",
            detail: "100 drives in a month",
            icon: "💯",
            unlocked: false,
            unlockedAt: nil
        )
    ]

    #Preview("Standard (2×2)") {
        RecentlyUnlockedAchievementsWidget(
            model: recentlyUnlockedPreviewModel(
                RecentlyUnlockedUpdate(
                    status: .loaded,
                    connection: .live,
                    achievements: recentlyUnlockedSample,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onSelect: { _ in }
        )
        .frame(width: 320, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×2)") {
        RecentlyUnlockedAchievementsWidget(
            model: recentlyUnlockedPreviewModel(
                RecentlyUnlockedUpdate(
                    status: .loaded,
                    connection: .live,
                    achievements: recentlyUnlockedSample,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onSelect: { _ in }
        )
        .frame(width: 600, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RecentlyUnlockedAchievementsWidget(
            model: recentlyUnlockedPreviewModel(RecentlyUnlockedUpdate(status: .loading)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (no unlocks)") {
        RecentlyUnlockedAchievementsWidget(
            model: recentlyUnlockedPreviewModel(
                RecentlyUnlockedUpdate(
                    status: .loaded,
                    achievements: [
                        AchievementUnlock(
                            id: "centurion",
                            name: "Centurion",
                            detail: "100 drives in a month",
                            icon: "💯",
                            unlocked: false,
                            unlockedAt: nil
                        )
                    ]
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Disabled (opt-out)") {
        RecentlyUnlockedAchievementsWidget(
            model: recentlyUnlockedPreviewModel(
                RecentlyUnlockedUpdate(
                    status: .loaded,
                    achievements: recentlyUnlockedSample,
                    showOnDashboard: false,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        RecentlyUnlockedAchievementsWidget(
            model: recentlyUnlockedPreviewModel(
                RecentlyUnlockedUpdate(status: .failed("Network unavailable"))
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        RecentlyUnlockedAchievementsWidget(
            model: recentlyUnlockedPreviewModel(
                RecentlyUnlockedUpdate(
                    status: .loaded,
                    connection: .offline,
                    achievements: recentlyUnlockedSample,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onSelect: { _ in }
        )
        .frame(width: 600, height: 260)
        .padding()
        .background(Color.TS.bg)
    }
#endif
