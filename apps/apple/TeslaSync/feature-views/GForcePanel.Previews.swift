//
//  GForcePanel.Previews.swift
//  TeslaSync — P4 feature view · 0169 · GForcePanel (Apple)
//
//  Xcode previews for each surface state (content / partial / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: GForceUpdate) -> GForcePanelModel {
        let source = InMemoryGForceSource(initial: update)
        let model = GForcePanelModel(source: source)
        model.start()
        return model
    }

    private func previewReading() -> GForceSnapshotInput {
        GForceSnapshotInput(lateralAcceleration: 0.32, longitudinalAcceleration: -0.15)
    }

    private func loadedUpdate(
        connection: GForceConnection = .live,
        reading: GForceSnapshotInput? = nil
    ) -> GForceUpdate {
        GForceUpdate(
            status: .loaded,
            connection: connection,
            reading: reading ?? previewReading(),
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: GForceUpdate) -> some View {
        ScrollView {
            GForcePanel(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Partial (lateral only)") {
        previewSurface(
            loadedUpdate(reading: GForceSnapshotInput(
                lateralAcceleration: 0.41,
                longitudinalAcceleration: nil
            ))
        )
    }

    #Preview("Empty (both nil)") {
        previewSurface(GForceUpdate(status: .loaded, reading: GForceSnapshotInput()))
    }

    #Preview("Empty (no snapshot)") {
        previewSurface(GForceUpdate(status: .empty, reading: nil))
    }

    #Preview("Loading") {
        previewSurface(GForceUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(GForceUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
