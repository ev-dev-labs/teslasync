import CoreLocation
import MapKit
import SwiftUI

/// Route polyline content to embed in a `Map { … }` (web `Polyline`).
@MapContentBuilder
public func tsPolyline(
    _ coordinates: [CLLocationCoordinate2D],
    colorIndex: Int = 0,
    lineWidth: CGFloat = 4
) -> some MapContent {
    MapPolyline(coordinates: coordinates)
        .stroke(TSChartPalette.color(at: colorIndex), lineWidth: lineWidth)
}

/// Filled circle overlay content (web `Circle`).
@MapContentBuilder
public func tsCircle(center: CLLocationCoordinate2D, radius: Double, colorIndex: Int = 2) -> some MapContent {
    MapCircle(center: center, radius: radius)
        .foregroundStyle(TSChartPalette.color(at: colorIndex).opacity(0.15))
        .stroke(TSChartPalette.color(at: colorIndex), lineWidth: 2)
}

/// Polygon (rectangle/area) overlay content (web `Rectangle`).
@MapContentBuilder
public func tsRectangle(corners: [CLLocationCoordinate2D], colorIndex: Int = 1) -> some MapContent {
    MapPolygon(coordinates: corners)
        .foregroundStyle(TSChartPalette.color(at: colorIndex).opacity(0.12))
        .stroke(TSChartPalette.color(at: colorIndex), lineWidth: 2)
}

/// Groups map content (web `FeatureGroup`).
@MapContentBuilder
public func tsFeatureGroup(@MapContentBuilder _ content: () -> some MapContent) -> some MapContent {
    content()
}

/// Route replay (web `RoutePlayback`): a map with an interpolated vehicle marker,
/// a scrubber, and transport controls. Position is computed by `TSGeo`.
public struct TSRoutePlayback: View {
    private let route: [CLLocationCoordinate2D]
    @State private var progress: Double = 0
    @State private var isPlaying = false
    @State private var camera: MapCameraPosition

    public init(route: [CLLocationCoordinate2D]) {
        self.route = route
        _camera = State(initialValue: TSMapCamera.fitting(route))
    }

    private var marker: [TSMapAnnotation] {
        guard let position = TSGeo.routePosition(route, progress: progress) else { return [] }
        return [TSMapAnnotation(id: "vehicle", coordinate: position, title: "map.vehicle", systemImage: "car.fill")]
    }

    public var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSMapView(camera: $camera, annotations: marker, route: route)
                .frame(minHeight: 240)
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            TSTimelineScrubber(progress: $progress, positionText: "\(Int((progress * 100).rounded()))%")
            HStack {
                Spacer()
                TSPlaybackControls(
                    isPlaying: $isPlaying,
                    onPrevious: { progress = max(0, progress - 0.05) },
                    onNext: { progress = min(1, progress + 0.05) }
                )
                Spacer()
            }
        }
        .task(id: isPlaying) {
            guard isPlaying else { return }
            while isPlaying, progress < 1 {
                try? await Task.sleep(for: .milliseconds(100))
                if Task.isCancelled { return }
                progress = min(1, progress + 0.01)
            }
            if progress >= 1 { isPlaying = false }
        }
    }
}
