//
//  SummaryHeroCards.Previews.swift
//  TeslaSync — P4 feature view · 0077 · SummaryHeroCards (Apple)
//
//  Xcode previews for each surface state (loading / empty / loaded / loaded-no-fun-fact
//  / stale / offline / error / error-with-cache). DEBUG-only; compiled by the app
//  targets and excluded from the shipped-surface definition-of-done gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private enum SummaryHeroPreviewData {
        static let sample = DigestSummary(
            totalDistance: 312.4,
            prevDistance: 280.1,
            totalDrives: 18,
            prevDriveCount: 15,
            energyUsed: 64.2,
            prevEnergy: 70.5,
            chargingCost: 12.80,
            prevChargingCost: 15.10,
            co2Saved: 22.6,
            prevCo2: 19.8,
            funFact: FunFact(from: "San Francisco", to: "Los Angeles", times: "0.8")
        )

        static let sampleNoFunFact = DigestSummary(
            totalDistance: 4.2,
            prevDistance: 0,
            totalDrives: 1,
            prevDriveCount: 0,
            energyUsed: 0.9,
            prevEnergy: 0,
            chargingCost: 0,
            prevChargingCost: 0,
            co2Saved: 0.3,
            prevCo2: 0,
            funFact: nil
        )

        @MainActor
        static func model(_ update: SummaryHeroUpdate?) -> SummaryHeroCardsModel {
            let source = InMemorySummaryHeroSource(initial: update)
            let model = SummaryHeroCardsModel(source: source)
            model.start()
            return model
        }
    }

    private struct SummaryHeroPreviewStage: View {
        let model: SummaryHeroCardsModel

        var body: some View {
            ScrollView {
                SummaryHeroCards(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg.ignoresSafeArea())
        }
    }

    #Preview("Loaded") {
        SummaryHeroPreviewStage(
            model: SummaryHeroPreviewData.model(
                SummaryHeroUpdate(summary: SummaryHeroPreviewData.sample, connection: .online, updatedAt: Date())
            )
        )
    }

    #Preview("Loaded · no Fun Fact") {
        SummaryHeroPreviewStage(
            model: SummaryHeroPreviewData.model(
                SummaryHeroUpdate(
                    summary: SummaryHeroPreviewData.sampleNoFunFact,
                    connection: .online,
                    updatedAt: Date()
                )
            )
        )
    }

    #Preview("Loading") {
        SummaryHeroPreviewStage(model: SummaryHeroPreviewData.model(nil))
    }

    #Preview("Empty (no activity)") {
        SummaryHeroPreviewStage(
            model: SummaryHeroPreviewData.model(SummaryHeroUpdate(summary: nil, connection: .online))
        )
    }

    #Preview("Stale") {
        SummaryHeroPreviewStage(
            model: SummaryHeroPreviewData.model(
                SummaryHeroUpdate(
                    summary: SummaryHeroPreviewData.sample,
                    connection: .stale,
                    updatedAt: Date().addingTimeInterval(-120)
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        SummaryHeroPreviewStage(
            model: SummaryHeroPreviewData.model(
                SummaryHeroUpdate(
                    summary: SummaryHeroPreviewData.sample,
                    connection: .offline,
                    updatedAt: Date().addingTimeInterval(-300)
                )
            )
        )
    }

    #Preview("Error") {
        SummaryHeroPreviewStage(
            model: SummaryHeroPreviewData.model(SummaryHeroUpdate(summary: nil, connection: .online, failed: true))
        )
    }

    #Preview("Error (cached)") {
        SummaryHeroPreviewStage(
            model: SummaryHeroPreviewData.model(
                SummaryHeroUpdate(summary: SummaryHeroPreviewData.sample, connection: .online, failed: true)
            )
        )
    }
#endif
