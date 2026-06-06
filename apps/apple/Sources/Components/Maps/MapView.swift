import CoreLocation
import MapKit
import SwiftUI

/// Map style (web `MapTileLayer` equivalent via native styles).
public enum TSMapStyle: String, CaseIterable, Identifiable {
    case standard, hybrid, imagery

    public var id: String {
        rawValue
    }

    var mapStyle: MapStyle {
        switch self {
        case .standard: .standard
        case .hybrid: .hybrid
        case .imagery: .imagery
        }
    }

    var labelKey: LocalizedStringKey {
        switch self {
        case .standard: "map.style.standard"
        case .hybrid: "map.style.hybrid"
        case .imagery: "map.style.imagery"
        }
    }
}

/// Camera helpers (web `MapInvalidator`/fit-bounds equivalent).
public enum TSMapCamera {
    /// A camera position that fits every valid coordinate, else automatic.
    public static func fitting(_ coordinates: [CLLocationCoordinate2D]) -> MapCameraPosition {
        if let region = TSGeo.boundingRegion(for: coordinates) {
            return .region(region)
        }
        return .automatic
    }
}

/// Native MapKit map (web `MapView`) with annotations, a route, and geofences.
public struct TSMapView: View {
    @Binding private var camera: MapCameraPosition
    private let annotations: [TSMapAnnotation]
    private let route: [CLLocationCoordinate2D]
    private let geofences: [TSGeofence]
    private let style: TSMapStyle

    public init(
        camera: Binding<MapCameraPosition>,
        annotations: [TSMapAnnotation] = [],
        route: [CLLocationCoordinate2D] = [],
        geofences: [TSGeofence] = [],
        style: TSMapStyle = .standard
    ) {
        _camera = camera
        self.annotations = annotations
        self.route = route
        self.geofences = geofences
        self.style = style
    }

    public var body: some View {
        Map(position: $camera) {
            ForEach(annotations) { annotation in
                Annotation(annotation.title, coordinate: annotation.coordinate) {
                    TSVehicleAnnotation(tone: annotation.tone, systemImage: annotation.systemImage)
                }
            }
            if route.count >= 2 {
                MapPolyline(coordinates: route)
                    .stroke(Color.TS.accent, lineWidth: 4)
            }
            ForEach(geofences) { fence in
                MapCircle(center: fence.center, radius: fence.radiusMeters)
                    .foregroundStyle(TSChartPalette.color(at: fence.colorIndex).opacity(0.15))
                    .stroke(TSChartPalette.color(at: fence.colorIndex), lineWidth: 2)
            }
        }
        .mapStyle(style.mapStyle)
        .accessibilityLabel(Text("map.label"))
    }
}

/// Map-style segmented switcher (web `MapLayerSwitcher`).
public struct TSMapLayerSwitcher: View {
    @Binding private var style: TSMapStyle

    public init(style: Binding<TSMapStyle>) {
        _style = style
    }

    public var body: some View {
        Picker(selection: $style) {
            ForEach(TSMapStyle.allCases) { option in
                Text(option.labelKey).tag(option)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.segmented)
    }
}

/// Vehicle/pin marker content (web `VehicleAnnotation`).
public struct TSVehicleAnnotation: View {
    private let tone: TSTone
    private let systemImage: String

    public init(tone: TSTone = .accent, systemImage: String = "car.fill") {
        self.tone = tone
        self.systemImage = systemImage
    }

    public var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(.white)
            .padding(7)
            .background(tone.color, in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .shadow(radius: 2)
    }
}

/// Pulsing live-position marker (web `AnimatedMarker`). Pulse honors Reduce Motion.
public struct TSAnimatedMarker: View {
    private let tone: TSTone
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    public init(tone: TSTone = .accent) {
        self.tone = tone
    }

    public var body: some View {
        ZStack {
            Circle()
                .fill(tone.color.opacity(0.3))
                .frame(width: 36, height: 36)
                .scaleEffect(pulse && !reduceMotion ? 1.6 : 1)
                .opacity(pulse && !reduceMotion ? 0 : 0.6)
            Circle()
                .fill(tone.color)
                .frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
        }
    }
}

/// Clustered-marker badge (web `MarkerCluster`).
public struct TSMarkerCluster: View {
    private let count: Int
    private let tone: TSTone

    public init(count: Int, tone: TSTone = .accent) {
        self.count = count
        self.tone = tone
    }

    public var body: some View {
        Text(verbatim: "\(count)")
            .font(Font.TS.caption)
            .fontWeight(.bold)
            .foregroundStyle(.white)
            .padding(8)
            .background(tone.color, in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .accessibilityLabel(Text("map.cluster \(count)"))
    }
}

/// Small dot marker (web `CircleMarker`).
public struct TSCircleMarker: View {
    private let tone: TSTone

    public init(tone: TSTone = .accent) {
        self.tone = tone
    }

    public var body: some View {
        Circle()
            .fill(tone.color)
            .frame(width: 12, height: 12)
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
    }
}

/// Map annotation callout card (web `MapCallout`).
public struct TSMapCallout: View {
    private let title: LocalizedStringKey
    private let detail: LocalizedStringKey?

    public init(title: LocalizedStringKey, detail: LocalizedStringKey? = nil) {
        self.title = title
        self.detail = detail
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(Font.TS.bodySm).fontWeight(.semibold).foregroundStyle(Color.TS.textPrimary)
            if let detail {
                Text(detail).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            }
        }
        .padding(TSSpacing.sm)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// Geofence list/editor panel (web `GeofenceDrawer`).
public struct TSGeofenceDrawer: View {
    private let geofences: [TSGeofence]
    private let onDelete: (TSGeofence) -> Void

    public init(geofences: [TSGeofence], onDelete: @escaping (TSGeofence) -> Void) {
        self.geofences = geofences
        self.onDelete = onDelete
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSPanelTitle("geofence.title")
            if geofences.isEmpty {
                TSCaption("geofence.empty")
            } else {
                ForEach(geofences) { fence in
                    HStack(spacing: TSSpacing.sm) {
                        Circle().fill(TSChartPalette.color(at: fence.colorIndex)).frame(width: 10, height: 10)
                        Text(fence.label).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                        Spacer()
                        TSCode("\(Int(fence.radiusMeters)) m")
                        Button { onDelete(fence) } label: {
                            Image(systemName: "trash").foregroundStyle(Color.TS.statusDanger)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("action.delete"))
                    }
                }
            }
        }
        .padding(TSSpacing.lg)
    }
}
