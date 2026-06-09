//
//  TripPlannerMap.Views.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  The map canvas + its furniture: the MapKit `Map` (web Leaflet `MapContainer` +
//  `MapTileLayer`), the route polyline (web `Polyline`), the origin / destination /
//  charge-stop pins (web `CircleMarker`s), the tap-to-open callout card (web Leaflet
//  `Popup`), and the role legend chip. The camera frames every plotted coordinate via
//  the shared, unit-tested `TSGeo.boundingRegion`, falling back to the web `center` +
//  `zoom` span for a single point. Tokens (P1/S9) + facade (P1/S10) only — no Tailwind
//  ports, no networking.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - Marker tint (web green origin / red destination / accent charge stop)

extension TripPlannerMarkerKind {
    /// The pin tint for this role — the toned, theme-aware parity of the web marker
    /// colors (green `#22c55e` origin, red `#ef4444` destination, blue `#3b82f6`
    /// charge stop / route).
    var tint: Color {
        switch self {
        case .origin: Color.TS.statusSuccess
        case .destination: Color.TS.statusDanger
        case .chargeStop: Color.TS.accent
        }
    }

    /// The glyph for this role (white-on-tint disc).
    var symbolName: String {
        switch self {
        case .origin: "location.fill"
        case .destination: "flag.fill"
        case .chargeStop: "bolt.fill"
        }
    }
}

// MARK: - Map canvas (web MapContainer + MapTileLayer + Polyline + CircleMarkers)

/// The MapKit canvas. Owns its camera so it stays framed on the plotted route,
/// re-fitting whenever the projection changes; selecting a pin raises the callout
/// through `onSelect`.
struct TripPlannerMapCanvas: View {
    let projection: TripPlannerMapProjection
    let selectedID: String?
    let accessibilityLabel: (TripPlannerMarker) -> String
    let onSelect: (String) -> Void

    @State private var camera: MapCameraPosition

    init(
        projection: TripPlannerMapProjection,
        selectedID: String?,
        accessibilityLabel: @escaping (TripPlannerMarker) -> String,
        onSelect: @escaping (String) -> Void
    ) {
        self.projection = projection
        self.selectedID = selectedID
        self.accessibilityLabel = accessibilityLabel
        self.onSelect = onSelect
        _camera = State(initialValue: TripPlannerMapCanvas.cameraPosition(for: projection))
    }

    var body: some View {
        Map(position: $camera) {
            if projection.polyline.count >= 2 {
                MapPolyline(coordinates: projection.polyline.map(\.coordinate))
                    .stroke(
                        Color.TS.accent.opacity(0.85),
                        style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
                    )
            }
            ForEach(projection.markers) { marker in
                Annotation(accessibilityLabel(marker), coordinate: marker.coordinate, anchor: .bottom) {
                    Button {
                        onSelect(marker.id)
                    } label: {
                        TripPlannerMapMarkerPin(kind: marker.kind, selected: marker.id == selectedID)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: accessibilityLabel(marker)))
                    .accessibilityAddTraits(.isButton)
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .onChange(of: projection) { _, _ in
            camera = TripPlannerMapCanvas.cameraPosition(for: projection)
        }
    }

    /// The camera that frames every plotted coordinate (shared `TSGeo.boundingRegion`)
    /// when there is a route to fit, else the web `center` at a `zoom`-derived span.
    static func cameraPosition(for projection: TripPlannerMapProjection) -> MapCameraPosition {
        if projection.hasFittableSpan, let region = TSGeo.boundingRegion(for: projection.mapCoordinates) {
            return .region(region)
        }
        let delta = spanDelta(forZoom: projection.zoom)
        return .region(
            MKCoordinateRegion(
                center: projection.center,
                span: MKCoordinateSpan(latitudeDelta: delta, longitudeDelta: delta)
            )
        )
    }

    /// Maps the web Leaflet `zoom` (4…9) to an approximate degree span for the
    /// single-point fallback camera, mirroring the web zoom thresholds.
    static func spanDelta(forZoom zoom: Int) -> Double {
        switch zoom {
        case ...4: 60
        case 5: 30
        case 6: 14
        case 7: 6
        default: 2
        }
    }
}

// MARK: - Marker pin (web CircleMarker)

/// A trip waypoint pin — a role glyph in a tinted disc (the native parity of the web
/// colored `CircleMarker`). The selected pin is enlarged with a ring.
struct TripPlannerMapMarkerPin: View {
    let kind: TripPlannerMarkerKind
    let selected: Bool

    var body: some View {
        Image(systemName: kind.symbolName)
            .font(.system(size: selected ? 14 : 11, weight: .bold))
            .foregroundStyle(.white)
            .padding(selected ? 9 : 7)
            .background(kind.tint, in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .overlay {
                if selected {
                    Circle().strokeBorder(kind.tint.opacity(0.5), lineWidth: 3).padding(-3)
                }
            }
            .shadow(radius: 2)
    }
}

// MARK: - Callout (web Leaflet Popup)

/// The marker callout card — the native parity of the web Leaflet popup: the
/// (fallback-resolved) name, the optional charge-stop SOC-range line, and a dismiss
/// control. Built from the pure `TripPlannerMarkerDisplay`.
struct TripPlannerMapCallout: View {
    let display: TripPlannerMarkerDisplay
    let localize: (String, String) -> String
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(display.kind.tint)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text(verbatim: display.title)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                }
                Spacer(minLength: TSSpacing.sm)
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: localize("tripPlanner.map.dismiss", "Dismiss")))
            }
            if let detail = display.detail {
                Text(verbatim: detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: display.accessibilityLabel))
    }
}

// MARK: - Legend chip (native chrome — the pin colors carry meaning)

/// A compact legend mapping each plotted role to its pin tint, so the green / red /
/// accent markers read clearly. Only the roles present in the projection are shown.
struct TripPlannerMapLegendChip: View {
    let projection: TripPlannerMapProjection
    let localize: (String, String) -> String

    private struct Entry: Identifiable {
        let id: String
        let tint: Color
        let label: String
    }

    private var entries: [Entry] {
        var result: [Entry] = []
        if projection.markers.contains(where: { $0.kind == .origin }) {
            result.append(Entry(
                id: "origin",
                tint: TripPlannerMarkerKind.origin.tint,
                label: localize("tripPlanner.map.origin", "Origin")
            ))
        }
        if projection.markers.contains(where: { $0.kind == .destination }) {
            result.append(Entry(
                id: "destination",
                tint: TripPlannerMarkerKind.destination.tint,
                label: localize("tripPlanner.map.destination", "Destination")
            ))
        }
        if !projection.chargeStopMarkers.isEmpty {
            result.append(Entry(
                id: "stops",
                tint: TripPlannerMarkerKind.chargeStop.tint,
                label: localize("tripPlanner.map.chargeStops", "Charge stops")
            ))
        }
        return result
    }

    var body: some View {
        let items = entries
        if !items.isEmpty {
            HStack(spacing: TSSpacing.md) {
                ForEach(items) { entry in
                    HStack(spacing: TSSpacing.xs) {
                        Circle().fill(entry.tint).frame(width: 7, height: 7).accessibilityHidden(true)
                        Text(verbatim: entry.label)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: legendAccessibilityLabel(items)))
        }
    }

    private func legendAccessibilityLabel(_ items: [Entry]) -> String {
        let roles = items.map(\.label).joined(separator: ", ")
        return TripPlannerMapText.fill(
            localize("tripPlanner.map.legendA11y", "Map legend: {{roles}}"),
            ["roles": roles]
        )
    }
}
