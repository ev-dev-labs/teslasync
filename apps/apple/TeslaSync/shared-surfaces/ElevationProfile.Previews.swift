//
//  ElevationProfile.Previews.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  Xcode previews for each branch the web source renders plus the P4 leaf contract: the populated area
//  chart (with + without the controlled cursor), the empty state (no samples), and the loading / error
//  / stale / offline chrome. DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import SwiftUI

#if DEBUG
    private enum ElevationProfilePreviewData {
        /// A deterministic rolling-hill route: 24 samples, 0.5 km apart, elevation in metres.
        static let data: [ElevationProfileSample] = {
            let elevations: [Double] = [
                120, 128, 140, 155, 150, 162, 178, 190, 205, 198, 210, 230,
                245, 240, 255, 270, 262, 250, 238, 225, 210, 205, 215, 230
            ]
            return elevations.enumerated().map { offset, elevation in
                ElevationProfileSample(
                    index: offset,
                    distance: Double(offset) * 0.5,
                    elevation: elevation,
                    speed: 45
                )
            }
        }()
    }

    private struct ElevationProfilePreviewFrame<Content: View>: View {
        @ViewBuilder let content: Content

        var body: some View {
            content
                .padding()
                .background(Color.TS.bg)
        }
    }

    #Preview("Populated (with cursor)") {
        ElevationProfilePreviewFrame {
            ElevationProfile(
                data: ElevationProfilePreviewData.data,
                currentIndex: 15,
                onClickIndex: { _ in }
            )
        }
    }

    #Preview("Populated (no cursor)") {
        ElevationProfilePreviewFrame {
            ElevationProfile(data: ElevationProfilePreviewData.data, distanceUnit: "mi")
        }
    }

    #Preview("Empty (no samples)") {
        ElevationProfilePreviewFrame {
            ElevationProfile(data: [])
        }
    }

    #Preview("Loading") {
        ElevationProfilePreviewFrame {
            ElevationProfile(state: .loading(cached: nil, stale: false))
        }
    }

    #Preview("Error (retry)") {
        ElevationProfilePreviewFrame {
            ElevationProfile(
                state: .failed(.network(message: "offline"), cached: nil, stale: false),
                onRetry: {}
            )
        }
    }

    #Preview("Stale (cached behind refresh)") {
        ElevationProfilePreviewFrame {
            ElevationProfile(
                state: .loaded(ElevationProfilePreviewData.data, stale: true),
                currentIndex: 8,
                onRetry: {}
            )
        }
    }

    #Preview("Offline (cached)") {
        ElevationProfilePreviewFrame {
            ElevationProfile(
                state: .failed(.offline, cached: ElevationProfilePreviewData.data, stale: true),
                onRetry: {}
            )
        }
    }
#endif
