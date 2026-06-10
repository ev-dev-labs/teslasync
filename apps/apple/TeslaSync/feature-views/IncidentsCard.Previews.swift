//
//  IncidentsCard.Previews.swift
//  TeslaSync — P4 feature view · 0247 · IncidentsCard (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / populated content, plus the
//  stale + offline freshness branches). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope. No networking — the model is driven by the in-memory read
//  source + the in-memory create seam.
//

#if DEBUG
    import Foundation
    import SwiftUI

    @MainActor
    private func previewModel(_ update: IncidentsUpdate) -> IncidentsCardModel {
        let model = IncidentsCardModel(
            source: InMemoryIncidentsSource(update: update),
            incidentCreator: InMemoryIncidentCreator()
        )
        model.previewApply(update)
        return model
    }

    private var sampleIncidents: [ActiveIncident] {
        [
            ActiveIncident(
                id: 1,
                title: "Database failover in progress",
                severity: .critical,
                status: .investigating,
                affectedComponents: ["database", "api"],
                updateCount: 3,
                startedAt: Date(timeIntervalSinceNow: -1500)
            ),
            ActiveIncident(
                id: 2,
                title: "Telemetry ingestion lag above threshold",
                severity: .major,
                status: .identified,
                affectedComponents: ["telemetry", "mqtt"],
                updateCount: 2,
                startedAt: Date(timeIntervalSinceNow: -7200)
            ),
            ActiveIncident(
                id: 3,
                title: "Wall connector restart at 14:00",
                severity: .minor,
                status: .monitoring,
                affectedComponents: [],
                updateCount: 1,
                startedAt: Date(timeIntervalSinceNow: -180_000)
            )
        ]
    }

    private func framed(_ view: some View) -> some View {
        view
            .padding(TSSpacing.lg)
            .frame(width: 480)
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        framed(IncidentsCard(model: previewModel(
            IncidentsUpdate(status: .loaded, incidents: sampleIncidents)
        )))
    }

    #Preview("Loading") {
        framed(IncidentsCard(model: previewModel(
            IncidentsUpdate(status: .loading, incidents: [])
        )))
    }

    #Preview("Empty") {
        framed(IncidentsCard(model: previewModel(
            IncidentsUpdate(status: .loaded, incidents: [])
        )))
    }

    #Preview("Error") {
        framed(IncidentsCard(model: previewModel(
            IncidentsUpdate(status: .failed("The request timed out."), incidents: [])
        )))
    }

    #Preview("Stale (cached)") {
        framed(IncidentsCard(model: previewModel(
            IncidentsUpdate(status: .loaded, connection: .stale, incidents: sampleIncidents)
        )))
    }

    #Preview("Offline (cached)") {
        framed(IncidentsCard(model: previewModel(
            IncidentsUpdate(status: .loaded, connection: .offline, incidents: sampleIncidents)
        )))
    }
#endif
