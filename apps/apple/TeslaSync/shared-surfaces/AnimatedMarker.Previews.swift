//
//  AnimatedMarker.Previews.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  Xcode previews for each surface state (ready / loading / error / stale / offline) plus the
//  no-heading and coloured-replay variants. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. All copy resolves through the P1/S10 facade so the previews carry no
//  hardcoded literals.
//

import SwiftUI

#if DEBUG
    enum AnimatedMarkerPreviewData {
        /// A live vehicle fix with a heading (San Francisco), the web default colour.
        static let live = AnimatedMarkerFixRow(latitude: 37.7749, longitude: -122.4194, heading: 45)
        /// A fix with no heading — exercises the no-arrow branch (web `heading == null`).
        static let noHeading = AnimatedMarkerFixRow(latitude: 37.7749, longitude: -122.4194)
        /// A replay-style fix with a custom marker colour (the web `color` prop).
        static let coloured = AnimatedMarkerFixRow(
            latitude: 40.7128,
            longitude: -74.0060,
            heading: 270,
            color: "#10b981"
        )
        /// A null-island fix — exercises the empty state (web `hasCoords === false`).
        static let nullIsland = AnimatedMarkerFixRow(latitude: 0, longitude: 0)
    }

    @MainActor
    private func previewModel(_ input: AnimatedMarkerInput) -> AnimatedMarkerModel {
        AnimatedMarkerModel(
            content: AnimatedMarkerContent(),
            source: InMemoryAnimatedMarkerSource(initial: input)
        )
    }

    @MainActor
    private func staged(_ model: AnimatedMarkerModel) -> some View {
        AnimatedMarker(model: model, height: 280)
            .padding()
            .frame(maxWidth: 480)
            .background(Color.TS.bg)
    }

    #Preview("Ready — heading") {
        staged(previewModel(AnimatedMarkerInput(
            connection: .live,
            phase: .loaded,
            row: AnimatedMarkerPreviewData.live
        )))
    }

    #Preview("Ready — no heading") {
        staged(previewModel(AnimatedMarkerInput(
            connection: .live,
            phase: .loaded,
            row: AnimatedMarkerPreviewData.noHeading
        )))
    }

    #Preview("Ready — coloured replay") {
        staged(previewModel(AnimatedMarkerInput(
            connection: .live,
            phase: .loaded,
            row: AnimatedMarkerPreviewData.coloured
        )))
    }

    #Preview("Loading") {
        staged(previewModel(AnimatedMarkerInput(connection: .live, phase: .loading, row: nil)))
    }

    #Preview("Empty — null island") {
        staged(previewModel(AnimatedMarkerInput(
            connection: .live,
            phase: .loaded,
            row: AnimatedMarkerPreviewData.nullIsland
        )))
    }

    #Preview("Error") {
        staged(previewModel(AnimatedMarkerInput(
            connection: .live,
            phase: .failed,
            row: AnimatedMarkerPreviewData.live
        )))
    }

    #Preview("Stale") {
        staged(previewModel(AnimatedMarkerInput(
            connection: .stale,
            phase: .loaded,
            row: AnimatedMarkerPreviewData.live
        )))
    }

    #Preview("Offline") {
        staged(previewModel(AnimatedMarkerInput(
            connection: .offline,
            phase: .loaded,
            row: AnimatedMarkerPreviewData.live
        )))
    }

    #Preview("Glyph — heading vs none") {
        HStack(spacing: TSSpacing.x3xl) {
            AnimatedMarkerGlyph(color: AnimatedMarkerPalette.fallback.color, heading: 45)
            AnimatedMarkerGlyph(color: AnimatedMarkerPalette.parse("#10b981").color, heading: nil)
        }
        .padding(TSSpacing.x3xl)
        .background(Color.TS.bg)
    }
#endif
