//
//  RecentChargesSection.Previews.swift
//  TeslaSync — P4 feature view · 0296 · RecentChargesSection (Apple)
//
//  Xcode previews for each surface state (loading / data / data·single / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: RecentChargesSectionInput) -> RecentChargesSectionModel {
        let source = InMemoryRecentChargesSource(initial: input)
        let model = RecentChargesSectionModel(source: source)
        model.start()
        return model
    }

    private let sampleSessions: [RecentChargesSession] = [
        RecentChargesSession(
            id: 1,
            startTs: "2026-04-04T15:45:00Z",
            totalEnergyAddedWh: 42300,
            durationMin: 65,
            cost: 8.4,
            startSocPct: 20,
            endSocPct: 80
        ),
        RecentChargesSession(
            id: 2,
            startTs: "2026-04-03T08:10:00Z",
            totalEnergyAddedWh: 12500,
            durationMin: 45,
            cost: 2.5,
            startSocPct: 55,
            endSocPct: 72
        ),
        RecentChargesSession(
            id: 3,
            startTs: "2026-04-01T19:30:00Z",
            totalEnergyAddedWh: 6200,
            durationMin: 125,
            cost: nil,
            startSocPct: 64,
            endSocPct: nil
        )
    ]

    #Preview("Loading") {
        RecentChargesSection(model: previewModel(RecentChargesSectionInput(isLoading: true)))
            .padding()
            .frame(maxWidth: 620)
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        RecentChargesSection(model: previewModel(RecentChargesSectionInput(sessions: sampleSessions)))
            .padding()
            .frame(maxWidth: 620)
            .background(Color.TS.bg)
    }

    #Preview("Data · single") {
        RecentChargesSection(model: previewModel(
            RecentChargesSectionInput(sessions: [sampleSessions[0]])
        ))
        .padding()
        .frame(maxWidth: 620)
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RecentChargesSection(model: previewModel(RecentChargesSectionInput(sessions: [])))
            .padding()
            .frame(maxWidth: 620)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        RecentChargesSection(model: previewModel(
            RecentChargesSectionInput(errorMessage: "Charging request returned 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 620)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        RecentChargesSection(model: previewModel(
            RecentChargesSectionInput(sessions: sampleSessions, connection: .stale)
        ))
        .padding()
        .frame(maxWidth: 620)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        RecentChargesSection(model: previewModel(
            RecentChargesSectionInput(sessions: sampleSessions, connection: .offline)
        ))
        .padding()
        .frame(maxWidth: 620)
        .background(Color.TS.bg)
    }
#endif
