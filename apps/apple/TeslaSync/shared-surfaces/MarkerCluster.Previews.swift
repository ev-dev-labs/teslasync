//
//  MarkerCluster.Previews.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  Xcode previews for each surface state (ready / loading / error / stale / offline / empty) plus the
//  dominant-child colour mode and the selected-marker callout. DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope. All copy resolves through the P1/S10 facade so the
//  previews carry no hardcoded literals.
//

import SwiftUI

#if DEBUG
    enum MarkerClusterPreviewData {
        /// Brand palette hexes used to exercise the per-marker colour + the dominant-child cluster
        /// colour mode (cyan / purple / amber / rose / emerald).
        static let palette = ["#22d3ee", "#a855f7", "#fbbf24", "#f43f5e", "#34d399"]

        /// A dense, deterministic point cloud around three hubs so clustering, the density palette,
        /// and the dominant-child mode all have something to render. No randomness — offsets come from
        /// trig on the index so the preview is stable.
        static let dense: [MarkerClusterPoint] = {
            let hubs = [
                (lat: 37.7749, lng: -122.4194),
                (lat: 37.8044, lng: -122.2712),
                (lat: 37.6879, lng: -122.4702)
            ]
            var points: [MarkerClusterPoint] = []
            for hubIndex in hubs.indices {
                let hub = hubs[hubIndex]
                for step in 0 ..< 40 {
                    let angle = Double(step) * 0.31
                    let radius = 0.004 + Double(step % 7) * 0.0011
                    let colour = palette[(hubIndex + step) % palette.count]
                    points.append(MarkerClusterPoint(
                        id: "\(hubIndex)-\(step)",
                        latitude: hub.lat + sin(angle) * radius,
                        longitude: hub.lng + cos(angle) * radius,
                        popupHTML: "<b>Stop \(step)</b><br/>Hub \(hubIndex + 1)",
                        colorHex: colour,
                        accessibilityLabel: "Stop \(step), hub \(hubIndex + 1)"
                    ))
                }
            }
            return points
        }()

        /// A single well-formed point used for the callout preview.
        static let one = MarkerClusterPoint(
            id: "solo",
            latitude: 37.7749,
            longitude: -122.4194,
            popupHTML: "<b>Ferry Building</b><br/>Embarcadero",
            colorHex: "#22d3ee",
            accessibilityLabel: "Ferry Building"
        )
    }

    @MainActor
    private func previewModel(
        _ input: MarkerClusterInput,
        content: MarkerClusterContent = MarkerClusterContent()
    ) -> MarkerClusterModel {
        let model = MarkerClusterModel(
            content: content,
            source: InMemoryMarkerClusterSource(initial: input)
        )
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: MarkerClusterModel) -> some View {
        MarkerCluster(model: model, height: 320)
            .padding()
            .frame(maxWidth: 520)
            .background(Color.TS.bg)
    }

    #Preview("Ready — density palette") {
        staged(previewModel(MarkerClusterInput(
            connection: .live,
            phase: .loaded,
            points: MarkerClusterPreviewData.dense
        )))
    }

    #Preview("Ready — colour by category") {
        staged(previewModel(
            MarkerClusterInput(connection: .live, phase: .loaded, points: MarkerClusterPreviewData.dense),
            content: MarkerClusterContent(colorMode: .dominantChild)
        ))
    }

    #Preview("Loading") {
        staged(previewModel(MarkerClusterInput(connection: .live, phase: .loading, points: nil)))
    }

    #Preview("Empty") {
        staged(previewModel(MarkerClusterInput(connection: .live, phase: .loaded, points: [])))
    }

    #Preview("Error") {
        staged(previewModel(MarkerClusterInput(
            connection: .live,
            phase: .failed,
            points: MarkerClusterPreviewData.dense
        )))
    }

    #Preview("Stale") {
        staged(previewModel(MarkerClusterInput(
            connection: .stale,
            phase: .loaded,
            points: MarkerClusterPreviewData.dense
        )))
    }

    #Preview("Offline") {
        staged(previewModel(MarkerClusterInput(
            connection: .offline,
            phase: .loaded,
            points: MarkerClusterPreviewData.dense
        )))
    }

    #Preview("Selected callout") {
        MarkerClusterCallout(point: MarkerClusterPreviewData.one) {}
            .padding()
            .frame(maxWidth: 360)
            .background(Color.TS.bg)
    }

    #Preview("Empty overlay") {
        MarkerClusterEmptyOverlay()
            .padding()
            .frame(maxWidth: 360)
            .background(Color.TS.bg)
    }
#endif
