//
//  MediaHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0062 · MediaHistoryWidget (Apple)
//
//  Xcode previews for each surface state (feed/compact/loading/empty/error/
//  offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: MediaHistoryUpdate) -> MediaHistoryModel {
        let source = InMemoryMediaHistorySource(initial: update)
        let model = MediaHistoryModel(source: source)
        model.start()
        return model
    }

    private let previewTracks: [MediaTrackInput] = [
        MediaTrackInput(
            id: "1",
            title: "Midnight City",
            artist: "M83",
            source: "spotify",
            playbackStatus: "playing",
            timestamp: Date().addingTimeInterval(-30)
        ),
        MediaTrackInput(
            id: "2",
            title: "Get Lucky",
            artist: "Daft Punk",
            source: "usb",
            playbackStatus: "paused",
            timestamp: Date().addingTimeInterval(-540)
        ),
        MediaTrackInput(
            id: "3",
            title: "Redbone",
            artist: "Childish Gambino",
            source: "bluetooth",
            playbackStatus: "paused",
            timestamp: Date().addingTimeInterval(-7200)
        )
    ]

    #Preview("Feed") {
        MediaHistoryWidget(
            model: previewModel(
                MediaHistoryUpdate(status: .loaded, connection: .live, tracks: previewTracks, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        MediaHistoryWidget(
            model: previewModel(MediaHistoryUpdate(status: .loaded, tracks: previewTracks, updatedAt: Date())),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 200, height: 120)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MediaHistoryWidget(model: previewModel(MediaHistoryUpdate(status: .loading, tracks: [])))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MediaHistoryWidget(model: previewModel(MediaHistoryUpdate(status: .loaded, tracks: [])))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MediaHistoryWidget(
            model: previewModel(MediaHistoryUpdate(status: .failed("Network unavailable"), tracks: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        MediaHistoryWidget(
            model: previewModel(
                MediaHistoryUpdate(
                    status: .loaded,
                    connection: .offline,
                    tracks: previewTracks,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
