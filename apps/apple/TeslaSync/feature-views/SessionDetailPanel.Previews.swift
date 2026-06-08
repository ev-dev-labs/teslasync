//
//  SessionDetailPanel.Previews.swift
//  TeslaSync — P4 feature view · 0091 · SessionDetailPanel (Apple)
//
//  Xcode previews for each surface state (loading / error / empty / data-full / data-minimal /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: SessionDetailInput) -> SessionDetailModel {
        let source = InMemorySessionDetailSource(initial: input)
        let model = SessionDetailModel(source: source)
        model.start()
        return model
    }

    private let previewFormatting = SessionFormatting(
        currencySymbol: "$",
        precision: 2,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    private let previewFullSession = ChargingSessionSnapshot(
        startedAt: Date(timeIntervalSince1970: 1_736_089_445),
        endedAt: Date(timeIntervalSince1970: 1_736_092_445),
        startSocPct: 22,
        endSocPct: 80,
        totalEnergyAddedWh: 42570,
        peakPowerW: 150_000,
        avgPowerW: 96500,
        costDecimal: 12.5,
        startPlace: "Mountain View Supercharger",
        chargerType: "Tesla"
    )

    private let previewMinimalSession = ChargingSessionSnapshot(
        startedAt: Date(timeIntervalSince1970: 1_736_089_445),
        endedAt: Date(timeIntervalSince1970: 1_736_091_245),
        startSocPct: 54,
        endSocPct: nil,
        totalEnergyAddedWh: 7400,
        peakPowerW: 7600,
        avgPowerW: nil,
        costDecimal: nil,
        startPlace: nil,
        chargerType: nil
    )

    #Preview("Loading") {
        SessionDetailPanel(model: previewModel(SessionDetailInput(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SessionDetailPanel(model: previewModel(
            SessionDetailInput(status: .failed("Tesla API returned 503 Service Unavailable"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SessionDetailPanel(model: previewModel(SessionDetailInput(status: .loaded, session: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data — full") {
        SessionDetailPanel(model: previewModel(SessionDetailInput(
            status: .loaded,
            session: previewFullSession,
            formatting: previewFormatting,
            connection: .live,
            updatedAt: Date()
        )))
        .frame(maxWidth: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — minimal") {
        SessionDetailPanel(model: previewModel(SessionDetailInput(
            status: .loaded,
            session: previewMinimalSession,
            formatting: previewFormatting,
            connection: .live,
            updatedAt: Date()
        )))
        .frame(maxWidth: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SessionDetailPanel(model: previewModel(SessionDetailInput(
            status: .loaded,
            session: previewFullSession,
            formatting: previewFormatting,
            connection: .stale,
            updatedAt: Date()
        )))
        .frame(maxWidth: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SessionDetailPanel(model: previewModel(SessionDetailInput(
            status: .loaded,
            session: previewFullSession,
            formatting: previewFormatting,
            connection: .offline,
            updatedAt: Date()
        )))
        .frame(maxWidth: 420)
        .padding()
        .background(Color.TS.bg)
    }
#endif
