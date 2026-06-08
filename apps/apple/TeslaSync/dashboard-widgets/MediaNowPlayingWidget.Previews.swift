//
//  MediaNowPlayingWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0063 · MediaNowPlayingWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale /
//  offline / content). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private func previewModel(_ update: MediaNowPlayingUpdate) -> MediaNowPlayingModel {
        let source = InMemoryMediaNowPlayingSource(initial: update)
        let model = MediaNowPlayingModel(source: source)
        model.start()
        return model
    }

    private let previewSnapshot = MediaSnapshotInput(
        nowPlayingTitle: "Midnight City",
        nowPlayingArtist: "M83",
        nowPlayingAlbum: "Hurry Up, We're Dreaming",
        nowPlayingDurationMs: 244_000,
        nowPlayingElapsedMs: 96000,
        playbackStatus: "Playing",
        playbackSource: "Spotify",
        audioVolume: 7,
        audioVolumeMax: 11
    )

    private let previewVehicle = MediaVehicle(id: 1, displayName: "Model Y")

    #Preview("Content (2×2)") {
        MediaNowPlayingWidget(
            model: previewModel(
                MediaNowPlayingUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 260, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Tall (2×4)") {
        MediaNowPlayingWidget(
            model: previewModel(
                MediaNowPlayingUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 260, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MediaNowPlayingWidget(model: previewModel(MediaNowPlayingUpdate(status: .loading)))
            .frame(width: 260, height: 200)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MediaNowPlayingWidget(model: previewModel(MediaNowPlayingUpdate(status: .loaded, snapshot: nil)))
            .frame(width: 260, height: 200)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MediaNowPlayingWidget(
            model: previewModel(MediaNowPlayingUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 260, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        MediaNowPlayingWidget(
            model: previewModel(
                MediaNowPlayingUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot,
                    updatedAt: Date().addingTimeInterval(-90)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 260, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        MediaNowPlayingWidget(
            model: previewModel(
                MediaNowPlayingUpdate(
                    status: .loaded,
                    connection: .offline,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 260, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
