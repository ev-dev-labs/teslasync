//
//  StatusHeader.Previews.swift
//  TeslaSync — P4 feature view · 0028 · StatusHeader (Apple)
//
//  Xcode previews for each surface state (content / content-disabled / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: StatusHeaderUpdate) -> StatusHeaderModel {
        let source = InMemoryStatusHeaderSource(initial: update)
        let model = StatusHeaderModel(source: source)
        model.start()
        return model
    }

    /// A representative populated DLQ: 1,284 dead-lettered entries, 912 of them replayable,
    /// replay enabled.
    private func populatedInput(replayEnabled: Bool = true) -> StatusHeaderInput {
        StatusHeaderInput(totalCount: 1284, replayableCount: 912, replayEnabled: replayEnabled)
    }

    private func loadedUpdate(
        input: StatusHeaderInput,
        connection: StatusHeaderConnection = .live
    ) -> StatusHeaderUpdate {
        StatusHeaderUpdate(status: .loaded, input: input, connection: connection, updatedAt: Date())
    }

    @MainActor
    private func previewSurface(_ update: StatusHeaderUpdate) -> some View {
        ScrollView {
            StatusHeader(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content · replay enabled") {
        previewSurface(loadedUpdate(input: populatedInput()))
    }

    #Preview("Content · replay disabled") {
        previewSurface(loadedUpdate(input: populatedInput(replayEnabled: false)))
    }

    #Preview("Empty · queue drained") {
        previewSurface(
            loadedUpdate(input: StatusHeaderInput(totalCount: 0, replayableCount: 0, replayEnabled: true))
        )
    }

    #Preview("Loading") {
        previewSurface(StatusHeaderUpdate(status: .loading, input: nil))
    }

    #Preview("Error") {
        previewSurface(StatusHeaderUpdate(status: .failed("Network unavailable"), input: nil))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(input: populatedInput(replayEnabled: false), connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(input: populatedInput(), connection: .offline))
    }
#endif
