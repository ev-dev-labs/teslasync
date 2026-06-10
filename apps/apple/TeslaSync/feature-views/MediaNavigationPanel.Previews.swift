//
//  MediaNavigationPanel.Previews.swift
//  TeslaSync — P4 feature view · 0282 · MediaNavigationPanel (Apple)
//
//  Xcode previews for each surface state (data / media-only / location-only / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum MediaNavPreviewData {
        static let playing = MediaNavMedia(
            nowPlayingTitle: "Bohemian Rhapsody",
            nowPlayingArtist: "Queen",
            playbackSource: "Spotify",
            playbackStatus: MediaPlaybackBadge.playingValue
        )

        static let paused = MediaNavMedia(
            nowPlayingTitle: "Take Five",
            nowPlayingArtist: "The Dave Brubeck Quartet",
            playbackSource: "Apple Music",
            playbackStatus: MediaPlaybackBadge.pausedValue
        )

        /// An active route ~18.5 km / 23 min out, with the work presence flag set.
        static let routing = MediaNavLocation(
            destinationName: "Supercharger — Fremont, CA",
            milesToArrival: 18500,
            minutesToArrival: 23,
            locatedAtWork: true
        )

        /// Parked at home with no active route (presence-only navigation block).
        static let atHome = MediaNavLocation(
            destinationName: nil,
            locatedAtHome: true,
            locatedAtFavorite: true
        )
    }

    @MainActor
    private func mediaNavPreviewModel(_ input: MediaNavInput) -> MediaNavigationModel {
        let source = InMemoryMediaNavSource(initial: input)
        let model = MediaNavigationModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — playing + routing") {
        MediaNavigationPanel(model: mediaNavPreviewModel(
            MediaNavInput(media: MediaNavPreviewData.playing, location: MediaNavPreviewData.routing)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — paused + home (imperial)") {
        MediaNavigationPanel(model: mediaNavPreviewModel(
            MediaNavInput(
                media: MediaNavPreviewData.paused,
                location: MediaNavPreviewData.atHome,
                units: .imperial
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Media only — no location data") {
        MediaNavigationPanel(model: mediaNavPreviewModel(
            MediaNavInput(media: MediaNavPreviewData.playing, location: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Location only — no media data") {
        MediaNavigationPanel(model: mediaNavPreviewModel(
            MediaNavInput(media: nil, location: MediaNavPreviewData.routing)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MediaNavigationPanel(model: mediaNavPreviewModel(MediaNavInput(media: nil, location: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MediaNavigationPanel(model: mediaNavPreviewModel(MediaNavInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MediaNavigationPanel(model: mediaNavPreviewModel(
            MediaNavInput(errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        MediaNavigationPanel(model: mediaNavPreviewModel(
            MediaNavInput(
                media: MediaNavPreviewData.playing,
                location: MediaNavPreviewData.routing,
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        MediaNavigationPanel(model: mediaNavPreviewModel(
            MediaNavInput(
                media: MediaNavPreviewData.playing,
                location: MediaNavPreviewData.routing,
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
