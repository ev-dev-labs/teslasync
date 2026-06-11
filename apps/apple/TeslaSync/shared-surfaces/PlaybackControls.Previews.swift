//
//  PlaybackControls.Previews.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  Xcode previews for every presentation form the web source supports plus the P4 leaf states: the
//  interactive bar (with keyframe markers + keyboard shortcuts + a scrub-preview sampler), the loading
//  skeleton bar, the empty "nothing to replay" state, the error row, and the stale / offline freshness
//  chips. Staged on the app background. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum PlaybackControlsPreviewData {
        static let markers: [PlaybackControlsMarker] = [
            PlaybackControlsMarker(at: 0, kind: .start, label: "Departed"),
            PlaybackControlsMarker(at: 0.22, kind: .fastSegment, label: "Fast segment"),
            PlaybackControlsMarker(at: 0.41, kind: .regenPeak, label: "Regen peak", count: 3),
            PlaybackControlsMarker(at: 0.68, kind: .lowSoc, label: "Low battery"),
            PlaybackControlsMarker(at: 1, kind: .stop, label: "Arrived")
        ]

        static func content(
            connection: PlaybackControlsConnection = .live,
            shortcuts: Bool = true
        ) -> PlaybackControlsInput {
            PlaybackControlsInput(
                isPlaying: true,
                speed: .x10,
                progress: 0.41,
                elapsed: "2:34",
                total: "6:12",
                durationMs: 372_000,
                markers: markers,
                enableKeyboardShortcuts: shortcuts,
                connection: connection
            )
        }

        static let sampler: @MainActor (Double) -> PlaybackControlsPreview? = { at in
            PlaybackControlsPreview(
                at: at,
                speed: "\(Int(at * 80)) mph",
                power: "\(Int(at * 120)) kW",
                soc: "\(max(0, 86 - Int(at * 40)))%"
            )
        }
    }

    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 620, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Content — full") {
        staged(PlaybackControls(
            input: PlaybackControlsPreviewData.content(),
            preview: PlaybackControlsPreviewData.sampler
        ))
    }

    #Preview("Content — no shortcuts") {
        staged(PlaybackControls(input: PlaybackControlsPreviewData.content(shortcuts: false)))
    }

    #Preview("Loading") {
        staged(PlaybackControls(input: PlaybackControlsInput(isLoading: true)))
    }

    #Preview("Empty") {
        staged(PlaybackControls(input: PlaybackControlsInput(total: "0:00", durationMs: 0)))
    }

    #Preview("Error") {
        staged(PlaybackControls(input: PlaybackControlsInput(errorMessage: "Could not load replay")))
    }

    #Preview("Stale") {
        staged(PlaybackControls(input: PlaybackControlsPreviewData.content(connection: .stale)))
    }

    #Preview("Offline") {
        staged(PlaybackControls(input: PlaybackControlsPreviewData.content(connection: .offline)))
    }
#endif
