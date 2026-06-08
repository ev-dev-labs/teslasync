//
//  DetailCards.Previews.swift
//  TeslaSync — P4 feature view · 0153 · DetailCards (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. The sample data here is shaped like the web
//  `DrivetrainHealthData` + `DrivingStats` props plus representative power figures.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative drivetrain data for previews/tests (no network), shaped like
    /// the web props the parent page feeds `DetailCards`.
    enum DetailCardsSample {
        static let health = DetailCardsHealth(
            frontMotorTempC: 48.0,
            rearMotorTempC: 52.5,
            inverterTempC: 41.2,
            batteryTempC: 33.8,
            motorStatus: "active",
            overallHealth: "good"
        )

        static let stats = DetailCardsStats(
            totalDrives: 184,
            totalDistanceKm: 5230,
            totalDurationS: 421_200,
            avgEfficiencyWhKm: 168,
            avgSpeedKmh: 44.7,
            topSpeedKmh: 138,
            regenRatio: 0.21,
            regenEnergyWh: 248_600,
            co2SavedKg: 612.4
        )

        static let peakPower: Double = 312
        static let avgPowerMax: Double = 128.6
        static let minRegenPower: Double = -64.3
    }

    @MainActor
    private func previewModel(_ update: DetailCardsUpdate) -> DetailCardsModel {
        let source = InMemoryDetailCardsSource(initial: update)
        let model = DetailCardsModel(source: source)
        model.start()
        return model
    }

    private func previewShell(_ surface: DetailCards) -> some View {
        ScrollView {
            surface.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 920)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            DetailCards(
                model: previewModel(
                    DetailCardsUpdate(
                        status: .loaded,
                        health: DetailCardsSample.health,
                        peakPower: DetailCardsSample.peakPower,
                        avgPowerMax: DetailCardsSample.avgPowerMax,
                        minRegenPower: DetailCardsSample.minRegenPower,
                        stats: DetailCardsSample.stats,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Empty (loaded, all em dash)") {
        previewShell(
            DetailCards(
                model: previewModel(DetailCardsUpdate(status: .empty, updatedAt: Date()))
            )
        )
    }

    #Preview("Loading") {
        previewShell(
            DetailCards(model: previewModel(DetailCardsUpdate(status: .loading)))
        )
    }

    #Preview("Error") {
        previewShell(
            DetailCards(
                model: previewModel(DetailCardsUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            DetailCards(
                model: previewModel(
                    DetailCardsUpdate(
                        status: .loaded,
                        connection: .stale,
                        health: DetailCardsSample.health,
                        peakPower: DetailCardsSample.peakPower,
                        avgPowerMax: DetailCardsSample.avgPowerMax,
                        minRegenPower: DetailCardsSample.minRegenPower,
                        stats: DetailCardsSample.stats,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            DetailCards(
                model: previewModel(
                    DetailCardsUpdate(
                        status: .loaded,
                        connection: .offline,
                        health: DetailCardsSample.health,
                        peakPower: DetailCardsSample.peakPower,
                        avgPowerMax: DetailCardsSample.avgPowerMax,
                        minRegenPower: DetailCardsSample.minRegenPower,
                        stats: DetailCardsSample.stats,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
