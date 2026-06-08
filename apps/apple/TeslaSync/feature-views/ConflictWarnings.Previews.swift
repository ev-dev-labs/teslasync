//
//  ConflictWarnings.Previews.swift
//  TeslaSync — P4 feature view · 0084 · ConflictWarnings (Apple)
//
//  Xcode previews for each render branch + the P4 states (loading / empty /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: ConflictWarningsInput) -> ConflictWarningsModel {
        let source = InMemoryConflictWarningsSource(initial: input)
        let model = ConflictWarningsModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewSurface(_ input: ConflictWarningsInput) -> some View {
        ScrollView {
            ConflictWarnings(model: previewModel(input))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private let previewConflicts: [AutomationConflict] = [
        AutomationConflict(
            automationId: 12,
            automationName: "Morning Charge",
            reason: "Overlaps with Nightly Precondition on Mon–Fri 06:00",
            severity: .warning
        ),
        AutomationConflict(
            automationId: 34,
            automationName: "Arrive Home Climate",
            reason: "Shares the geofence trigger with Garage Lights",
            severity: .info
        )
    ]

    #Preview("Conflicts (warning + info)") {
        previewSurface(ConflictWarningsInput(phase: .loaded(previewConflicts)))
    }

    #Preview("Single warning") {
        previewSurface(ConflictWarningsInput(phase: .loaded([previewConflicts[0]])))
    }

    #Preview("Empty (no conflicts)") {
        previewSurface(ConflictWarningsInput(phase: .loaded([])))
    }

    #Preview("Loading") {
        previewSurface(ConflictWarningsInput(phase: .loading))
    }

    #Preview("Error") {
        previewSurface(ConflictWarningsInput(phase: .failed))
    }

    #Preview("Stale (auto-refresh)") {
        previewSurface(ConflictWarningsInput(phase: .loaded(previewConflicts), isStale: true))
    }

    #Preview("Offline (cached)") {
        previewSurface(ConflictWarningsInput(phase: .loaded(previewConflicts), isOffline: true))
    }
#endif
