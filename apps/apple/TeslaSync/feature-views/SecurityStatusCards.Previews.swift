//
//  SecurityStatusCards.Previews.swift
//  TeslaSync — P4 feature view · 0046 · SecurityStatusCards (Apple)
//
//  Xcode previews for each surface state (loading / content-secure / content-open /
//  empty / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SecurityCardsUpdate) -> SecurityCardsModel {
        let source = InMemorySecurityCardsSource(initial: update)
        let model = SecurityCardsModel(source: source)
        model.start()
        return model
    }

    private let secureEvent = SecurityCardsLatest(
        locked: true,
        sentryMode: .text("On"),
        doorState: .text("Closed"),
        frontDriverWindow: .text("Closed"),
        frontPassengerWindow: .text("Closed"),
        rearDriverWindow: .text("Closed"),
        rearPassengerWindow: .text("Closed"),
        homelinkNearby: true,
        guestMode: false,
        createdAt: Date()
    )

    private let openEvent = SecurityCardsLatest(
        locked: false,
        sentryMode: .boolean(false),
        doorState: .text("Driver Front Open"),
        frontDriverWindow: .text("Open"),
        frontPassengerWindow: .text("Vent"),
        rearDriverWindow: .text("Closed"),
        rearPassengerWindow: .text("Closed"),
        homelinkNearby: false,
        guestMode: true,
        createdAt: Date()
    )

    #Preview("Loading") {
        SecurityStatusCards(model: previewModel(SecurityCardsUpdate(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content — secure") {
        SecurityStatusCards(model: previewModel(
            SecurityCardsUpdate(status: .loaded, connection: .live, latest: secureEvent)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — open") {
        SecurityStatusCards(model: previewModel(
            SecurityCardsUpdate(status: .loaded, connection: .live, latest: openEvent)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SecurityStatusCards(model: previewModel(SecurityCardsUpdate(status: .empty, latest: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SecurityStatusCards(model: previewModel(
            SecurityCardsUpdate(status: .failed("Tesla API returned 503 Service Unavailable"), latest: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SecurityStatusCards(model: previewModel(
            SecurityCardsUpdate(status: .loaded, connection: .stale, latest: secureEvent)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SecurityStatusCards(model: previewModel(
            SecurityCardsUpdate(status: .loaded, connection: .offline, latest: openEvent)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
