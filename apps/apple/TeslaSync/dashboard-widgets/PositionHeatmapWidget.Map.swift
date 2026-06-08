//
//  PositionHeatmapWidget.Map.swift
//  TeslaSync — P4 dashboard widget · 0072 · PositionHeatmapWidget (Apple)
//
//  The MapKit density renderer (web Leaflet `MapContainer` + `CircleMarker`s).
//  Each cluster is a screen-space blob whose radius + fill encode visit density,
//  exactly like the web's pixel-radius `CircleMarker`s — so density reads the
//  same regardless of zoom. Pure presentation; clusters/colours come from the
//  PositionHeatmapBuilder.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - PositionHeatmapMapView (web `WidgetMapView` + `CircleMarker` density blobs)

/// Renders the density heatmap over MapKit. The camera fits the cluster centroid
/// at the tier's zoom (web fixed `center` + `zoom`); blobs are non-geographic
/// screen-space circles so their size/opacity encode density like Leaflet's
/// `CircleMarker`. The whole map is one accessibility element with a label + a
/// density summary value.
struct PositionHeatmapMapView: View {
    let clusters: [HeatCluster]
    let tier: PositionHeatmapTier
    let isInteractive: Bool
    let accessibilityLabelText: String
    let accessibilityValueText: String

    @State private var camera: MapCameraPosition

    init(
        clusters: [HeatCluster],
        tier: PositionHeatmapTier,
        isInteractive: Bool,
        accessibilityLabelText: String,
        accessibilityValueText: String
    ) {
        self.clusters = clusters
        self.tier = tier
        self.isInteractive = isInteractive
        self.accessibilityLabelText = accessibilityLabelText
        self.accessibilityValueText = accessibilityValueText
        let center = PositionHeatmapBuilder.centroid(clusters)
        let region = PositionHeatmapBuilder.region(center: center, zoom: PositionHeatmapBuilder.zoom(for: tier))
        _camera = State(initialValue: .region(region))
    }

    var body: some View {
        Map(position: $camera, interactionModes: isInteractive ? [.pan, .zoom] : []) {
            ForEach(clusters) { cluster in
                Annotation(coordinate: cluster.coordinate) {
                    blob(for: cluster)
                } label: {
                    EmptyView()
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onChange(of: cameraKey) { _, _ in
            let center = PositionHeatmapBuilder.centroid(clusters)
            camera = .region(PositionHeatmapBuilder.region(
                center: center,
                zoom: PositionHeatmapBuilder.zoom(for: tier)
            ))
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
        .accessibilityValue(Text(verbatim: accessibilityValueText))
    }

    private func blob(for cluster: HeatCluster) -> some View {
        let diameter = PositionHeatmapBuilder.radius(cluster.intensity, tier: tier) * 2
        let color = PositionHeatmapBuilder.color(forIntensity: cluster.intensity)
        let opacity = PositionHeatmapBuilder.fillOpacity(cluster.intensity, tier: tier)
        return Circle()
            .fill(color.opacity(opacity))
            .frame(width: diameter, height: diameter)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    /// A stable key for the cluster set so the camera re-fits when data changes.
    private var cameraKey: String {
        let center = PositionHeatmapBuilder.centroid(clusters)
        return "\(center.latitude),\(center.longitude),\(clusters.count)"
    }
}
