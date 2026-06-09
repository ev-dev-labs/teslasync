//
//  PedalUsage.Previews.swift
//  TeslaSync — P4 feature view · 0173 · PedalUsage (Apple)
//
//  Xcode previews for each surface state (content / brake-engaged / partial / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: PedalUpdate) -> PedalUsageModel {
        let source = InMemoryPedalSource(initial: update)
        let model = PedalUsageModel(source: source)
        model.start()
        return model
    }

    private func previewPedal() -> PedalSnapshotInput {
        PedalSnapshotInput(throttlePosition: 42.5, brakePedalPosition: 0, brakePedalActive: false)
    }

    private func loadedUpdate(
        connection: PedalConnection = .live,
        pedal: PedalSnapshotInput? = nil
    ) -> PedalUpdate {
        PedalUpdate(
            status: .loaded,
            connection: connection,
            pedal: pedal ?? previewPedal(),
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: PedalUpdate) -> some View {
        ScrollView {
            PedalUsage(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Brake engaged") {
        previewSurface(
            loadedUpdate(pedal: PedalSnapshotInput(
                throttlePosition: 0,
                brakePedalPosition: 73,
                brakePedalActive: true
            ))
        )
    }

    #Preview("Partial (brake flag only)") {
        previewSurface(
            loadedUpdate(pedal: PedalSnapshotInput(
                throttlePosition: nil,
                brakePedalPosition: nil,
                brakePedalActive: true
            ))
        )
    }

    #Preview("Empty") {
        previewSurface(PedalUpdate(status: .loaded, pedal: PedalSnapshotInput()))
    }

    #Preview("Empty (no snapshot)") {
        previewSurface(PedalUpdate(status: .empty, pedal: nil))
    }

    #Preview("Loading") {
        previewSurface(PedalUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(PedalUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
