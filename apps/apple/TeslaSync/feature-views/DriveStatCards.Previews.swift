//
//  DriveStatCards.Previews.swift
//  TeslaSync — P4 feature view · 0139 · DriveStatCards (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale / offline)
//  across metric + imperial unit preferences. DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DriveStatCardsUpdate) -> DriveStatCardsModel {
        let source = InMemoryDriveStatCardsSource(initial: update)
        let model = DriveStatCardsModel(source: source)
        model.start()
        return model
    }

    /// Representative drive + computed stats — a ~256 mi / 4h32m highway drive with regen and a
    /// cost basis, so both conditional cost tiles render.
    private func previewInput() -> DriveStatCardsInput {
        DriveStatCardsInput(
            distanceM: 412_700,
            durationS: 16320,
            startBatteryPct: 88,
            endBatteryPct: 24,
            maxSpeed: 125,
            avgSpeed: 64,
            powerMax: 285,
            elevGain: 1240,
            elevLoss: 980,
            energyWh: 62400
        )
    }

    private func loadedUpdate(
        formatting: DriveStatCardsFormatting,
        connection: DriveStatCardsConnection = .live
    ) -> DriveStatCardsUpdate {
        DriveStatCardsUpdate(
            status: .loaded,
            input: previewInput(),
            formatting: formatting,
            connection: connection,
            updatedAt: Date()
        )
    }

    private let imperialFormatting = DriveStatCardsFormatting(
        distanceUnit: "mi",
        speedUnit: "mph",
        locale: "en-US",
        precision: 1,
        currencySymbol: "$",
        costPerKwh: 0.14
    )
    private let metricFormatting = DriveStatCardsFormatting(
        distanceUnit: "km",
        speedUnit: "km/h",
        locale: "en-US",
        precision: 2,
        currencySymbol: "€",
        costPerKwh: 0.30
    )

    @MainActor
    private func previewSurface(_ update: DriveStatCardsUpdate) -> some View {
        ScrollView {
            DriveStatCards(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content · imperial") {
        previewSurface(loadedUpdate(formatting: imperialFormatting))
    }

    #Preview("Content · metric") {
        previewSurface(loadedUpdate(formatting: metricFormatting))
    }

    #Preview("Empty") {
        previewSurface(DriveStatCardsUpdate(status: .empty, input: nil, formatting: imperialFormatting))
    }

    #Preview("Loading") {
        previewSurface(DriveStatCardsUpdate(status: .loading, input: nil, formatting: imperialFormatting))
    }

    #Preview("Error") {
        previewSurface(
            DriveStatCardsUpdate(status: .failed("Network unavailable"), input: nil, formatting: imperialFormatting)
        )
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(formatting: imperialFormatting, connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(formatting: imperialFormatting, connection: .offline))
    }
#endif
