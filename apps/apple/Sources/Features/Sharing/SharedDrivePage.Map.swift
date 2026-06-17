import CoreLocation
import MapKit
import SwiftUI

// The Shared Drive hero route map (web hero `MapContainer` block). Renders through the P3 MapKit
// wrapper (`TSMapView`) — never a web view — with the drive's trail (web `Polyline`), the green
// start + red end markers (web start/end `CircleMarker`s), a dark-style default, and the P3 map
// style switcher (web `MapTileLayer`). Coordinates derive from the SI `SharedMapPoint`s; the camera
// fits the whole trail (web fit-bounds). Caller renders it only when the route has ≥ 2 vertices.

struct SharedDriveHeroMap: View {
    let points: [SharedMapPoint]

    @State private var style: TSMapStyle = .standard
    @State private var camera: MapCameraPosition

    init(points: [SharedMapPoint]) {
        self.points = points
        let coordinates = points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) }
        _camera = State(initialValue: TSMapCamera.fitting(coordinates))
    }

    private var coordinates: [CLLocationCoordinate2D] {
        points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) }
    }

    /// Web start/end `CircleMarker`s — first vertex green, last vertex red.
    private var annotations: [TSMapAnnotation] {
        var result: [TSMapAnnotation] = []
        if let start = coordinates.first {
            result.append(
                TSMapAnnotation(
                    id: "start",
                    coordinate: start,
                    title: "driveDetail.start",
                    tone: .success,
                    systemImage: "circle.fill"
                )
            )
        }
        if coordinates.count > 1, let end = coordinates.last {
            result.append(
                TSMapAnnotation(
                    id: "end",
                    coordinate: end,
                    title: "driveDetail.end",
                    tone: .danger,
                    systemImage: "circle.fill"
                )
            )
        }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSMapView(camera: $camera, annotations: annotations, route: coordinates, style: style)
                .frame(minHeight: 320)
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("map.label"))
            HStack {
                TSMapLayerSwitcher(style: $style).frame(maxWidth: 260)
                Spacer(minLength: 0)
            }
        }
    }
}
