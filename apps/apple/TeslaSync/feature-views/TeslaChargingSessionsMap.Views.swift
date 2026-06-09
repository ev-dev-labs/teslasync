//
//  TeslaChargingSessionsMap.Views.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  The map canvas + its furniture: the MapKit `Map` (web Leaflet `MapContainer` +
//  `MapTileLayer`), the charging-site marker pin (web `MarkerCluster` point), the
//  tap-to-open callout card (web Leaflet popup / `popupHtml`), and the plotted-
//  count chip (web `MarkerCluster` badge). The camera frames every plotted marker
//  via the shared, unit-tested `TSGeo.boundingRegion`, falling back to the web
//  `center` memo at a continental (zoom-5-equivalent) span. Tokens + facade only.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - Map canvas (web MapContainer + MapTileLayer + MarkerCluster)

/// The MapKit canvas. Owns its camera so it stays framed on the plotted markers,
/// re-fitting whenever the projection changes; selecting a pin raises the callout
/// through `onSelect`.
struct TeslaChargingSessionsMapCanvas: View {
    let projection: TeslaChargingSessionsMapProjection
    let selectedID: Int?
    let accessibilityLabel: (TeslaChargingSessionMarker) -> String
    let onSelect: (Int) -> Void

    @State private var camera: MapCameraPosition

    init(
        projection: TeslaChargingSessionsMapProjection,
        selectedID: Int?,
        accessibilityLabel: @escaping (TeslaChargingSessionMarker) -> String,
        onSelect: @escaping (Int) -> Void
    ) {
        self.projection = projection
        self.selectedID = selectedID
        self.accessibilityLabel = accessibilityLabel
        self.onSelect = onSelect
        _camera = State(initialValue: TeslaChargingSessionsMapCanvas.cameraPosition(for: projection))
    }

    var body: some View {
        Map(position: $camera) {
            ForEach(projection.markers) { marker in
                Annotation(accessibilityLabel(marker), coordinate: marker.coordinate, anchor: .bottom) {
                    Button {
                        onSelect(marker.id)
                    } label: {
                        TeslaChargingSessionsMapMarkerPin(selected: marker.id == selectedID)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: accessibilityLabel(marker)))
                    .accessibilityAddTraits(.isButton)
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .onChange(of: projection.markers) { _, _ in
            camera = TeslaChargingSessionsMapCanvas.cameraPosition(for: projection)
        }
    }

    /// The camera that frames every plotted marker (shared `TSGeo.boundingRegion`),
    /// or the web `center` memo at a continental, zoom-5-equivalent span when no
    /// marker has a usable coordinate.
    static func cameraPosition(for projection: TeslaChargingSessionsMapProjection) -> MapCameraPosition {
        if let region = TSGeo.boundingRegion(for: projection.markerCoordinates) {
            return .region(region)
        }
        return .region(
            MKCoordinateRegion(
                center: projection.center,
                span: MKCoordinateSpan(latitudeDelta: 30, longitudeDelta: 30)
            )
        )
    }
}

// MARK: - Marker pin (web MarkerCluster point, defaultColor #22d3ee)

/// A charging-site pin — a bolt glyph in the brand-accent disc (the native parity
/// of the web cyan cluster marker). The selected pin is enlarged with a ring.
struct TeslaChargingSessionsMapMarkerPin: View {
    let selected: Bool

    var body: some View {
        Image(systemName: "bolt.fill")
            .font(.system(size: selected ? 15 : 12, weight: .bold))
            .foregroundStyle(.white)
            .padding(selected ? 9 : 7)
            .background(Color.TS.accent, in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .overlay {
                if selected {
                    Circle().strokeBorder(Color.TS.accent.opacity(0.5), lineWidth: 3).padding(-3)
                }
            }
            .shadow(radius: 2)
    }
}

// MARK: - Count chip (web MarkerCluster badge)

/// The plotted-session count chip (web `MarkerCluster` count badge).
struct TeslaChargingSessionsMapCountChip: View {
    let count: Int
    let localize: (String, String) -> String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: TeslaChargingSessionsMapLabels.count(count, localize: localize))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: TeslaChargingSessionsMapLabels.countAccessibility(count, localize: localize))
        )
    }
}

// MARK: - Callout (web Leaflet popup / popupHtml)

/// The marker callout card — the native parity of the web Leaflet popup: the site
/// name, the start date-time, and the optional energy / cost / charger rows, with
/// a dismiss control. Built from the pure `TeslaChargingSessionCalloutDisplay`.
struct TeslaChargingSessionsMapCallout: View {
    let display: TeslaChargingSessionCalloutDisplay
    let localize: (String, String) -> String
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: display.siteName)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: localize("callout.dismiss", "Dismiss")))
            }
            TeslaChargingSessionsMapCalloutRow(label: localize("callout.dateLabel", "Started"), value: display.dateText)
            if let energyText = display.energyText {
                TeslaChargingSessionsMapCalloutRow(
                    label: localize("callout.energyLabel", "Energy"),
                    value: energyText
                )
            }
            if let costText = display.costText {
                TeslaChargingSessionsMapCalloutRow(label: localize("callout.costLabel", "Cost"), value: costText)
            }
            if let chargerText = display.chargerText {
                TeslaChargingSessionsMapCalloutRow(
                    label: localize("callout.chargerLabel", "Charger"),
                    value: chargerText
                )
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
        .accessibilityLabel(Text(verbatim: display.accessibilitySummary))
    }
}

/// One label / value row inside the callout.
struct TeslaChargingSessionsMapCalloutRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.trailing)
        }
    }
}
