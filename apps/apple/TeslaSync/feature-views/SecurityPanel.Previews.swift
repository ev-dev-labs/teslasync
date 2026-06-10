//
//  SecurityPanel.Previews.swift
//  TeslaSync — P4 feature view · 0284 · SecurityPanel (Apple)
//
//  Xcode previews for each surface state (loading / content-secure / content-open /
//  content-remote-only / empty / error / stale / offline). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SecurityPanelUpdate) -> SecurityPanelModel {
        let source = InMemorySecurityPanelSource(initial: update)
        let model = SecurityPanelModel(source: source)
        model.start()
        return model
    }

    private let secureEvent = SecurityPanelEvent(
        locked: true,
        sentryMode: true,
        doorsOpen: nil,
        windowsOpen: nil,
        userPresent: false,
        detail: "All doors closed, vehicle secured"
    )

    private let openEvent = SecurityPanelEvent(
        locked: false,
        sentryMode: false,
        doorsOpen: "Driver Front Open",
        windowsOpen: "1 Open",
        userPresent: true,
        detail: nil
    )

    #Preview("Loading") {
        SecurityPanel(model: previewModel(SecurityPanelUpdate(status: .loading)))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content — secure") {
        SecurityPanel(model: previewModel(SecurityPanelUpdate(
            status: .loaded,
            connection: .live,
            data: SecurityPanelData(event: secureEvent, remoteStartEnabled: true)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — open") {
        SecurityPanel(model: previewModel(SecurityPanelUpdate(
            status: .loaded,
            connection: .live,
            data: SecurityPanelData(event: openEvent, remoteStartEnabled: false)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — remote only") {
        SecurityPanel(model: previewModel(SecurityPanelUpdate(
            status: .loaded,
            connection: .live,
            data: SecurityPanelData(event: nil, remoteStartEnabled: true)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SecurityPanel(model: previewModel(SecurityPanelUpdate(status: .empty, data: nil)))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SecurityPanel(model: previewModel(SecurityPanelUpdate(
            status: .failed("Tesla API returned 503 Service Unavailable"),
            data: nil
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SecurityPanel(model: previewModel(SecurityPanelUpdate(
            status: .loaded,
            connection: .stale,
            data: SecurityPanelData(event: secureEvent, remoteStartEnabled: true)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SecurityPanel(model: previewModel(SecurityPanelUpdate(
            status: .loaded,
            connection: .offline,
            data: SecurityPanelData(event: openEvent, remoteStartEnabled: false)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
