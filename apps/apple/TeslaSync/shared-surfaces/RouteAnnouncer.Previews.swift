//
//  RouteAnnouncer.Previews.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope. The
//  data states are driven through the in-memory source + the deterministic scheduler so the
//  recent-navigation log is populated exactly as the running surface would build it.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum RouteAnnouncerPreviewData {
        /// A short navigation sequence — the landing route (skipped, web first paint) followed by
        /// the routes that announce.
        static let navigations: [RouteSnapshot] = [
            RouteSnapshot(path: "/", title: "Dashboard — TeslaSync"),
            RouteSnapshot(path: "/drives", title: "Drives — TeslaSync"),
            RouteSnapshot(path: "/charging/8821", title: "Charging Session — TeslaSync"),
            RouteSnapshot(path: "/analytics", title: "Analytics — TeslaSync")
        ]
    }

    /// Drives a model through a navigation sequence, advancing the deterministic scheduler after
    /// each route so the live region + history are populated, then applies the final connectivity.
    @MainActor
    private func previewModel(connection: RouteAnnouncerConnection = .live) -> RouteAnnouncerModel {
        let scheduler = ManualRouteAnnouncerScheduler()
        let source = InMemoryRouteAnnouncerSource(
            initial: RouteAnnouncerInput(snapshot: RouteAnnouncerPreviewData.navigations[0])
        )
        let model = RouteAnnouncerModel(source: source, scheduler: scheduler)
        model.start()
        for snapshot in RouteAnnouncerPreviewData.navigations.dropFirst() {
            source.push(RouteAnnouncerInput(snapshot: snapshot))
            scheduler.advance(by: 0.2)
        }
        if connection != .live {
            source.push(RouteAnnouncerInput(
                snapshot: RouteAnnouncerPreviewData.navigations.last,
                connection: connection
            ))
        }
        return model
    }

    @MainActor
    private func previewModel(_ input: RouteAnnouncerInput) -> RouteAnnouncerModel {
        let source = InMemoryRouteAnnouncerSource(initial: input)
        let model = RouteAnnouncerModel(source: source, scheduler: ManualRouteAnnouncerScheduler())
        model.start()
        return model
    }

    #Preview("Data") {
        RouteAnnouncer(model: previewModel())
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RouteAnnouncer(model: previewModel(RouteAnnouncerInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RouteAnnouncer(model: previewModel(RouteAnnouncerInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        RouteAnnouncer(model: previewModel(RouteAnnouncerInput(
            errorMessage: "The route feed timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        RouteAnnouncer(model: previewModel(connection: .stale))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        RouteAnnouncer(model: previewModel(connection: .offline))
            .padding()
            .background(Color.TS.bg)
    }
#endif
