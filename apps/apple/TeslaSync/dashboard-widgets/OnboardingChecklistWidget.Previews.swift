//
//  OnboardingChecklistWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0071 · OnboardingChecklistWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / hidden /
//  offline / content / all-complete). DEBUG-only; excluded from the swiftc host
//  gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ChecklistUpdate) -> OnboardingChecklistModel {
        let source = InMemoryOnboardingChecklistSource(initial: update)
        let model = OnboardingChecklistModel(source: source)
        model.start()
        return model
    }

    /// Two of seven steps done — the common in-progress surface.
    private let inProgressInputs = ChecklistInputs(
        vehicleCount: 1,
        alertRuleCount: 0,
        channelCount: 0,
        themeID: "neon-cyan",
        commandPaletteDiscovered: true,
        pushGranted: false,
        customizeDashboardCompleted: false
    )

    private let allDoneInputs = ChecklistInputs(
        vehicleCount: 2,
        alertRuleCount: 3,
        channelCount: 1,
        themeID: "sunset",
        commandPaletteDiscovered: true,
        pushGranted: true,
        customizeDashboardCompleted: true,
        completedAt: Date()
    )

    #Preview("Content") {
        OnboardingChecklistWidget(
            model: previewModel(ChecklistUpdate(status: .loaded, connection: .live, inputs: inProgressInputs)),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onNavigate: { _ in },
            onCommandPalette: {}
        )
        .frame(width: 300, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("All complete") {
        OnboardingChecklistWidget(
            model: previewModel(ChecklistUpdate(status: .loaded, connection: .live, inputs: allDoneInputs))
        )
        .frame(width: 300, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        OnboardingChecklistWidget(model: previewModel(ChecklistUpdate(status: .loading, inputs: nil)))
            .frame(width: 300, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        OnboardingChecklistWidget(model: previewModel(ChecklistUpdate(status: .empty, inputs: inProgressInputs)))
            .frame(width: 300, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        OnboardingChecklistWidget(
            model: previewModel(ChecklistUpdate(status: .failed("Network unavailable"), inputs: nil))
        )
        .frame(width: 300, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Hidden (dismissed)") {
        OnboardingChecklistWidget(
            model: previewModel(
                ChecklistUpdate(
                    status: .loaded,
                    connection: .live,
                    inputs: ChecklistInputs(vehicleCount: 1, themeID: "neon-cyan", dismissed: true)
                )
            )
        )
        .frame(width: 300, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        OnboardingChecklistWidget(
            model: previewModel(
                ChecklistUpdate(
                    status: .loaded,
                    connection: .offline,
                    inputs: inProgressInputs,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 300, height: 420)
        .padding()
        .background(Color.TS.bg)
    }
#endif
